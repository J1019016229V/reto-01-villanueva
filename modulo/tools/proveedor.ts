// Mismas herramientas que la aplicación (no es una copia): cada export es una herramienta { description, args (zod), execute }.
// El host debe pasar ctx.directory apuntando a la raíz que contiene fixtures/reto-01/.
export * from "../../src/tools/proveedor"
export type { ToolCtx, Herramienta } from "../../src/tools/tipos"
