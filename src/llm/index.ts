/** Fábrica de adaptadores: el único lugar que lee variables de entorno del proveedor. */
import { listarCasos } from "../tools/dominio"
import type { LlmAdapter } from "./adapter"
import { AnthropicAdapter } from "./anthropic"
import { MockAdapter } from "./mock"
import { OpenAiCompatAdapter } from "./openai"

export function crearAdaptador(directory: string, env: Record<string, string | undefined> = process.env): LlmAdapter {
  // Recorta espacios o saltos de línea accidentales al pegar la clave en el panel del hosting.
  env = { ...env, ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY?.trim(), OPENAI_API_KEY: env.OPENAI_API_KEY?.trim() }
  const timeout = Number(env.LLM_TIMEOUT_MS ?? 60000)
  const proveedor = env.LLM_PROVIDER ?? (env.ANTHROPIC_API_KEY ? "anthropic" : env.OPENAI_API_KEY ? "openai" : "mock")

  if (proveedor === "anthropic" && env.ANTHROPIC_API_KEY) {
    return new AnthropicAdapter(env.ANTHROPIC_API_KEY, env.LLM_MODEL ?? "claude-sonnet-5-5", timeout, 2048, env.ANTHROPIC_BASE_URL, env.ANTHROPIC_VERSION)
  }
  if (proveedor === "openai" && env.OPENAI_API_KEY) {
    return new OpenAiCompatAdapter(env.OPENAI_API_KEY, env.LLM_MODEL ?? "gpt-4.1-mini", env.OPENAI_BASE_URL ?? "https://api.openai.com/v1", timeout)
  }
  if (proveedor !== "mock") console.warn(`[llm] LLM_PROVIDER=${proveedor} sin clave configurada → se usa el adaptador mock`)
  return new MockAdapter(() => listarCasos(directory))
}
