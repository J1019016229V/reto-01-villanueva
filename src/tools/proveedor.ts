/**
 * Herramientas del agente de registro como proveedor (PRD §6.2).
 * Cada export es una herramienta; el modelo la ve como `proveedor_<export>`.
 * Reglas: argumentos con zod, salida string JSON { ok, data } | { ok:false, error }, nunca lanzan
 * (el envoltorio de registro.ts captura además cualquier excepción imprevista).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import {
  cargarCaso,
  cargarGlosario,
  cargarIndiceSoportes,
  cargarMaestro,
  equivalenteTributario,
  esBancaria,
  esEtiquetaAmbigua,
  esEtiquetaTributaria,
  evaluarSoportes,
  fechaEjecucion,
  mapearCampos,
  paraSalida,
  rutas,
  type CasoCargado,
  type Maestro,
  type Mapeo,
} from "./dominio"
import { generarBorrador, generarChecklist, generarEnvioSimulado, generarPdf, generarValoresPortal, generarXlsx } from "./generadores"
import { definirHerramienta, exito, fallo, type ToolCtx } from "./tipos"

const argCaso = z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/ (ej. co-industrias-delta)")

const rel = (caso: string, ...partes: string[]): string => ["out", caso, ...partes].join("/")

interface Contexto {
  caso: CasoCargado
  maestro: Maestro
  glosario: Record<string, string>
  mapeo: Mapeo
}

/** Carga caso + maestro + glosario y calcula el mapeo. Única fuente de valores (CA2). */
function prepararContexto(ctx: ToolCtx, caso: string, etiquetas?: string[]): { ok: true; data: Contexto } | { ok: false; error: string } {
  const c = cargarCaso(ctx.directory, caso)
  if (!c.ok) return c
  const m = cargarMaestro(ctx.directory)
  if (!m.ok) return m
  const g = cargarGlosario(ctx.directory)
  if (!g.ok) return g
  const campos = etiquetas?.length
    ? etiquetas.map((e) => c.data.campos.find((x) => x.etiqueta === e) ?? { etiqueta: e, obligatorio: false })
    : c.data.campos
  return { ok: true, data: { caso: c.data, maestro: m.data, glosario: g.data, mapeo: mapearCampos(campos, c.data.solicitud.pais, g.data, m.data) } }
}

const conteo = (m: Mapeo): string => `${m.llenos.length} llenos, ${m.faltantes.length} faltantes, ${m.requiere_confirmacion.length} por confirmar`

/** Genera el formulario del formato pedido. Devuelve ruta relativa o error de formato no soportado. */
async function producirFormulario(ctx: ToolCtx, cx: Contexto): Promise<{ ok: true; ruta: string } | { ok: false; error: string; ruta: string }> {
  const { solicitud, campos, caso } = cx.caso
  const out = rutas(ctx.directory).outCaso(caso)
  const fecha = fechaEjecucion(ctx.fechaEjecucion)
  if (solicitud.formato === "xlsx") {
    await generarXlsx(join(out, "formulario.xlsx"), campos, cx.mapeo.orden, fecha)
    return { ok: true, ruta: rel(caso, "formulario.xlsx") }
  }
  if (solicitud.formato === "pdf") {
    await generarPdf(join(out, "formulario.pdf"), solicitud, cx.mapeo.orden, fecha)
    return { ok: true, ruta: rel(caso, "formulario.pdf") }
  }
  generarValoresPortal(join(out, "valores-portal.md"), solicitud, cx.mapeo.orden)
  return {
    ok: false,
    ruta: rel(caso, "valores-portal.md"),
    error: `formato no soportado: el cliente usa un portal web. Generé los valores listos para copiar en ${rel(caso, "valores-portal.md")}`,
  }
}

// ═════════════════════════════ HU-1 ═════════════════════════════

export const leer_solicitud = definirHerramienta({
  description: "Lee la solicitud de registro de un caso y devuelve país, cliente, formato de salida, campos pedidos y soportes exigidos.",
  args: { caso: argCaso },
  async execute(args, ctx) {
    const c = cargarCaso(ctx.directory, args.caso)
    if (!c.ok) return fallo(c.error)
    const { solicitud, campos, soportesExigidos, errorPlantilla } = c.data
    const ambiguos = campos
      .filter((x) => esEtiquetaAmbigua(x.etiqueta) || (esEtiquetaTributaria(x.etiqueta) && solicitud.pais !== "CO"))
      .map((x) => ({ etiqueta: x.etiqueta, estado: "requiere_confirmacion", equivalente_pais: equivalenteTributario(solicitud.pais) }))
    const data = {
      caso: args.caso,
      pais: solicitud.pais,
      cliente: solicitud.cliente,
      remitente: solicitud.de,
      asunto: solicitud.asunto,
      fecha: solicitud.fecha,
      formato: solicitud.formato,
      campos: campos.map((x) => x.etiqueta),
      soportes: soportesExigidos,
      ambiguos,
      resumen: `${solicitud.cliente} (${solicitud.pais}) · formato ${solicitud.formato} · ${campos.length} campos · ${soportesExigidos.length} soportes`,
    }
    if (errorPlantilla) return fallo(`${errorPlantilla}. Puedo continuar con los soportes, pero no con el formulario.`, data)
    return exito(data)
  },
})

// ═════════════════════════════ HU-2 ═════════════════════════════

export const mapear_campos = definirHerramienta({
  description: "Cruza los campos pedidos con el repositorio maestro y clasifica cada uno en lleno, faltante o requiere_confirmacion, sin inventar valores.",
  args: {
    caso: argCaso,
    campos: z.array(z.string()).optional().describe("Etiquetas a mapear; si se omite, se usan todas las de la plantilla del caso"),
  },
  async execute(args, ctx) {
    const p = prepararContexto(ctx, args.caso, args.campos)
    if (!p.ok) return fallo(p.error)
    const { mapeo, caso } = p.data
    if (mapeo.orden.length === 0) return fallo(caso.errorPlantilla ?? "la plantilla no tiene campos")
    const out = rutas(ctx.directory).outCaso(args.caso)
    mkdirSync(out, { recursive: true })
    // Persistimos el mapeo sin enmascarar solo en disco local (no sale al modelo).
    writeFileSync(join(out, "mapeo.json"), JSON.stringify(mapeo.orden, null, 2))
    return exito({
      llenos: mapeo.llenos.map(paraSalida),
      faltantes: mapeo.faltantes.map(paraSalida),
      requiere_confirmacion: mapeo.requiere_confirmacion.map(paraSalida),
      incluye_datos_bancarios: mapeo.orden.some((c) => esBancaria(c.ruta)),
      resumen: conteo(mapeo),
    })
  },
})

// ═════════════════════════════ HU-3 ═════════════════════════════

const MapeoReferencia = z
  .object({ llenos: z.array(z.unknown()), faltantes: z.array(z.unknown()), requiere_confirmacion: z.array(z.unknown()) })
  .partial()
  .passthrough()

export const generar_formulario = definirHerramienta({
  description: "Genera el formulario lleno en el formato del cliente (xlsx o pdf) en out/<caso>/; si es portal web, responde formato no soportado y genera valores-portal.md.",
  args: {
    caso: argCaso,
    mapeo: MapeoReferencia.optional().describe(
      "Opcional y solo informativo: los valores SIEMPRE se recalculan desde el maestro para que nunca provengan del modelo",
    ),
  },
  async execute(args, ctx) {
    const p = prepararContexto(ctx, args.caso)
    if (!p.ok) return fallo(p.error)
    if (p.data.caso.errorPlantilla || p.data.mapeo.orden.length === 0) {
      return fallo(`no puedo generar el formulario: ${p.data.caso.errorPlantilla ?? "plantilla vacía"}`)
    }
    const r = await producirFormulario(ctx, p.data)
    const formato = p.data.caso.solicitud.formato
    if (!r.ok) return fallo(r.error, { ruta: r.ruta, formato, resumen: "portal: formato no soportado; valores-portal.md generado" })
    return exito({ ruta: r.ruta, formato, campos: conteo(p.data.mapeo), resumen: `${formato} generado en ${r.ruta}` })
  },
})

// ═════════════════════════════ HU-4 ═════════════════════════════

export const armar_paquete = definirHerramienta({
  description: "Arma out/<caso>/paquete/ con formulario, soportes, checklist.md y borrador-correo.md, y determina si está listo para firma.",
  args: { caso: argCaso },
  async execute(args, ctx) {
    const p = prepararContexto(ctx, args.caso)
    if (!p.ok) return fallo(p.error)
    const cx = p.data
    const { solicitud, soportesExigidos } = cx.caso
    const idx = cargarIndiceSoportes(ctx.directory)
    if (!idx.ok) return fallo(idx.error)

    const fecha = fechaEjecucion(ctx.fechaEjecucion)
    const outCaso = rutas(ctx.directory).outCaso(args.caso)
    const paquete = join(outCaso, "paquete")
    mkdirSync(paquete, { recursive: true })
    const adjuntos: string[] = []
    const bloqueos: string[] = []

    // 1. Formulario (lo genera si no existe todavía)
    let formulario = "—"
    if (!cx.caso.errorPlantilla && cx.mapeo.orden.length > 0) {
      const f = await producirFormulario(ctx, cx)
      const nombre = f.ruta.split("/").pop() ?? "formulario"
      copyFileSync(join(ctx.directory, f.ruta), join(paquete, nombre))
      formulario = rel(args.caso, "paquete", nombre)
      adjuntos.push(nombre)
    } else {
      bloqueos.push(`formulario no generado: ${cx.caso.errorPlantilla ?? "plantilla vacía"}`)
    }

    // 2. Soportes (RN3)
    const soportes = evaluarSoportes(soportesExigidos, idx.data, fecha, solicitud.pais, ctx.directory)
    for (const s of soportes) {
      if (s.archivo) {
        copyFileSync(join(rutas(ctx.directory).soportes, s.archivo), join(paquete, s.archivo))
        adjuntos.push(s.archivo)
      }
      if (s.estado === "vencido") bloqueos.push(`soporte vencido: ${s.nombre} (venció ${s.vigencia_hasta})`)
      if (s.estado === "ausente") bloqueos.push(`soporte ausente: ${s.nombre}`)
    }
    const listo = bloqueos.length === 0

    // 3. Checklist y borrador (RN2: sin datos bancarios)
    generarChecklist(join(paquete, "checklist.md"), { sol: solicitud, fecha, formulario, soportes, mapeo: cx.mapeo.orden, listo, bloqueos })
    generarBorrador(join(paquete, "borrador-correo.md"), solicitud, cx.maestro, adjuntos, listo)
    writeFileSync(join(outCaso, "estado.json"), JSON.stringify({ listo_para_firma: listo, bloqueos, adjuntos, fecha }, null, 2))

    return exito({
      ruta: rel(args.caso, "paquete"),
      listo_para_firma: listo,
      checklist: {
        soportes: soportes.map((s) => ({ tipo: s.tipo, estado: s.estado, vigencia_hasta: s.vigencia_hasta, nota: s.nota ?? null })),
        campos_faltantes: cx.mapeo.faltantes.map((c) => c.etiqueta),
        campos_por_confirmar: cx.mapeo.requiere_confirmacion.map((c) => ({ etiqueta: c.etiqueta, nota: c.nota ?? null })),
        bloqueos,
      },
      archivos: [...adjuntos, "checklist.md", "borrador-correo.md"],
      resumen: `${listo ? "LISTO para firma" : `BLOQUEADO (${bloqueos.length} bloqueos)`} · ${adjuntos.length} adjuntos`,
    })
  },
})

// ═════════════════════════════ HU-4 / RN4 ═════════════════════════════

export const simular_envio = definirHerramienta({
  description: "Simula el envío del paquete escribiendo out/<caso>/ENVIO-SIMULADO.md; solo funciona si el usuario confirmó explícitamente en su último mensaje.",
  args: {
    caso: argCaso,
    confirmado: z.boolean().describe("true solo si el último mensaje del usuario confirmó explícitamente el envío"),
  },
  async execute(args, ctx) {
    // Compuerta doble: el argumento del modelo Y la verificación del host sobre el mensaje real del usuario.
    if (!args.confirmado || ctx.confirmacionHumana === false) {
      return fallo("requiere confirmación explícita")
    }
    const c = cargarCaso(ctx.directory, args.caso)
    if (!c.ok) return fallo(c.error)
    const rutaEstado = join(rutas(ctx.directory).outCaso(args.caso), "estado.json")
    if (!existsSync(rutaEstado)) return fallo("primero hay que armar el paquete (proveedor_armar_paquete)")
    const estado = z
      .object({ listo_para_firma: z.boolean(), bloqueos: z.array(z.string()), adjuntos: z.array(z.string()) })
      .safeParse(JSON.parse(readFileSync(rutaEstado, "utf8")))
    if (!estado.success) return fallo("el estado del paquete está corrupto; vuelve a armarlo")
    const { listo_para_firma, bloqueos, adjuntos } = estado.data
    const ruta = rel(args.caso, "ENVIO-SIMULADO.md")
    generarEnvioSimulado(join(ctx.directory, ruta), c.data.solicitud, adjuntos, listo_para_firma, bloqueos, fechaEjecucion(ctx.fechaEjecucion))
    return exito({
      ruta,
      listo_para_firma,
      advertencias: bloqueos,
      resumen: `envío SIMULADO registrado${listo_para_firma ? "" : " con bloqueos pendientes"}`,
    })
  },
})
