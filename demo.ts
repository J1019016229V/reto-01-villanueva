/**
 * demo.ts: ejecuta las herramientas SIN modelo de lenguaje sobre todos los casos (PRD §6.6).
 *   bun install && bun run demo.ts
 * Determinista: limpia out/ al inicio. Fecha de vigencias = hoy, o FECHA_EJECUCION=YYYY-MM-DD.
 */
import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { contenidoModulo } from "./scripts/build-modulo"
import { fechaEjecucion, listarCasos } from "./src/tools/dominio"
import { leerCeldaXlsx } from "./src/tools/generadores"
import { ejecutarHerramienta } from "./src/tools/registro"
import type { ToolCtx } from "./src/tools/tipos"

const directory = import.meta.dir
const ctx: ToolCtx = { directory, sessionId: "demo" }

type Json = { ok: boolean; error?: string; data?: Record<string, unknown> }
const parse = (s: string): Json => JSON.parse(s) as Json
const linea = (t = ""): void => console.log(t)
const lista = (x: unknown): string[] => (Array.isArray(x) ? x.map((e) => (typeof e === "object" && e && "etiqueta" in e ? String(e.etiqueta) : String(e))) : [])

rmSync(join(directory, "out"), { recursive: true, force: true })
linea(`═══ Demo agente Registro como Proveedor · fecha de ejecución ${fechaEjecucion()} ═══`)

let fallasVerificacion = 0
const verificar = (cond: boolean, msg: string): void => {
  if (!cond) fallasVerificacion++
  linea(`   ${cond ? "✔" : "✘"} ${msg}`)
}

for (const caso of [...listarCasos(directory), "caso-inexistente"]) {
  linea()
  linea(`▶ ${caso}`)
  const leer = parse((await ejecutarHerramienta("proveedor_leer_solicitud", { caso }, ctx)).salida)
  if (!leer.ok) {
    linea(`   leer_solicitud → error claro: ${leer.error}`)
    continue
  }
  const d = leer.data ?? {}
  linea(`   leer_solicitud → ${d.resumen}`)
  if (lista(d.ambiguos).length) linea(`   ambiguos: ${lista(d.ambiguos).join(", ")}`)

  const map = parse((await ejecutarHerramienta("proveedor_mapear_campos", { caso }, ctx)).salida)
  const md = map.data ?? {}
  linea(`   mapear_campos  → ${md.resumen}`)
  if (lista(md.faltantes).length) linea(`     faltantes: ${lista(md.faltantes).join(", ")}`)
  if (lista(md.requiere_confirmacion).length) linea(`     por confirmar: ${lista(md.requiere_confirmacion).join(", ")}`)
  const total = lista(md.llenos).length + lista(md.faltantes).length + lista(md.requiere_confirmacion).length
  verificar(total === lista(d.campos).length, `HU2.1 cada campo en un único estado (${total}/${lista(d.campos).length})`)
  verificar(!JSON.stringify(md).includes("03100012345"), "RN2 número de cuenta enmascarado en la salida al modelo")

  const gen = parse((await ejecutarHerramienta("proveedor_generar_formulario", { caso }, ctx)).salida)
  linea(`   generar_formulario → ${gen.ok ? gen.data?.resumen : `ok:false · ${gen.error}`}`)

  if (d.formato === "xlsx" && gen.ok) {
    // Verificación HU3 P0: releer las celdas del archivo generado.
    const ruta = join(directory, String(gen.data?.ruta))
    const etiqueta = await leerCeldaXlsx(ruta, caso.startsWith("co-") ? "Datos Proveedor" : "Registro", caso.startsWith("co-") ? "B3" : "A2")
    const valor = await leerCeldaXlsx(ruta, caso.startsWith("co-") ? "Datos Proveedor" : "Registro", caso.startsWith("co-") ? "C3" : "B2")
    verificar(etiqueta === "Razón social" && valor === "Periferia IT Group S.A.S.", `HU3.1 celda exacta: "${etiqueta}" = "${valor}"`)
  }

  const paq = parse((await ejecutarHerramienta("proveedor_armar_paquete", { caso }, ctx)).salida)
  const pd = paq.data ?? {}
  linea(`   armar_paquete  → ${paq.ok ? pd.resumen : paq.error}`)
  const chk = (pd.checklist ?? {}) as { bloqueos?: string[] }
  for (const b of chk.bloqueos ?? []) linea(`     ⛔ ${b}`)

  const sin = parse((await ejecutarHerramienta("proveedor_simular_envio", { caso, confirmado: false }, ctx)).salida)
  verificar(!sin.ok && sin.error === "requiere confirmación explícita", `RN4 envío sin confirmación rechazado: "${sin.error}"`)
  const gate = parse((await ejecutarHerramienta("proveedor_simular_envio", { caso, confirmado: true }, { ...ctx, confirmacionHumana: false })).salida)
  verificar(!gate.ok, "RN4 compuerta del host: confirmado=true sin 'sí' del usuario → rechazado")
}

// Envío con confirmación (simula el "sí" del usuario) en un caso.
linea()
const env = parse((await ejecutarHerramienta("proveedor_simular_envio", { caso: "ec-corp-andina", confirmado: true }, { ...ctx, confirmacionHumana: true })).salida)
linea(`▶ envío confirmado ec-corp-andina → ${env.ok ? env.data?.ruta : env.error}`)
verificar(env.ok, "HU4.4 ENVIO-SIMULADO.md escrito tras confirmación")

const bad = parse((await ejecutarHerramienta("proveedor_mapear_campos", { caso: "../../etc" }, ctx)).salida)
verificar(!bad.ok, `HU5.1 ruta maliciosa rechazada: ${bad.error}`)
const desconocida = parse((await ejecutarHerramienta("proveedor_borrar_todo", {}, ctx)).salida)
verificar(!desconocida.ok, "HU5.2 herramienta desconocida → error tipado")

// Bonus §9.4: el módulo usa exactamente las mismas piezas que la aplicación.
const enSincronia = Object.entries(contenidoModulo()).every(([ruta, c]) => existsSync(join(directory, ruta)) && readFileSync(join(directory, ruta), "utf8") === c)
verificar(enSincronia, "Bonus modulo/ en sincronía con agent/prompt.md, knowledge y tools (si falla: bun run modulo)")
const mod = await import("./modulo/tools/proveedor")
verificar(Object.keys(mod).sort().join() === Object.keys(await import("./src/tools/proveedor")).sort().join(), "Bonus modulo/tools exporta las mismas herramientas")

linea()
linea(fallasVerificacion === 0 ? "✅ Todas las verificaciones pasaron. Artefactos en out/" : `❌ ${fallasVerificacion} verificaciones fallaron`)
process.exit(fallasVerificacion === 0 ? 0 : 1)
