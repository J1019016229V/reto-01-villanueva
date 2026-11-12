/**
 * Adaptador para APIs compatibles con OpenAI Chat Completions (OpenAI, Azure OpenAI, Mistral, Ollama/LM Studio).
 * Existe para demostrar que cambiar de proveedor no toca el ciclo del agente.
 */
import { z } from "zod"
import type { DefinicionHerramienta } from "../tools/registro"
import { ErrorLlm, esquemaLimpio, postJson, type LlmAdapter, type Mensaje, type RespuestaLlm } from "./adapter"

const RespuestaSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z.array(z.object({ id: z.string(), function: z.object({ name: z.string(), arguments: z.string() }) })).optional(),
        }),
      }),
    )
    .min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).partial().optional(),
})

type MensajeOpenAi = Record<string, unknown>

function aOpenAi(m: Mensaje): MensajeOpenAi[] {
  if (m.rol === "user") return [{ role: "user", content: m.texto }]
  if (m.rol === "tool") return m.resultados.map((r) => ({ role: "tool", tool_call_id: r.id, content: r.contenido }))
  return [
    {
      role: "assistant",
      content: m.texto || null,
      ...(m.llamadas.length
        ? { tool_calls: m.llamadas.map((l) => ({ id: l.id, type: "function", function: { name: l.nombre, arguments: JSON.stringify(l.args ?? {}) } })) }
        : {}),
    },
  ]
}

const parseArgs = (s: string): unknown => {
  try {
    return JSON.parse(s) as unknown
  } catch {
    return {}
  }
}

export class OpenAiCompatAdapter implements LlmAdapter {
  readonly proveedor = "openai-compatible"
  constructor(
    private readonly apiKey: string,
    readonly modelo: string,
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async enviar(sistema: string, mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLlm> {
    const crudo = await postJson(
      `${this.baseUrl.replace(/\/$/, "")}/chat/completions`,
      { authorization: `Bearer ${this.apiKey}` },
      {
        model: this.modelo,
        messages: [{ role: "system", content: sistema }, ...mensajes.flatMap(aOpenAi)],
        tools: herramientas.map((h) => ({ type: "function", function: { name: h.nombre, description: h.descripcion, parameters: esquemaLimpio(h.esquema) } })),
      },
      this.timeoutMs,
    )
    const p = RespuestaSchema.safeParse(crudo)
    const msg = p.success ? p.data.choices[0]?.message : undefined
    if (!p.success || !msg) throw new ErrorLlm("el proveedor devolvió una respuesta con formato inesperado")
    return {
      texto: msg.content ?? "",
      llamadas: (msg.tool_calls ?? []).map((t) => ({ id: t.id, nombre: t.function.name, args: parseArgs(t.function.arguments) })),
      uso: { entrada: p.data.usage?.prompt_tokens ?? 0, salida: p.data.usage?.completion_tokens ?? 0 },
    }
  }
}
