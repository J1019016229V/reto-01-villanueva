/**
 * Ciclo del agente (PRD §6.3): prompt → modelo → herramientas → ... → respuesta.
 * Garantías en código: tope de iteraciones (CA1), compuerta de confirmación (CA3/RN4),
 * trazabilidad (CA4), errores sin matar la sesión (CA5) y presupuesto de tokens (NF4).
 * No conoce HTTP ni a ningún proveedor concreto.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ErrorLlm, type LlmAdapter, type Mensaje, type ResultadoHerramienta } from "../llm/adapter"
import { definiciones, ejecutarHerramienta } from "../tools/registro"

export interface LlamadaVisible {
  nombre: string
  args: unknown
  ok: boolean
  resumen: string
  ms: number
  ruta?: string
}

export type EventoVisible =
  | { tipo: "usuario"; texto: string; ts: string }
  | { tipo: "agente"; texto: string; toolCalls: LlamadaVisible[]; needsConfirmation: boolean; ts: string }

export interface Sesion {
  id: string
  mensajes: Mensaje[]
  historial: EventoVisible[]
  pendienteConfirmacion: boolean
  tokens: number
}

export interface Config {
  directory: string
  llm: LlmAdapter
  maxIteraciones: number
  maxTokensSesion: number
}

export interface RespuestaTurno {
  reply: string
  toolCalls: LlamadaVisible[]
  needsConfirmation: boolean
  usage: { tokensSesion: number; maxTokensSesion: number }
}

const MARCA = "[[CONFIRMAR]]"
const AFIRMATIVO = /^\s*(s[ií]|confirmo|confirmado|adelante|procede|de acuerdo|ok|dale|hazlo|autorizo)(?=$|[\s,.!:;])/i

export const esAfirmativo = (t: string): boolean => AFIRMATIVO.test(t.trim())

export const nuevaSesion = (id: string): Sesion => ({ id, mensajes: [], historial: [], pendienteConfirmacion: false, tokens: 0 })

/** Comportamiento (prompt.md) + conocimiento (knowledge/*.md). Se relee en cada turno: editar reglas no requiere reiniciar. */
export function cargarSistema(directory: string): string {
  const prompt = readFileSync(join(directory, "agent", "prompt.md"), "utf8")
  const conocimiento = readFileSync(join(directory, "src", "knowledge", "registro-proveedor.md"), "utf8")
  return `${prompt}\n\n---\n\n# Conocimiento del proceso\n\n${conocimiento}`
}

function rutaDe(salida: string): string | undefined {
  try {
    const r = JSON.parse(salida) as { data?: { ruta?: unknown } }
    return typeof r.data?.ruta === "string" ? r.data.ruta : undefined
  } catch {
    return undefined
  }
}

export async function ejecutarTurno(sesion: Sesion, textoUsuario: string, cfg: Config): Promise<RespuestaTurno> {
  const ts = (): string => new Date().toISOString()
  // RN4: la confirmación solo vale si el turno ANTERIOR la pidió y ESTE mensaje es afirmativo. Caduca después.
  const confirmacionHumana = sesion.pendienteConfirmacion && esAfirmativo(textoUsuario)
  const habiaPendiente = sesion.pendienteConfirmacion
  sesion.pendienteConfirmacion = false
  sesion.historial.push({ tipo: "usuario", texto: textoUsuario, ts: ts() })

  const usage = (): RespuestaTurno["usage"] => ({ tokensSesion: sesion.tokens, maxTokensSesion: cfg.maxTokensSesion })
  const cerrar = (reply: string, toolCalls: LlamadaVisible[], needsConfirmation = false): RespuestaTurno => {
    sesion.pendienteConfirmacion = needsConfirmation
    sesion.historial.push({ tipo: "agente", texto: reply, toolCalls, needsConfirmation, ts: ts() })
    return { reply, toolCalls, needsConfirmation, usage: usage() }
  }

  if (sesion.tokens >= cfg.maxTokensSesion) {
    return cerrar(`Esta sesión alcanzó su presupuesto de ${cfg.maxTokensSesion.toLocaleString("es-CO")} tokens. Abre una sesión nueva para continuar.`, [])
  }

  const nota = confirmacionHumana
    ? "\n\n[nota del sistema: el usuario CONFIRMÓ explícitamente la acción propuesta en el turno anterior]"
    : habiaPendiente
      ? "\n\n[nota del sistema: el usuario NO confirmó la acción propuesta; no ejecutes acciones externas]"
      : ""
  sesion.mensajes.push({ rol: "user", texto: textoUsuario + nota })

  const sistema = cargarSistema(cfg.directory)
  const herramientas = definiciones()
  const llamadas: LlamadaVisible[] = []

  for (let i = 0; i < cfg.maxIteraciones; i++) {
    let resp
    try {
      resp = await cfg.llm.enviar(sistema, sesion.mensajes, herramientas)
    } catch (e) {
      const motivo = e instanceof ErrorLlm ? e.message : "error inesperado al consultar el modelo"
      // CA5: retiramos el mensaje sin respuesta para que la sesión quede consistente y se pueda reintentar.
      if (llamadas.length === 0) sesion.mensajes.pop()
      else sesion.mensajes.push({ rol: "assistant", texto: `(interrumpido: ${motivo})`, llamadas: [] })
      return cerrar(`⚠️ No pude completar la respuesta: ${motivo}. Tu sesión sigue activa; intenta de nuevo.`, llamadas)
    }
    sesion.tokens += resp.uso.entrada + resp.uso.salida
    sesion.mensajes.push({ rol: "assistant", texto: resp.texto, llamadas: resp.llamadas })

    if (resp.llamadas.length === 0) {
      const pide = resp.texto.includes(MARCA)
      const limpio = resp.texto.replaceAll(MARCA, "").trim()
      return cerrar(limpio || "(sin respuesta)", llamadas, pide)
    }

    const resultados: ResultadoHerramienta[] = []
    for (const l of resp.llamadas) {
      const r = await ejecutarHerramienta(l.nombre, l.args, { directory: cfg.directory, sessionId: sesion.id, confirmacionHumana })
      const visible: LlamadaVisible = { nombre: r.nombre, args: r.args, ok: r.ok, resumen: r.resumen, ms: r.ms }
      const ruta = rutaDe(r.salida)
      if (ruta) visible.ruta = ruta
      llamadas.push(visible)
      resultados.push({ id: l.id, nombre: l.nombre, contenido: r.salida, esError: !r.ok })
    }
    sesion.mensajes.push({ rol: "tool", resultados })

    if (sesion.tokens >= cfg.maxTokensSesion) {
      sesion.mensajes.push({ rol: "assistant", texto: "(presupuesto de tokens agotado)", llamadas: [] })
      return cerrar(`Alcancé el presupuesto de tokens de la sesión. Avance: ${llamadas.map((l) => `${l.nombre} → ${l.resumen}`).join(" · ")}`, llamadas)
    }
  }

  // CA1: tope alcanzado. Respondemos con lo que hay y lo que falta.
  sesion.mensajes.push({ rol: "assistant", texto: "(tope de iteraciones alcanzado)", llamadas: [] })
  const hechas = llamadas.map((l) => `- ${l.nombre}: ${l.ok ? "✔" : "✘"} ${l.resumen}`).join("\n")
  return cerrar(`Alcancé el tope de ${cfg.maxIteraciones} pasos en este turno. Esto es lo que alcancé a hacer:\n${hechas}\n\nPídeme que continúe para completar lo que falta.`, llamadas)
}
