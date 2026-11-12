/**
 * Lógica de dominio pura (sin HTTP, sin modelo). Las herramientas de proveedor.ts la orquestan.
 * Nada aquí lanza hacia el agente: las funciones devuelven Resultado.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import reglasJson from "../knowledge/reglas.json"
import type { Resultado } from "./tipos"

// ───────────────────────────── Esquemas de fixtures ─────────────────────────────

const SolicitudSchema = z.object({
  id: z.string(),
  de: z.string(),
  para: z.string().optional(),
  asunto: z.string(),
  fecha: z.string(),
  pais: z.string(),
  cliente: z.string(),
  cuerpo: z.string(),
  formato: z.enum(["xlsx", "pdf", "portal"]),
  adjuntos: z.array(z.string()),
})
const CeldaSchema = z.object({ hoja: z.string(), celda_etiqueta: z.string(), etiqueta: z.string(), celda_valor: z.string() })
const CampoPdfSchema = z.object({ etiqueta: z.string(), obligatorio: z.boolean() })
const SoporteIndexSchema = z.object({
  tipo: z.string(),
  archivo: z.string(),
  vigencia_hasta: z.string().nullable(),
  pais_emisor: z.string(),
  descripcion: z.string().optional(),
})

export type Solicitud = z.infer<typeof SolicitudSchema>
export type SoporteIndex = z.infer<typeof SoporteIndexSchema>
export type Formato = Solicitud["formato"]

export interface CampoSolicitado {
  etiqueta: string
  obligatorio: boolean
  hoja?: string
  celda_etiqueta?: string
  celda_valor?: string
}

export type EstadoCampo = "lleno" | "faltante" | "requiere_confirmacion"
export type Valor = string | number | boolean | null

export interface CampoMapeado {
  etiqueta: string
  estado: EstadoCampo
  ruta: string | null
  valor: Valor
  confianza: number
  obligatorio: boolean
  sensible: boolean
  nota?: string
}

export interface CasoCargado {
  caso: string
  solicitud: Solicitud
  campos: CampoSolicitado[]
  soportesExigidos: string[]
  /** Error no fatal (p. ej. plantilla corrupta): el caso se puede procesar parcialmente. */
  errorPlantilla?: string
}

export type Maestro = Record<string, unknown>

export const reglas = reglasJson

// ───────────────────────────── Rutas y lectura segura ─────────────────────────────

export const CASO_VALIDO = /^[a-z0-9][a-z0-9-]{0,80}$/

export const rutas = (dir: string) => ({
  fixtures: join(dir, "fixtures", "reto-01"),
  casos: join(dir, "fixtures", "reto-01", "casos"),
  maestro: join(dir, "fixtures", "reto-01", "repositorio", "maestro.json"),
  soportes: join(dir, "fixtures", "reto-01", "repositorio", "soportes"),
  glosario: join(dir, "fixtures", "reto-01", "glosario-campos.json"),
  out: join(dir, "out"),
  outCaso: (caso: string) => join(dir, "out", caso),
})

function leerJson(ruta: string): Resultado<unknown> {
  if (!existsSync(ruta)) return { ok: false, error: `no existe el archivo ${nombreCorto(ruta)}` }
  try {
    return { ok: true, data: JSON.parse(readFileSync(ruta, "utf8")) as unknown }
  } catch {
    return { ok: false, error: `el archivo ${nombreCorto(ruta)} está corrupto (JSON inválido)` }
  }
}

const nombreCorto = (ruta: string): string => ruta.split(/[\\/]/).slice(-2).join("/")

export function listarCasos(dir: string): string[] {
  const d = rutas(dir).casos
  if (!existsSync(d)) return []
  return readdirSync(d, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

export function cargarMaestro(dir: string): Resultado<Maestro> {
  const r = leerJson(rutas(dir).maestro)
  if (!r.ok) return { ok: false, error: `repositorio maestro: ${r.error}` }
  const p = z.record(z.string(), z.unknown()).safeParse(r.data)
  return p.success ? { ok: true, data: p.data } : { ok: false, error: "repositorio maestro con formato inválido" }
}

export function cargarGlosario(dir: string): Resultado<Record<string, string>> {
  const r = leerJson(rutas(dir).glosario)
  if (!r.ok) return { ok: false, error: `glosario: ${r.error}` }
  const p = z.record(z.string(), z.string()).safeParse(r.data)
  return p.success ? { ok: true, data: p.data } : { ok: false, error: "glosario con formato inválido" }
}

export function cargarIndiceSoportes(dir: string): Resultado<SoporteIndex[]> {
  const r = leerJson(join(rutas(dir).soportes, "index.json"))
  if (!r.ok) return { ok: false, error: `índice de soportes: ${r.error}` }
  const p = z.array(SoporteIndexSchema).safeParse(r.data)
  return p.success ? { ok: true, data: p.data } : { ok: false, error: "índice de soportes con formato inválido" }
}

export function cargarCaso(dir: string, caso: string): Resultado<CasoCargado> {
  if (!CASO_VALIDO.test(caso)) {
    return { ok: false, error: `nombre de caso inválido: "${caso}". Usa solo minúsculas, números y guiones.` }
  }
  const base = join(rutas(dir).casos, caso)
  if (!existsSync(base)) {
    const disponibles = listarCasos(dir).join(", ") || "ninguno"
    return { ok: false, error: `el caso "${caso}" no existe. Casos disponibles: ${disponibles}` }
  }

  const sol = leerJson(join(base, "solicitud.json"))
  if (!sol.ok) return { ok: false, error: `solicitud: ${sol.error}` }
  const solP = SolicitudSchema.safeParse(sol.data)
  if (!solP.success) return { ok: false, error: "solicitud.json no tiene la estructura esperada" }
  const solicitud = solP.data

  const sop = leerJson(join(base, "soportes-exigidos.json"))
  const sopP = sop.ok ? z.array(z.string()).safeParse(sop.data) : null
  const soportesExigidos = sopP?.success ? sopP.data : []

  const plantilla = cargarPlantilla(base, solicitud.formato)
  const cargado: CasoCargado = { caso, solicitud, soportesExigidos, campos: plantilla.ok ? plantilla.data : [] }
  if (!plantilla.ok) cargado.errorPlantilla = plantilla.error
  if (!sopP?.success) cargado.errorPlantilla = [cargado.errorPlantilla, "soportes-exigidos.json ilegible"].filter(Boolean).join("; ")
  return { ok: true, data: cargado }
}

function cargarPlantilla(base: string, formato: Formato): Resultado<CampoSolicitado[]> {
  const rutaCeldas = join(base, "plantilla-celdas.json")
  const rutaCampos = join(base, "plantilla-campos.json")
  if (formato === "xlsx" || (formato === "portal" && existsSync(rutaCeldas))) {
    const r = leerJson(rutaCeldas)
    if (!r.ok) return { ok: false, error: `plantilla Excel: ${r.error}` }
    const p = z.array(CeldaSchema).min(1).safeParse(r.data)
    if (!p.success) return { ok: false, error: "plantilla Excel corrupta: faltan hoja, celda o etiqueta" }
    return { ok: true, data: p.data.map((c) => ({ ...c, obligatorio: true })) }
  }
  const r = leerJson(rutaCampos)
  if (!r.ok) return { ok: false, error: `plantilla de campos: ${r.error}` }
  const p = z.array(CampoPdfSchema).min(1).safeParse(r.data)
  if (!p.success) return { ok: false, error: "plantilla de campos corrupta: faltan etiqueta u obligatorio" }
  return { ok: true, data: p.data }
}

// ───────────────────────────── Motor de mapeo (HU2 / RN1) ─────────────────────────────

const STOPWORDS = new Set(["de", "del", "la", "el", "los", "las", "y", "o", "en", "para", "por"])

export const normalizar = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

const tokens = (s: string): Set<string> => new Set(normalizar(s).split(" ").filter((t) => t.length > 1 && !STOPWORDS.has(t)))

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

export function valorEnRuta(maestro: Maestro, ruta: string): Valor | undefined {
  let actual: unknown = maestro
  for (const parte of ruta.split(".")) {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return undefined
    actual = (actual as Record<string, unknown>)[parte]
  }
  if (actual === null) return null
  if (typeof actual === "string" || typeof actual === "number" || typeof actual === "boolean") return actual
  return undefined // objetos/arreglos no son un valor de campo
}

interface Candidato {
  ruta: string
  confianza: number
  via: string
}

function buscarRuta(etiqueta: string, glosario: Record<string, string>, maestro: Maestro): Candidato | null {
  const exacta = glosario[etiqueta]
  if (exacta) return { ruta: exacta, confianza: reglas.confianza.glosario_exacto, via: "glosario" }

  const n = normalizar(etiqueta)
  for (const [k, ruta] of Object.entries(glosario)) {
    if (normalizar(k) === n) return { ruta, confianza: reglas.confianza.glosario_normalizado, via: `glosario normalizado ("${k}")` }
  }

  const clave = n.replace(/ /g, "_")
  if (valorEnRuta(maestro, clave) !== undefined) return { ruta: clave, confianza: reglas.confianza.clave_maestro, via: "clave del maestro" }

  const te = tokens(etiqueta)
  let mejor: Candidato | null = null
  for (const [k, ruta] of Object.entries(glosario)) {
    const s = jaccard(te, tokens(k))
    if (!mejor || s > mejor.confianza) mejor = { ruta, confianza: Math.round(s * 100) / 100, via: `similitud con "${k}"` }
  }
  return mejor && mejor.confianza >= reglas.umbrales.minimo_propuesta ? mejor : null
}

const esSensible = (ruta: string | null): boolean => ruta !== null && reglas.rutas_sensibles.includes(ruta)
export const esBancaria = (ruta: string | null): boolean => ruta !== null && ruta.startsWith(reglas.prefijo_rutas_bancarias)

export function equivalenteTributario(pais: string): string {
  const mapa: Record<string, string> = reglas.identificador_tributario_por_pais
  return mapa[pais] ?? "identificador tributario local"
}

export const esEtiquetaTributaria = (etiqueta: string): boolean =>
  reglas.etiquetas_tributarias.some((e) => normalizar(e) === normalizar(etiqueta))

export const esEtiquetaAmbigua = (etiqueta: string): boolean =>
  reglas.etiquetas_tributarias_ambiguas.some((e) => normalizar(e) === normalizar(etiqueta))

/** RN1: regla de país para identificadores tributarios. */
function mapearTributario(campo: CampoSolicitado, pais: string, maestro: Maestro): CampoMapeado {
  const ruta = reglas.ruta_identificador_tributario
  const valor = valorEnRuta(maestro, ruta)
  const equivalente = equivalenteTributario(pais)
  const base = { etiqueta: campo.etiqueta, ruta, obligatorio: campo.obligatorio, sensible: false }
  if (valor === undefined || valor === null) {
    return { ...base, estado: "faltante", valor: null, confianza: 0, nota: "el maestro no tiene identificador tributario" }
  }
  const etiquetaCoincide = normalizar(campo.etiqueta) === normalizar(equivalente)
  if (pais === reglas.pais_base_maestro && etiquetaCoincide) {
    return { ...base, estado: "lleno", valor, confianza: 1 }
  }
  const nota =
    pais !== reglas.pais_base_maestro
      ? `${reglas.nota_identificador_extranjero}: el cliente (${pais}) pide ${equivalente}; se propone el NIT colombiano`
      : `etiqueta ambigua; equivalente en ${pais}: ${equivalente}`
  return { ...base, estado: "requiere_confirmacion", valor, confianza: 0.6, nota }
}

export function mapearCampo(campo: CampoSolicitado, pais: string, glosario: Record<string, string>, maestro: Maestro): CampoMapeado {
  if (esEtiquetaTributaria(campo.etiqueta)) return mapearTributario(campo, pais, maestro)

  const cand = buscarRuta(campo.etiqueta, glosario, maestro)
  const base = { etiqueta: campo.etiqueta, obligatorio: campo.obligatorio }
  if (!cand) {
    return { ...base, estado: "faltante", ruta: null, valor: null, confianza: 0, sensible: false, nota: "sin equivalente en el maestro" }
  }
  const valor = valorEnRuta(maestro, cand.ruta)
  const sensible = esSensible(cand.ruta)
  if (valor === undefined || valor === null || valor === "") {
    return { ...base, estado: "faltante", ruta: cand.ruta, valor: null, confianza: cand.confianza, sensible, nota: `la ruta "${cand.ruta}" no tiene valor en el maestro` }
  }
  if (cand.confianza >= reglas.umbrales.lleno) {
    return { ...base, estado: "lleno", ruta: cand.ruta, valor, confianza: cand.confianza, sensible }
  }
  return { ...base, estado: "requiere_confirmacion", ruta: cand.ruta, valor, confianza: cand.confianza, sensible, nota: `mapeo de baja confianza por ${cand.via}` }
}

export interface Mapeo {
  llenos: CampoMapeado[]
  faltantes: CampoMapeado[]
  requiere_confirmacion: CampoMapeado[]
  /** Todos los campos, en el orden de la plantilla (útil para generar). */
  orden: CampoMapeado[]
}

export function mapearCampos(campos: CampoSolicitado[], pais: string, glosario: Record<string, string>, maestro: Maestro): Mapeo {
  const orden = campos.map((c) => mapearCampo(c, pais, glosario, maestro))
  return {
    orden,
    llenos: orden.filter((c) => c.estado === "lleno"),
    faltantes: orden.filter((c) => c.estado === "faltante"),
    requiere_confirmacion: orden.filter((c) => c.estado === "requiere_confirmacion"),
  }
}

/** RN2 / A9: enmascara datos sensibles antes de que salgan hacia el modelo, el chat o los logs. */
export function enmascarar(valor: Valor): Valor {
  if (valor === null || typeof valor === "boolean") return valor
  const s = String(valor)
  if (s.length <= 6) return "*".repeat(s.length)
  return `${s.slice(0, 3)}${"*".repeat(s.length - 6)}${s.slice(-3)}`
}

export const paraSalida = (c: CampoMapeado): CampoMapeado => (c.sensible ? { ...c, valor: enmascarar(c.valor) } : c)

// ───────────────────────────── Soportes (HU4 / RN3) ─────────────────────────────

export type EstadoSoporte = "presente" | "vencido" | "ausente"

export interface SoporteEvaluado {
  tipo: string
  nombre: string
  estado: EstadoSoporte
  archivo: string | null
  vigencia_hasta: string | null
  pais_emisor: string | null
  nota?: string
}

export function fechaEjecucion(override?: string): string {
  const f = override ?? process.env.FECHA_EJECUCION
  if (f && /^\d{4}-\d{2}-\d{2}$/.test(f)) return f
  return new Date().toLocaleDateString("en-CA") // YYYY-MM-DD en la zona horaria local (TZ)
}

export function evaluarSoportes(exigidos: string[], indice: SoporteIndex[], fecha: string, paisCliente: string, dir: string): SoporteEvaluado[] {
  const nombres: Record<string, string> = reglas.nombres_soportes
  return exigidos.map((tipo) => {
    const nombre = nombres[tipo] ?? tipo
    const s = indice.find((i) => i.tipo === tipo)
    if (!s || !existsSync(join(rutas(dir).soportes, s.archivo))) {
      return { tipo, nombre, estado: "ausente", archivo: null, vigencia_hasta: null, pais_emisor: null, nota: "no existe en el repositorio de soportes" }
    }
    const vencido = s.vigencia_hasta !== null && s.vigencia_hasta < fecha
    const notas: string[] = []
    if (vencido) notas.push(`venció el ${s.vigencia_hasta}; solicitar uno actualizado`)
    if (s.pais_emisor !== paisCliente) notas.push(`emitido en ${s.pais_emisor}; el cliente es de ${paisCliente}`)
    const ev: SoporteEvaluado = {
      tipo,
      nombre,
      estado: vencido ? "vencido" : "presente",
      archivo: s.archivo,
      vigencia_hasta: s.vigencia_hasta,
      pais_emisor: s.pais_emisor,
    }
    if (notas.length) ev.nota = notas.join("; ")
    return ev
  })
}

export const nombrePais = (pais: string): string => {
  const m: Record<string, string> = reglas.nombres_paises
  return m[pais] ?? pais
}
