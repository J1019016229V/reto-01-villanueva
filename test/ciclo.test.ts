/** Pruebas del ciclo con adaptadores falsos (sin red): compuertas CA1, CA3/RN4, CA5. `bun test` */
import { expect, test } from "bun:test"
import { join } from "node:path"
import { esAfirmativo, ejecutarTurno, nuevaSesion, type Config } from "../src/agent/ciclo"
import { ErrorLlm, type LlmAdapter, type RespuestaLlm } from "../src/llm/adapter"

const directory = join(import.meta.dir, "..")
const uso = { entrada: 1, salida: 1 }
const guion = (pasos: RespuestaLlm[]): LlmAdapter => {
  let i = 0
  return { proveedor: "test", modelo: "test", enviar: async () => pasos[Math.min(i++, pasos.length - 1)] ?? { texto: "fin", llamadas: [], uso } }
}
const cfg = (llm: LlmAdapter, maxIteraciones = 25): Config => ({ directory, llm, maxIteraciones, maxTokensSesion: 1e6 })
const envio = { id: "e", nombre: "proveedor_simular_envio", args: { caso: "co-industrias-delta", confirmado: true } }

test("RN4: el modelo no puede enviar si el usuario no confirmó", async () => {
  const r = await ejecutarTurno(nuevaSesion("a1"), "envía", cfg(guion([{ texto: "", llamadas: [envio], uso }, { texto: "ok", llamadas: [], uso }])))
  expect(r.toolCalls[0]?.ok).toBe(false)
  expect(r.toolCalls[0]?.resumen).toBe("requiere confirmación explícita")
})

test("CA3: [[CONFIRMAR]] activa needsConfirmation y solo el 'sí' siguiente habilita el envío", async () => {
  const s = nuevaSesion("a2")
  await ejecutarTurno(s, "arma co-industrias-delta", cfg(guion([{ texto: "", llamadas: [{ id: "p", nombre: "proveedor_armar_paquete", args: { caso: "co-industrias-delta" } }], uso }, { texto: "ok", llamadas: [], uso }])))
  const pide = await ejecutarTurno(s, "envía", cfg(guion([{ texto: "¿Confirmas? [[CONFIRMAR]]", llamadas: [], uso }])))
  expect(pide.needsConfirmation).toBe(true)
  expect(pide.reply).not.toContain("[[CONFIRMAR]]")
  const ok = await ejecutarTurno(s, "Sí, confirmo", cfg(guion([{ texto: "", llamadas: [envio], uso }, { texto: "hecho", llamadas: [], uso }])))
  expect(ok.toolCalls[0]?.ok).toBe(true)
  // La confirmación caduca: un segundo intento sin pedirla de nuevo se rechaza.
  const otra = await ejecutarTurno(s, "sí otra vez", cfg(guion([{ texto: "", llamadas: [envio], uso }, { texto: "x", llamadas: [], uso }])))
  expect(otra.toolCalls[0]?.ok).toBe(false)
})

test("CA5: error del proveedor → mensaje claro y la sesión sigue viva", async () => {
  const s = nuevaSesion("a3")
  const caido: LlmAdapter = { proveedor: "t", modelo: "t", enviar: async () => { throw new ErrorLlm("timeout") } }
  const r = await ejecutarTurno(s, "hola", cfg(caido))
  expect(r.reply).toContain("timeout")
  const r2 = await ejecutarTurno(s, "hola de nuevo", cfg(guion([{ texto: "aquí estoy", llamadas: [], uso }])))
  expect(r2.reply).toBe("aquí estoy")
})

test("CA1: tope de iteraciones", async () => {
  const loop: LlmAdapter = { proveedor: "t", modelo: "t", enviar: async () => ({ texto: "", llamadas: [{ id: String(Math.random()), nombre: "proveedor_leer_solicitud", args: { caso: "ec-corp-andina" } }], uso }) }
  const r = await ejecutarTurno(nuevaSesion("a4"), "x", cfg(loop, 3))
  expect(r.toolCalls.length).toBe(3)
  expect(r.reply).toContain("tope de 3")
})

test("afirmativos", () => {
  for (const t of ["sí", "Sí, confirmo", "si", "confirmo", "adelante", "ok"]) expect(esAfirmativo(t)).toBe(true)
  for (const t of ["envía", "no", "sigue sin enviar", "simplemente revisa"]) expect(esAfirmativo(t)).toBe(false)
})
