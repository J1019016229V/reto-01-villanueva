# 02 · Validación de la spec (compuerta antes de codificar)

En ASDD la ambigüedad se elimina en la spec, no en la revisión de código. Al contrastar el PRD con los fixtures aparecieron estas ambigüedades. Cada una se resolvió con una decisión registrada.

| # | Ambigüedad detectada | Decisión | Por qué |
|---|---|---|---|
| A1 | "Fecha de ejecución" para la vigencia de soportes | Fecha real del servidor; sobreescribible con `FECHA_EJECUCION=YYYY-MM-DD` | Así se reproduce cualquier escenario. Con la fecha real (nov-2026) la cámara de comercio (30-sep) y los parafiscales (31-ago) están vencidos, de modo que ningún caso queda listo para firma, y eso es correcto |
| A2 | `generar_formulario({caso, mapeo})`: si el modelo pasa el mapeo, podría alterar valores | `mapeo` es opcional e informativo; la herramienta **recalcula** los valores desde el maestro | Cumple CA2 por diseño: el modelo nunca transporta valores |
| A3 | ¿Un campo `requiere_confirmacion` se escribe en el formulario? | Sí, con el valor propuesto (tiene fuente); se resalta en el checklist | Evita reprocesar; el humano revisa antes de firmar |
| A4 | Sinónimos fuera del glosario | Normalización (tildes y mayúsculas, confianza 0.95), clave del maestro (0.9), similitud por tokens (<0.8 → `requiere_confirmacion`; <0.5 → `faltante`) | HU2.4 exige un umbral de confianza |
| A5 | Soporte exigido que no existe en el índice (`certificado_cumplimiento_tributario`) | `ausente` → bloquea | RN3 |
| A6 | "Envía" con el paquete bloqueado | Se permite el envío **simulado** tras confirmación, pero `ENVIO-SIMULADO.md` y el chat advierten los bloqueos | Es una simulación inofensiva; el ejemplo del PRD espera el archivo. En producción, un paquete bloqueado no se envía (ver Riesgos en SOLUCION.md) |
| A7 | ¿Qué cuenta como "confirmación explícita"? | Un mensaje afirmativo (`sí`, `confirmo`, `adelante`, `procede`...) **inmediatamente después** de un turno que terminó pidiendo confirmación. "Envía" es una petición, no una confirmación | RN4 + ejemplo del PRD |
| A8 | Formato de "País" | Se escribe el valor del maestro (`CO`) sin traducir | No inventar: una traducción es un valor que no está en la fuente |
| A9 | Datos bancarios en la respuesta al modelo | Número de cuenta enmascarado (`031*****345`) en las salidas de herramientas y en los logs; completo solo en el archivo del formulario | RN2 y minimizar datos sensibles en proveedores externos |
| A10 | ¿Soporte emitido en CO cuando el cliente es extranjero? | Se incluye y se anota en el checklist que el emisor es CO | El maestro solo tiene soportes de CO |
| A11 | ¿Dónde vive el log? | `out/<caso>/log.jsonl` (RN5) y `out/log.jsonl` global con `sessionId` (CA4) | Ambos se piden |

**Resultado de la compuerta:** spec aprobada con 11 supuestos, que se trasladan a `SOLUCION.md §7`.
