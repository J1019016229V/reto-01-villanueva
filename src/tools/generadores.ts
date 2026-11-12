/** Generadores de archivos de salida. Reciben datos ya mapeados; no deciden reglas de negocio. */
import ExcelJS from "exceljs"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { CampoMapeado, CampoSolicitado, Maestro, SoporteEvaluado, Solicitud, Valor } from "./dominio"
import { nombrePais, valorEnRuta } from "./dominio"

const asegurarDir = (ruta: string): void => {
  mkdirSync(dirname(ruta), { recursive: true })
}

const texto = (v: Valor): string => (v === null ? "" : String(v))

const marca = (c: CampoMapeado): string =>
  c.estado === "faltante" ? "[FALTANTE]" : c.estado === "requiere_confirmacion" ? "[CONFIRMAR]" : ""

// ─────────── Excel (HU3 P0) ───────────

export async function generarXlsx(ruta: string, campos: CampoSolicitado[], mapeo: CampoMapeado[], fecha: string): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = "Agente Registro Proveedor"
  wb.created = new Date(`${fecha}T00:00:00Z`)
  wb.modified = wb.created

  campos.forEach((campo, i) => {
    const m = mapeo[i]
    if (!m || !campo.hoja || !campo.celda_etiqueta || !campo.celda_valor) return
    const hoja = wb.getWorksheet(campo.hoja) ?? wb.addWorksheet(campo.hoja)
    const celdaEtiqueta = hoja.getCell(campo.celda_etiqueta)
    celdaEtiqueta.value = campo.etiqueta
    celdaEtiqueta.font = { bold: true }

    const celdaValor = hoja.getCell(campo.celda_valor)
    celdaValor.value = m.valor === null ? "" : m.valor
    if (m.estado !== "lleno") {
      celdaValor.fill = { type: "pattern", pattern: "solid", fgColor: { argb: m.estado === "faltante" ? "FFF8D7DA" : "FFFFF3CD" } }
      celdaValor.note = `${m.estado === "faltante" ? "FALTANTE" : "REQUIERE CONFIRMACIÓN"}: ${m.nota ?? ""}`
    }
    hoja.getColumn(celdaEtiqueta.col).width = 34
    hoja.getColumn(celdaValor.col).width = 48
  })

  asegurarDir(ruta)
  await wb.xlsx.writeFile(ruta)
}

/** Relee un xlsx generado: permite verificar en demo.ts que cada valor quedó en su celda. */
export async function leerCeldaXlsx(ruta: string, hoja: string, celda: string): Promise<string> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(ruta)
  const v = wb.getWorksheet(hoja)?.getCell(celda).value
  return v === null || v === undefined ? "" : String(v)
}

// ─────────── PDF (HU3 P1) ───────────

function envolver(t: string, ancho: (s: string) => number, max: number): string[] {
  const out: string[] = []
  let actual = ""
  for (const palabra of t.split(" ")) {
    const prueba = actual ? `${actual} ${palabra}` : palabra
    if (ancho(prueba) > max && actual) {
      out.push(actual)
      actual = palabra
    } else actual = prueba
  }
  if (actual) out.push(actual)
  return out
}

export async function generarPdf(ruta: string, sol: Solicitud, mapeo: CampoMapeado[], fecha: string): Promise<void> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Formulario de registro de proveedor - ${sol.cliente}`)
  doc.setCreator("Agente Registro Proveedor")
  doc.setCreationDate(new Date(`${fecha}T00:00:00Z`))
  doc.setModificationDate(new Date(`${fecha}T00:00:00Z`))
  const normal = await doc.embedFont(StandardFonts.Helvetica)
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold)

  let pagina = doc.addPage([595, 842])
  let y = 800
  const escribir = (t: string, size: number, font = normal, color = rgb(0, 0, 0), x = 50): void => {
    if (y < 60) {
      pagina = doc.addPage([595, 842])
      y = 800
    }
    pagina.drawText(t, { x, y, size, font, color })
  }

  escribir("Formulario de registro de proveedor", 16, negrita)
  y -= 20
  escribir(`Cliente: ${sol.cliente} (${nombrePais(sol.pais)})   ·   Generado: ${fecha}`, 9)
  y -= 14
  escribir("(*) obligatorio   [CONFIRMAR] revisar antes de firmar   [FALTANTE] sin dato en el maestro", 8, normal, rgb(0.4, 0.4, 0.4))
  y -= 26

  for (const c of mapeo) {
    escribir(`${c.etiqueta}${c.obligatorio ? " (*)" : ""}`, 10, negrita)
    const color = c.estado === "faltante" ? rgb(0.7, 0.1, 0.1) : c.estado === "requiere_confirmacion" ? rgb(0.6, 0.4, 0) : rgb(0, 0, 0)
    const lineas = envolver(`${texto(c.valor) || "—"}  ${marca(c)}`.trim(), (t) => normal.widthOfTextAtSize(t, 10), 285)
    lineas.forEach((l, i) => {
      if (i > 0) y -= 13
      escribir(l, 10, normal, color, 260)
    })
    y -= 22
  }
  y -= 20
  escribir("Firma del representante legal: ______________________________", 10)

  asegurarDir(ruta)
  writeFileSync(ruta, await doc.save({ useObjectStreams: false }))
}

// ─────────── Portal (HU3 P2) ───────────

export function generarValoresPortal(ruta: string, sol: Solicitud, mapeo: CampoMapeado[]): void {
  const filas = mapeo.map((c) => `| ${c.etiqueta} | ${texto(c.valor) || "—"} | ${c.estado}${c.nota ? ` · ${c.nota}` : ""} |`)
  const md = [
    `# Valores para el portal · ${sol.cliente}`,
    "",
    "> **Formato no soportado para automatización:** este cliente usa un portal web.",
    "> Copia estos valores en el portal. El ingreso de credenciales y el clic en **Enviar** son humanos.",
    "",
    "| Campo del portal | Valor | Estado |",
    "|---|---|---|",
    ...filas,
    "",
  ].join("\n")
  asegurarDir(ruta)
  writeFileSync(ruta, md)
}

// ─────────── Paquete (HU4) ───────────

export interface DatosChecklist {
  sol: Solicitud
  fecha: string
  formulario: string
  soportes: SoporteEvaluado[]
  mapeo: CampoMapeado[]
  listo: boolean
  bloqueos: string[]
}

const ICONO: Record<string, string> = { presente: "✅", vencido: "⛔", ausente: "❌" }

export function generarChecklist(ruta: string, d: DatosChecklist): void {
  const faltantes = d.mapeo.filter((c) => c.estado === "faltante")
  const confirmar = d.mapeo.filter((c) => c.estado === "requiere_confirmacion")
  const md = [
    `# Checklist para firma · ${d.sol.cliente}`,
    "",
    `- Caso: \`${d.sol.id}\` · País: ${nombrePais(d.sol.pais)} · Formato: ${d.sol.formato}`,
    `- Fecha de ejecución: ${d.fecha}`,
    `- Formulario: \`${d.formulario}\``,
    `- **Estado: ${d.listo ? "LISTO PARA FIRMA" : "BLOQUEADO, no listo para firma"}**`,
    "",
    "## Soportes exigidos",
    "| Estado | Soporte | Archivo | Vigencia | Nota |",
    "|---|---|---|---|---|",
    ...d.soportes.map((s) => `| ${ICONO[s.estado] ?? ""} ${s.estado} | ${s.nombre} | ${s.archivo ?? "—"} | ${s.vigencia_hasta ?? "no aplica"} | ${s.nota ?? ""} |`),
    "",
    "## Campos faltantes (no bloquean; completar antes de firmar)",
    ...(faltantes.length ? faltantes.map((c) => `- [ ] ${c.etiqueta}${c.obligatorio ? " (obligatorio)" : ""}: ${c.nota ?? ""}`) : ["- Ninguno"]),
    "",
    "## Campos que requieren confirmación",
    ...(confirmar.length ? confirmar.map((c) => `- [ ] ${c.etiqueta}: ${c.nota ?? ""}`) : ["- Ninguno"]),
    "",
    "## Bloqueos para firma",
    ...(d.bloqueos.length ? d.bloqueos.map((b) => `- ${b}`) : ["- Ninguno"]),
    "",
  ].join("\n")
  asegurarDir(ruta)
  writeFileSync(ruta, md)
}

/** RN2: el borrador NUNCA contiene datos bancarios. Se verifica antes de escribir. */
export function generarBorrador(ruta: string, sol: Solicitud, maestro: Maestro, adjuntos: string[], listo: boolean): void {
  const firmante = valorEnRuta(maestro, "contacto_financiero.nombre")
  const cargo = valorEnRuta(maestro, "contacto_financiero.cargo")
  const razon = valorEnRuta(maestro, "razon_social")
  const md = [
    "# Borrador de correo (NO ENVIADO)",
    "",
    `**Para:** ${sol.de}`,
    `**Asunto:** RE: ${sol.asunto}`,
    "",
    "---",
    "",
    "Buenos días,",
    "",
    `En respuesta a su solicitud, adjuntamos la documentación de ${texto(razon ?? null)} para el proceso de registro como proveedor de ${sol.cliente}:`,
    "",
    ...adjuntos.map((a) => `- ${a}`),
    "",
    "El formulario se encuentra firmado por nuestro representante legal. Quedamos atentos a cualquier información adicional.",
    "",
    "Cordialmente,",
    "",
    texto(firmante ?? null),
    texto(cargo ?? null),
    texto(razon ?? null),
    "",
    "---",
    `> Nota interna: enviar solo después de la firma del representante legal${listo ? "." : " y de resolver los bloqueos del checklist."}`,
    "",
  ].join("\n")

  for (const rutaBanco of ["banco.numero_cuenta", "banco.swift"]) {
    const v = valorEnRuta(maestro, rutaBanco)
    if (v !== undefined && v !== null && md.includes(String(v))) {
      throw new Error("RN2 violada: el borrador contiene datos bancarios") // capturado por el envoltorio
    }
  }
  asegurarDir(ruta)
  writeFileSync(ruta, md)
}

export function generarEnvioSimulado(ruta: string, sol: Solicitud, adjuntos: string[], listo: boolean, bloqueos: string[], fecha: string): void {
  const md = [
    "# ENVÍO SIMULADO",
    "",
    "> No se envió ningún correo real. Este archivo solo deja constancia de la acción confirmada por el usuario.",
    "",
    `- Fecha: ${fecha}`,
    `- Destinatario: ${sol.de}`,
    `- Asunto: RE: ${sol.asunto}`,
    `- Estado del paquete: ${listo ? "listo para firma" : "**BLOQUEADO**"}`,
    "",
    "## Adjuntos",
    ...adjuntos.map((a) => `- ${a}`),
    "",
    ...(listo ? [] : ["## Advertencia", "El usuario confirmó la simulación con bloqueos pendientes:", ...bloqueos.map((b) => `- ${b}`), ""]),
  ].join("\n")
  asegurarDir(ruta)
  writeFileSync(ruta, md)
}
