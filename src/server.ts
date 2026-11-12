/**
 * Servidor HTTP (Bun). Solo transporte: expone la API del chat, sirve el front y los artefactos de out/.
 * El ciclo vive en src/agent/ciclo.ts; las reglas, en agent/ y src/knowledge/.
 */
import { existsSync, readdirSync, statSync } from "node:fs"
import { join, normalize, relative, resolve, sep } from "node:path"
import { ejecutarTurno, nuevaSesion, type Sesion } from "./agent/ciclo"
import { crearAdaptador } from "./llm"
import { CASO_VALIDO, listarCasos } from "./tools/dominio"

const directory = resolve(import.meta.dir, "..")
const llm = crearAdaptador(directory)
const cfg = {
  directory,
  llm,
  maxIteraciones: Number(process.env.MAX_ITERACIONES ?? 25),
  maxTokensSesion: Number(process.env.MAX_TOKENS_SESION ?? 200000),
}
const ACCESS_KEY = process.env.ACCESS_KEY // opcional: protege el link público
const MAX_SESIONES = 200
const sesiones = new Map<string, Sesion>()
const ocupadas = new Set<string>()
const ID_VALIDO = /^[A-Za-z0-9_-]{6,64}$/

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } })

function obtenerSesion(id: string): Sesion {
  let s = sesiones.get(id)
  if (!s) {
    if (sesiones.size >= MAX_SESIONES) {
      const masVieja = sesiones.keys().next().value
      if (masVieja) sesiones.delete(masVieja)
    }
    s = nuevaSesion(id)
    sesiones.set(id, s)
  }
  return s
}

const autorizado = (req: Request): boolean => !ACCESS_KEY || req.headers.get("x-access-key") === ACCESS_KEY

function listarArchivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listarArchivos(join(dir, e.name)) : [join(dir, e.name)]))
}

/** Sirve out/<caso>/... sin permitir salir de esa carpeta. */
function servirOut(rutaRel: string): Response {
  const partes = rutaRel.split("/").filter(Boolean)
  const caso = partes[0]
  if (!caso || !CASO_VALIDO.test(caso)) return json({ ok: false, error: "caso inválido" }, 400)
  const base = join(directory, "out", caso)
  const destino = normalize(join(base, ...partes.slice(1)))
  if (destino !== base && !destino.startsWith(base + sep)) return json({ ok: false, error: "ruta no permitida" }, 400)
  if (!existsSync(destino)) return json({ ok: false, error: "no existe (¿ya procesaste el caso?)" }, 404)
  if (statSync(destino).isDirectory()) {
    const archivos = listarArchivos(destino).map((f) => relative(base, f).split(sep).join("/")).sort()
    const links = archivos.map((a) => `<li><a href="/api/out/${caso}/${a}">${a}</a></li>`).join("")
    return new Response(`<!doctype html><meta charset="utf-8"><title>out/${caso}</title><body style="font-family:system-ui;padding:24px"><h2>out/${caso}</h2><ul>${links}</ul>`, {
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  }
  const nombre = destino.split(sep).pop() ?? "archivo"
  const inline = /\.(md|txt|json|jsonl|pdf)$/.test(nombre)
  const tipo = nombre.endsWith(".pdf") ? "application/pdf" : /\.(md|txt|jsonl?)$/.test(nombre) ? "text/plain; charset=utf-8" : "application/octet-stream"
  return new Response(Bun.file(destino), { headers: { "content-type": tipo, "content-disposition": `${inline ? "inline" : "attachment"}; filename="${nombre}"` } })
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url)
    const p = url.pathname

    if (p === "/" || p === "/index.html") return new Response(Bun.file(join(directory, "web", "index.html")))
    if (p === "/api/health") return json({ ok: true, provider: llm.proveedor, model: llm.modelo, protegido: Boolean(ACCESS_KEY) })
    if (p === "/api/casos") return json({ ok: true, casos: listarCasos(directory) })
    if (p.startsWith("/api/out/")) return servirOut(decodeURIComponent(p.slice("/api/out/".length)))

    if (p.startsWith("/api/sessions/") && req.method === "GET") {
      const id = p.slice("/api/sessions/".length)
      const s = sesiones.get(id)
      return s ? json({ ok: true, id, historial: s.historial, tokens: s.tokens }) : json({ ok: false, error: "sesión no encontrada" }, 404)
    }

    if (p === "/api/chat" && req.method === "POST") {
      if (!autorizado(req)) return json({ ok: false, error: "clave de acceso inválida" }, 401)
      let body: { sessionId?: unknown; message?: unknown }
      try {
        body = (await req.json()) as { sessionId?: unknown; message?: unknown }
      } catch {
        return json({ ok: false, error: "cuerpo JSON inválido" }, 400)
      }
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
      const message = typeof body.message === "string" ? body.message.trim() : ""
      if (!ID_VALIDO.test(sessionId)) return json({ ok: false, error: "sessionId inválido" }, 400)
      if (!message || message.length > 4000) return json({ ok: false, error: "mensaje vacío o demasiado largo (máx. 4000)" }, 400)
      if (ocupadas.has(sessionId)) return json({ ok: false, error: "la sesión está procesando otro mensaje" }, 409)

      ocupadas.add(sessionId)
      try {
        const r = await ejecutarTurno(obtenerSesion(sessionId), message, cfg)
        return json({ ok: true, ...r })
      } catch {
        return json({ ok: true, reply: "⚠️ Ocurrió un error interno. La sesión sigue activa; intenta de nuevo.", toolCalls: [], needsConfirmation: false })
      } finally {
        ocupadas.delete(sessionId)
      }
    }
    return json({ ok: false, error: "ruta no encontrada" }, 404)
  },
})

console.log(`Agente Registro Proveedor en http://localhost:${server.port} · proveedor=${llm.proveedor} · modelo=${llm.modelo}`)
