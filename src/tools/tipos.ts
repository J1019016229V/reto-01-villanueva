import type { z } from "zod"

/** Contexto que el host (servidor, demo o plataforma externa) entrega a cada herramienta. */
export interface ToolCtx {
  /** Raíz del proyecto. Todas las rutas se resuelven desde aquí, nunca absolutas. */
  directory: string
  sessionId: string
  /**
   * Compuerta RN4 calculada por el host: true solo si el turno anterior pidió confirmación
   * y el mensaje actual del usuario es afirmativo. `undefined` = el host no aplica compuerta (p. ej. demo.ts).
   */
  confirmacionHumana?: boolean
  /** Fecha de ejecución YYYY-MM-DD para evaluar vigencias. Por defecto: hoy o FECHA_EJECUCION. */
  fechaEjecucion?: string
}

/** Forma obligatoria de toda herramienta (PRD §6.2). */
export interface Herramienta<S extends z.ZodRawShape> {
  description: string
  args: S
  execute(args: z.infer<z.ZodObject<S>>, ctx: ToolCtx): Promise<string>
}

export type Resultado<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; data?: Partial<T> | Record<string, unknown> }

export const exito = <T>(data: T): string => JSON.stringify({ ok: true, data } satisfies Resultado<T>)

export const fallo = (error: string, data?: Record<string, unknown>): string =>
  JSON.stringify(data ? { ok: false, error, data } : { ok: false, error })

/** Ayuda de tipado para declarar herramientas sin perder la inferencia de `args`. */
export const definirHerramienta = <S extends z.ZodRawShape>(h: Herramienta<S>): Herramienta<S> => h
