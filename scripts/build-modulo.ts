/**
 * Genera modulo/ (bonus §9.4) a partir de las MISMAS fuentes que usa la aplicación:
 *   agent/prompt.md                     → modulo/agent.md (frontmatter + cuerpo idéntico)
 *   src/knowledge/registro-proveedor.md → modulo/skill/registro-proveedor/SKILL.md
 *   src/tools/proveedor.ts              → modulo/tools/proveedor.ts (re-export, sin copia)
 * Uso: bun run modulo   ·   demo.ts verifica que no haya divergencia.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const raiz = join(import.meta.dir, "..")
const leer = (p: string): string => readFileSync(join(raiz, p), "utf8")

export function contenidoModulo(): Record<string, string> {
  return {
    "modulo/agent.md": [
      "---",
      "description: Agente que llena formularios de registro de Periferia como proveedor desde el repositorio maestro y arma el paquete para firma, sin inventar valores ni enviar sin confirmación.",
      "mode: primary",
      "permission:",
      "  edit: deny",
      "  bash: deny",
      "---",
      "",
      leer("agent/prompt.md"),
    ].join("\n"),
    "modulo/skill/registro-proveedor/SKILL.md": [
      "---",
      "name: registro-proveedor",
      "description: Conocimiento del proceso de registro de Periferia como proveedor ante clientes (identificador tributario por país, datos bancarios, soportes y vigencias, estados de campo). Úsalo al procesar solicitudes de registro de proveedor.",
      "---",
      "",
      leer("src/knowledge/registro-proveedor.md"),
    ].join("\n"),
    "modulo/tools/proveedor.ts": [
      "// Mismas herramientas que la aplicación (no es una copia): cada export es una herramienta { description, args (zod), execute }.",
      "// El host debe pasar ctx.directory apuntando a la raíz que contiene fixtures/reto-01/.",
      'export * from "../../src/tools/proveedor"',
      'export type { ToolCtx, Herramienta } from "../../src/tools/tipos"',
      "",
    ].join("\n"),
  }
}

if (import.meta.main) {
  for (const [ruta, contenido] of Object.entries(contenidoModulo())) {
    mkdirSync(join(raiz, ruta, ".."), { recursive: true })
    writeFileSync(join(raiz, ruta), contenido)
    console.log(`✔ ${ruta}`)
  }
}
