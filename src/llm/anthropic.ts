/** Implementación del adaptador para Anthropic (Messages API) con fetch nativo: sin SDK. */
import { z } from "zod"
import type { DefinicionHerramienta } from "../tools/registro"
import { ErrorLlm, esquemaLimpio, postJson, type LlmAdapter, type Mensaje, type RespuestaLlm } from "./adapter"

const RespuestaSchema = z.object({
  content: z.array(
    z.union([
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.unknown() }),
      z.object({ type: z.string() }).passthrough(),
    ]),
  ),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).partial().optional(),
})

type Bloque =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean }

function aAnthropic(m: Mensaje): { role: "user" | "assistant"; content: Bloque[] } {
  if (m.rol === "user") return { role: "user", content: [{ type: "text", text: m.texto }] }
  if (m.rol === "tool") {
    return { role: "user", content: m.resultados.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.contenido, is_error: r.esError })) }
  }
  const content: Bloque[] = []
  if (m.texto.trim()) content.push({ type: "text", text: m.texto })
  for (const l of m.llamadas) content.push({ type: "tool_use", id: l.id, name: l.nombre, input: l.args ?? {} })
  return { role: "assistant", content }
}

export class AnthropicAdapter implements LlmAdapter {
  readonly proveedor = "anthropic"
  constructor(
    private readonly apiKey: string,
    readonly modelo: string,
    private readonly timeoutMs: number,
    private readonly maxTokensRespuesta = 2048,
    private readonly baseUrl: string = "https://api.anthropic.com",
    private readonly version = "2023-06-01",
  ) {}

  async enviar(sistema: string, mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLlm> {
    const crudo = await postJson(
      `${this.baseUrl.replace(/\/$/, "")}/v1/messages`,
      { authorization: `Bearer ${this.apiKey}`, "anthropic-version": this.version },
      {
        model: this.modelo,
        max_tokens: this.maxTokensRespuesta,
        system: sistema,
        messages: mensajes.map(aAnthropic),
        tools: herramientas.map((h) => ({ name: h.nombre, description: h.descripcion, input_schema: esquemaLimpio(h.esquema) })),
      },
      this.timeoutMs,
    )
    const p = RespuestaSchema.safeParse(crudo)
    if (!p.success) throw new ErrorLlm("el proveedor devolvió una respuesta con formato inesperado")
    const texto: string[] = []
    const llamadas: RespuestaLlm["llamadas"] = []
    for (const b of p.data.content) {
      if (b.type === "text" && "text" in b && typeof b.text === "string") texto.push(b.text)
      if (b.type === "tool_use" && "id" in b && "name" in b) llamadas.push({ id: String(b.id), nombre: String(b.name), args: "input" in b ? b.input : {} })
    }
    return { texto: texto.join("\n"), llamadas, uso: { entrada: p.data.usage?.input_tokens ?? 0, salida: p.data.usage?.output_tokens ?? 0 } }
  }
}
