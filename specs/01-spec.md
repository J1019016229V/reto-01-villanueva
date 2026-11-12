# 01 · Especificación (fuente de verdad)

Cada requisito tiene un ID, un criterio verificable y un **dueño**: la capa que lo garantiza.
- **T** = herramienta (`src/tools/`), garantía en código y determinista.
- **S** = servidor o ciclo del agente (`src/agent/`, `src/server.ts`), garantía en código.
- **P** = prompt (`agent/prompt.md`), comportamiento del modelo.
- **K** = conocimiento (`src/knowledge/`), reglas de negocio editables sin tocar código de servidor.

Principio de diseño: **todo lo que pueda romper la confianza (inventar valores, enviar sin permiso) se garantiza en T o S, no solo en P.**

## Historias de usuario

| ID | Criterio verificable | Dueño | Evidencia |
|---|---|---|---|
| HU1.1 | `proveedor_leer_solicitud({caso})` devuelve `pais, cliente, formato, campos[], soportes[]` | T | demo.ts, sección "leer" |
| HU1.2 | Etiquetas ambiguas de identificación tributaria → `ambiguos[]` con el equivalente del país (CO→NIT; EC/PE/PA→RUC; HN→RTN) | T+K | `ambiguos` en la salida |
| HU2.1 | Cada campo termina exactamente en `lleno` (con `ruta`), `faltante` o `requiere_confirmacion` | T | invariante: suma = total de campos |
| HU2.2 | Ningún valor sin fuente; un campo sin ruta en el maestro es `faltante` | T | `Referencias comerciales`, `Número de contribuyente especial` |
| HU2.3 | Los sinónimos del glosario se resuelven automáticamente (confianza 1.0) | T | todos los campos de co-industrias-delta llenos |
| HU2.4 | Confianza < 0.8 o regla de país → `requiere_confirmacion` | T+K | RUC (EC), RTN (HN) |
| HU3.1 | xlsx: etiqueta y valor en la hoja/celda exacta de `plantilla-celdas.json` | T | relectura del xlsx en demo.ts |
| HU3.2 | pdf: todos los campos con etiqueta y valor, en el orden dado | T | `formulario.pdf` |
| HU3.3 | portal: `{ok:false, error:"formato no soportado"}` + `valores-portal.md` | T | pa-logistica-istmo |
| HU4.1 | `out/<caso>/paquete/` con formulario, soportes existentes, `checklist.md` y `borrador-correo.md` | T | árbol de out/ |
| HU4.2 | Soporte con `vigencia_hasta` < fecha de ejecución → vencido → bloquea `listo_para_firma` | T | cámara de comercio y parafiscales |
| HU4.3 | Turno termina con resumen y pregunta de confirmación | P+S | `needsConfirmation=true` |
| HU4.4 | "Enviar" solo escribe `out/<caso>/ENVIO-SIMULADO.md` | T | archivo |
| HU5.1 | Caso inexistente, plantilla corrupta o formato no soportado → mensaje claro sin traza y se continúa | T+S | demo con `caso-inexistente` |
| HU5.2 | Ninguna herramienta lanza; todas devuelven `{ok,data}` o `{ok:false,error}` | T | envoltorio `ejecutarHerramienta` |

## Reglas de negocio

| ID | Regla | Dueño |
|---|---|---|
| RN1 | Identificador tributario por país; fuera de CO se llena con el NIT y queda `requiere_confirmacion` con la nota "identificador extranjero" | T+K (`reglas.json`) |
| RN2 | Datos bancarios solo si la plantilla los pide; nunca en `borrador-correo.md`; enmascarados en logs y en el chat | T |
| RN3 | Soporte vencido o ausente bloquea; un campo faltante no bloquea pero va al checklist | T |
| RN4 | Ninguna acción externa sin confirmación explícita del usuario en el turno inmediatamente anterior | **S** (compuerta de código) + P |
| RN5 | `out/<caso>/log.jsonl` con `{ts, herramienta, ok, resumen}` en toda ejecución | T (envoltorio) |

## Reglas del ciclo del agente

| ID | Regla | Dueño |
|---|---|---|
| CA1 | Tope de iteraciones por turno (`MAX_ITERACIONES`, por defecto 25); al alcanzarlo responde con lo que tiene | S |
| CA2 | El modelo no afirma valores fuera de herramientas; **por diseño** el formulario se genera con valores recalculados del maestro, nunca con valores que pase el modelo | S+T+P |
| CA3 | La confirmación termina el turno; el front la resalta; solo un "sí" del siguiente mensaje habilita la acción | S+P |
| CA4 | Toda llamada a herramienta queda en el historial visible y en `out/log.jsonl` | S |
| CA5 | Un error de herramienta o de LLM se muestra en lenguaje claro y la sesión sigue viva | S |

## No funcionales

| ID | Requisito | Dueño |
|---|---|---|
| NF1 | Un comando: `bun run dev` | S |
| NF2 | `demo.ts` determinista; limpia `out/` al inicio y no necesita clave | T |
| NF3 | Clave solo en una variable de entorno del backend; `/api/health` no la expone | S |
| NF4 | Tope de tokens por sesión (`MAX_TOKENS_SESION`) | S |
| NF5 | Timeout al proveedor LLM (`LLM_TIMEOUT_MS`) | S |
| NF6 | TypeScript estricto sin `any`; herramientas sin shell | todo |
