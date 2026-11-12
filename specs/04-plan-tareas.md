# 04 · Plan y tareas (trazadas a la spec)

| # | Tarea | IDs cubiertos | Orden |
|---|---|---|---|
| T1 | `src/knowledge/reglas.json` + `registro-proveedor.md` | RN1, A4, A5 | 1 |
| T2 | `src/tools/registro.ts`: envoltorio zod → execute → captura → log (caso y global) | HU5.2, RN5, CA4 | 1 |
| T3 | `proveedor_leer_solicitud` | HU1.1, HU1.2, HU5.1 | 2 |
| T4 | `proveedor_mapear_campos` (motor de mapeo y enmascarado) | HU2.*, RN1, RN2, A4, A9 | 2 |
| T5 | `proveedor_generar_formulario` xlsx/pdf/portal | HU3.*, A2, A3 | 3 |
| T6 | `proveedor_armar_paquete` + checklist + borrador | HU4.1, HU4.2, RN2, RN3 | 3 |
| T7 | `proveedor_simular_envio` con compuerta de contexto | HU4.4, RN4, A6, A7 | 3 |
| T8 | `demo.ts` (todos los casos + caso inexistente + envío sin/con confirmación + relectura del xlsx) | NF2, verificación | 4 |
| T9 | `LlmAdapter` + Anthropic (fetch, timeout) + Mock determinista | CA5, NF5, Adaptador | 5 |
| T10 | `src/agent/ciclo.ts`: bucle, tope, presupuesto de tokens, marca de confirmación | CA1–CA5, NF4 | 5 |
| T11 | `src/server.ts` + `web/index.html` | API, front | 6 |
| T12 | `modulo/` bonus apuntando a las mismas piezas | Bonus 9.4 | 7 |
| T13 | README, SOLUCION.md, Dockerfile y render.yaml | 9.1–9.3 | 7 |
| T14 | Verificación (05-verificacion.md) | todos | 8 |
