/**
 * Adaptador determinista sin red: imita al modelo con un guion fijo.
 * Sirve para (1) pruebas automáticas del ciclo, (2) que el link funcione aunque no haya clave,
 * y (3) demostrar que el ciclo del agente no depende del proveedor.
 */
import type { DefinicionHerramienta } from "../tools/registro"
import type { LlmAdapter, Mensaje, RespuestaLlm } from "./adapter"

const PASOS = ["proveedor_leer_solicitud", "proveedor_mapear_campos", "proveedor_generar_formulario", "proveedor_armar_paquete"] as const

type Datos = Record<string, unknown>
const datos = (contenido: string): { ok: boolean; error?: string; data?: Datos } => {
  try {
    return JSON.parse(contenido) as { ok: boolean; error?: string; data?: Datos }
  } catch {
    return { ok: false, error: "salida inválida" }
  }
}
const etiquetas = (x: unknown): string[] =>
  Array.isArray(x) ? x.map((e) => (typeof e === "object" && e !== null && "etiqueta" in e ? String((e as { etiqueta: unknown }).etiqueta) : String(e))) : []

export class MockAdapter implements LlmAdapter {
  readonly proveedor = "mock"
  readonly modelo = "guion-determinista"
  private n = 0
  constructor(private readonly casos: () => string[]) {}

  private id(): string {
    return `mock_${++this.n}`
  }

  async enviar(_sistema: string, mensajes: Mensaje[], _h: DefinicionHerramienta[]): Promise<RespuestaLlm> {
    const uso = { entrada: 0, salida: 0 }
    const ultimo = mensajes[mensajes.length - 1]
    const usuarios = mensajes.filter((m): m is Extract<Mensaje, { rol: "user" }> => m.rol === "user")
    const textoUsuario = usuarios[usuarios.length - 1]?.texto ?? ""
    const caso = this.casoEn(usuarios.map((u) => u.texto).reverse())

    if (ultimo?.rol === "user") {
      if (/\[nota del sistema: el usuario CONFIRMÓ/.test(textoUsuario) && caso) {
        return { texto: "", llamadas: [{ id: this.id(), nombre: "proveedor_simular_envio", args: { caso, confirmado: true } }], uso }
      }
      if (/\[nota del sistema: el usuario NO confirmó/.test(textoUsuario)) {
        return { texto: "Entendido: no registro ningún envío. ¿Quieres ajustar algo o procesar otro caso?", llamadas: [], uso }
      }
      if (/(env[ií]a|enviar|manda)/i.test(textoUsuario) && !/no env[ií]es/i.test(textoUsuario) && caso) {
        return {
          texto: `Antes de continuar: el envío es una acción externa. ¿Confirmas que registre el envío simulado del paquete de **${caso}**? Responde **sí** para continuar.\n[[CONFIRMAR]]`,
          llamadas: [],
          uso,
        }
      }
      if (!caso) return { texto: `¿Qué caso proceso? Disponibles: ${this.casos().join(", ")}.`, llamadas: [], uso }
      return { texto: "", llamadas: [{ id: this.id(), nombre: PASOS[0], args: { caso } }], uso }
    }

    if (ultimo?.rol === "tool") {
      const r = ultimo.resultados[0]
      if (!r || !caso) return { texto: "No pude continuar.", llamadas: [], uso }
      if (r.nombre === "proveedor_simular_envio") {
        const d = datos(r.contenido)
        return { texto: d.ok ? `Listo: registré el envío simulado en \`${String(d.data?.ruta)}\`. No se envió ningún correo real.` : `No registré el envío: ${d.error}.`, llamadas: [], uso }
      }
      const i = PASOS.indexOf(r.nombre as (typeof PASOS)[number])
      if (r.nombre === PASOS[0] && !datos(r.contenido).ok) return { texto: `No pude leer la solicitud: ${datos(r.contenido).error}.`, llamadas: [], uso }
      if (i >= 0 && i < PASOS.length - 1) return { texto: "", llamadas: [{ id: this.id(), nombre: PASOS[i + 1] ?? PASOS[0], args: { caso } }], uso }
      return { texto: this.resumen(mensajes, caso), llamadas: [], uso }
    }
    return { texto: "¿En qué te ayudo?", llamadas: [], uso }
  }

  private casoEn(textos: string[]): string | null {
    for (const t of textos) {
      const c = this.casos().find((x) => t.includes(x))
      if (c) return c
    }
    return null
  }

  private resumen(mensajes: Mensaje[], caso: string): string {
    const res = new Map<string, ReturnType<typeof datos>>()
    for (const m of mensajes) if (m.rol === "tool") for (const r of m.resultados) res.set(r.nombre, datos(r.contenido))
    const leer = res.get(PASOS[0])?.data ?? {}
    const map = res.get(PASOS[1])?.data ?? {}
    const gen = res.get(PASOS[2])
    const paq = res.get(PASOS[3])?.data ?? {}
    const chk = (paq.checklist ?? {}) as { bloqueos?: string[]; soportes?: { tipo: string; estado: string }[] }
    const listo = paq.listo_para_firma === true
    return [
      `**Caso** ${caso} · ${String(leer.cliente)} · ${String(leer.pais)} · ${String(leer.formato)}`,
      `**Campos**: ${etiquetas(map.llenos).length} llenos · faltantes: ${etiquetas(map.faltantes).join(", ") || "ninguno"} · por confirmar: ${etiquetas(map.requiere_confirmacion).join(", ") || "ninguno"}`,
      `**Soportes**: ${(chk.soportes ?? []).map((s) => `${s.tipo} (${s.estado})`).join(", ")}`,
      `**Estado**: ${listo ? "✅ LISTO PARA FIRMA" : "⛔ BLOQUEADO"}${chk.bloqueos?.length ? `: ${chk.bloqueos.join("; ")}` : ""}`,
      `**Formulario**: ${gen?.ok ? String(gen.data?.ruta) : String(gen?.error ?? "—")}`,
      `**Archivos**: \`${String(paq.ruta)}\``,
      "",
      "_(Respuesta generada por el adaptador mock determinista, sin modelo de lenguaje.)_",
      "",
      "¿Quieres ajustar algo o procesar otro caso? No enviaré nada sin tu confirmación.",
    ].join("\n")
  }
}
