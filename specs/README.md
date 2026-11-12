# Rastro ASDD (Agentic Specification-Driven Development)

Este repositorio se construyó con ASDD: **la especificación es el artefacto central** y el código se deriva de ella.
Ningún agente de IA escribió código antes de que la spec pasara su compuerta de validación.

| Etapa ASDD | Artefacto | Compuerta (gate) |
|---|---|---|
| 0. Intent | [`00-intent.md`](00-intent.md) | Problema, actor y resultado medibles en una página |
| 1. Discovery + Spec | [`01-spec.md`](01-spec.md) | Cada HU/RN/CA del PRD con ID, criterio verificable y dueño (herramienta, prompt o servidor) |
| 2. Validación de spec | [`02-validacion-spec.md`](02-validacion-spec.md) | Ambigüedades del PRD resueltas y registradas como supuestos **antes** de codificar |
| 3. Dominio + Diseño | [`03-diseno.md`](03-diseno.md) | Contratos de herramientas, máquina de estados del campo, flujo de confirmación |
| 4. Plan / Tasks | [`04-plan-tareas.md`](04-plan-tareas.md) | Tareas atómicas, cada una trazada a IDs de la spec |
| 5. Ejecución por agente | `src/`, `web/`, `agent/`, `modulo/` | Implementación contra la spec |
| 6. Verificación | [`05-verificacion.md`](05-verificacion.md) | `demo.ts` + typecheck + matriz spec → evidencia |

`PRD-original.md` es el documento fuente entregado por Periferia (sin modificar).
