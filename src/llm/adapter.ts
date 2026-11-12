/**
 * Interfaz propia de proveedor LLM (PRD §6.1): `enviar(mensajes, herramientas) → respuesta`.
 * El ciclo del agente solo conoce estos tipos neutrales; cambiar de proveedor = otra implementación.
 */
import type { DefinicionHerramienta } from "../tools/registro"

export interface LlamadaHerramienta {
  id: string
  nombre: string
  args: unknown
}

export interface ResultadoHerramienta {
  id: string
  nombre: string
  contenido: string
  esError: boolean
}

export type Mensaje =
  | { rol: "user"; texto: string }
  | { rol: "assistant"; texto: string; llamadas: LlamadaHerramienta[] }
  | { rol: "tool"; resultados: ResultadoHerramienta[] }

export interface RespuestaLlm {
  texto: string
  llamadas: LlamadaHerramienta[]
  uso: { entrada: number; salida: number }
}

export interface LlmAdapter {
  readonly proveedor: string
  readonly modelo: string
  enviar(sistema: string, mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLlm>
}

/** Error de proveedor con mensaje apto para mostrar al usuario (CA5). */
export class ErrorLlm extends Error {
  constructor(mensajeUsuario: string) {
    super(mensajeUsuario)
    this.name = "ErrorLlm"
  }
}

/** fetch con timeout (NF5). Traduce fallos de red y HTTP a ErrorLlm sin exponer cuerpos ni claves. */
export async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal })
    if (!res.ok) {
      const motivo =
        res.status === 401 || res.status === 403
          ? "la clave del proveedor es inválida o no tiene permisos"
          : res.status === 429
            ? "el proveedor limitó la tasa de peticiones; intenta en un minuto"
            : res.status >= 500
              ? "el proveedor del modelo no está disponible en este momento"
              : `el proveedor rechazó la petición (HTTP ${res.status})`
      throw new ErrorLlm(motivo)
    }
    return (await res.json()) as unknown
  } catch (e) {
    if (e instanceof ErrorLlm) throw e
    if (e instanceof Error && e.name === "AbortError") throw new ErrorLlm(`el modelo no respondió en ${Math.round(timeoutMs / 1000)} s (timeout)`)
    throw new ErrorLlm("no fue posible conectar con el proveedor del modelo")
  } finally {
    clearTimeout(t)
  }
}

/** Quita metadatos de JSON Schema que algunos proveedores no aceptan. */
export function esquemaLimpio(esquema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _omit, ...resto } = esquema
  return resto
}
