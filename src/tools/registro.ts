/**
 * Registro de herramientas: descubre los exports de cada módulo, valida con zod, ejecuta,
 * captura cualquier excepción (HU5.2) y deja trazas en out/<caso>/log.jsonl (RN5) y out/log.jsonl (CA4).
 * Lo usan por igual el servidor, demo.ts y el módulo reutilizable.
 */
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { CASO_VALIDO, listarCasos, rutas } from "./dominio"
import * as proveedor from "./proveedor"
import type { Herramienta, ToolCtx } from "./tipos"

type HerramientaGenerica = Herramienta<z.ZodRawShape>

export interface DefinicionHerramienta {
  nombre: string
  descripcion: string
  /** JSON Schema de los argumentos, derivado de zod (lo consume el adaptador LLM). */
  esquema: Record<string, unknown>
}

export interface ResultadoEjecucion {
  nombre: string
  args: unknown
  ok: boolean
  /** String JSON tal cual lo devolvió la herramienta (lo que ve el modelo). */
  salida: string
  resumen: string
  ms: number
}

const MODULOS: Record<string, Record<string, unknown>> = { proveedor }

const esHerramienta = (x: unknown): x is HerramientaGenerica =>
  typeof x === "object" && x !== null && "execute" in x && "args" in x && "description" in x

function construirRegistro(): Map<string, HerramientaGenerica> {
  const mapa = new Map<string, HerramientaGenerica>()
  for (const [archivo, mod] of Object.entries(MODULOS)) {
    for (const [exp, valor] of Object.entries(mod)) {
      if (esHerramienta(valor)) mapa.set(`${archivo}_${exp}`, valor)
    }
  }
  return mapa
}

export const REGISTRO = construirRegistro()

export function definiciones(): DefinicionHerramienta[] {
  return [...REGISTRO.entries()].map(([nombre, h]) => ({
    nombre,
    descripcion: h.description,
    esquema: z.toJSONSchema(z.object(h.args)) as Record<string, unknown>,
  }))
}

function resumir(salida: string): { ok: boolean; resumen: string } {
  try {
    const r = JSON.parse(salida) as { ok?: unknown; error?: unknown; data?: { resumen?: unknown } }
    const ok = r.ok === true
    const resumen = ok ? String(r.data?.resumen ?? "ok") : String(r.error ?? "error")
    return { ok, resumen }
  } catch {
    return { ok: false, resumen: "salida no JSON" }
  }
}

function registrarLog(ctx: ToolCtx, nombre: string, args: unknown, ok: boolean, resumen: string, ms: number): void {
  try {
    const ts = new Date().toISOString()
    const out = rutas(ctx.directory).out
    mkdirSync(out, { recursive: true })
    const caso = typeof args === "object" && args !== null && "caso" in args ? String((args as { caso: unknown }).caso) : null
    // Global (CA4): sesión + herramienta. No guardamos args completos para no registrar valores sensibles.
    appendFileSync(join(out, "log.jsonl"), `${JSON.stringify({ ts, sessionId: ctx.sessionId, herramienta: nombre, caso, ok, resumen, ms })}\n`)
    // Por caso (RN5): solo si el caso existe, para no crear carpetas basura.
    if (caso && CASO_VALIDO.test(caso) && listarCasos(ctx.directory).includes(caso)) {
      const dir = rutas(ctx.directory).outCaso(caso)
      mkdirSync(dir, { recursive: true })
      appendFileSync(join(dir, "log.jsonl"), `${JSON.stringify({ ts, herramienta: nombre, ok, resumen })}\n`)
    }
  } catch {
    // El log nunca debe tumbar la ejecución.
  }
}

/** Punto único de ejecución. Nunca lanza. */
export async function ejecutarHerramienta(nombre: string, argsCrudos: unknown, ctx: ToolCtx): Promise<ResultadoEjecucion> {
  const inicio = Date.now()
  const h = REGISTRO.get(nombre)
  let salida: string
  if (!h) {
    salida = JSON.stringify({ ok: false, error: `herramienta desconocida: ${nombre}. Disponibles: ${[...REGISTRO.keys()].join(", ")}` })
  } else {
    const v = z.object(h.args).safeParse(argsCrudos ?? {})
    if (!v.success) {
      const detalle = v.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")
      salida = JSON.stringify({ ok: false, error: `argumentos inválidos (${detalle})` })
    } else {
      try {
        salida = await h.execute(v.data, ctx)
      } catch (e) {
        const msg = e instanceof Error ? e.message : "error desconocido"
        salida = JSON.stringify({ ok: false, error: `la herramienta falló de forma inesperada: ${msg}` })
      }
    }
  }
  const { ok, resumen } = resumir(salida)
  const ms = Date.now() - inicio
  registrarLog(ctx, nombre, argsCrudos, ok, resumen, ms)
  return { nombre, args: argsCrudos, ok, salida, resumen, ms }
}
