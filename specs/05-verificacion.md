# 05 · Verificación (spec → evidencia)

| Comando | Qué verifica | Resultado |
|---|---|---|
| `bun run demo.ts` | HU1–HU5, RN2, RN4 y la sincronía del bonus, sin modelo | ✅ todas las verificaciones (exit 0) |
| `bun run demo.ts` dos veces + `diff -r out/` | NF2 determinismo | ✅ salida y artefactos idénticos salvo `log.jsonl` (timestamps) |
| `bun test` | CA1 tope, CA3/RN4 compuerta y caducidad de la confirmación, CA5 sesión viva tras un error del LLM, afirmativos | ✅ 5/5 |
| `bun run typecheck` | NF6 TypeScript estricto, sin `any` | ✅ |
| Servidor + API Anthropic simulada | Formato real de `tool_use`/`tool_result`, `$schema` removido, la clave no aparece en logs ni respuestas | ✅ |
| Navegador headless sobre el front (adaptador mock) | Tarjetas de herramienta, links a `out/`, resaltado ámbar y botones de confirmación | ✅ ver `docs/captura-chat.png` |
| `GET /api/out/<caso>/..%2F..%2Fpackage.json` | Path traversal | ✅ 400 "ruta no permitida" |

## Matriz de resultados por caso (fecha de ejecución 2026-11-11)

| Caso | Formato | Llenos | Faltantes | Por confirmar | Soportes | Estado |
|---|---|---|---|---|---|---|
| co-industrias-delta | xlsx | 17 | 0 | 0 | cámara **vencida** | ⛔ bloqueado |
| ec-corp-andina | pdf | 13 | Número de contribuyente especial | RUC (identificador extranjero) | cámara **vencida**, cumplimiento tributario **ausente** | ⛔ bloqueado |
| hn-agroexport-sula | xlsx | 9 | Referencias comerciales | RTN (identificador extranjero) | cámara y parafiscales **vencidos** | ⛔ bloqueado |
| pa-logistica-istmo | portal | 8 | 0 | RUC | cámara **vencida** | ⛔ bloqueado · `valores-portal.md` |

Con `FECHA_EJECUCION=2026-09-15`, `co-industrias-delta` queda **listo para firma** (todos sus soportes vigentes), lo que muestra que el bloqueo responde a la vigencia y no a un defecto.
