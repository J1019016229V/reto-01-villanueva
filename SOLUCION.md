# SOLUCION · Reto 01: Agente "Registro como Proveedor"

**Candidato:** Jorge Isaac Villanueva · **Metodología:** ASDD (Agentic Specification-Driven Development), con el rastro completo en [`specs/`](specs/README.md)

---

## 1. Problema en una frase

La analista administrativa transcribe a mano, entre 8 y 12 veces al mes, datos que ya existen en un repositorio maestro hacia los formularios de registro como proveedor de cada cliente. El proceso **depende de una sola persona**, se equivoca en datos sensibles (NIT, cuenta bancaria) y retrasa la facturación.

Le duele a la analista (retrabajo), al área administrativa (dependencia de una persona que se va) y a finanzas (no se factura hasta que el cliente registra al proveedor).

## 2. Arquitectura

```
┌───────────────────────┐ POST /api/chat ┌────────────────────────────────────────────────────────┐
│ web/index.html        │ ─────────────▶ │ src/server.ts (Bun)       solo transporte              │
│ · historial           │ ◀───────────── │   └─ src/agent/ciclo.ts   bucle + compuertas           │
│ · tarjetas de tool    │  reply,        │        ├─ cargarSistema(): agent/prompt.md             │ ← COMPORTAMIENTO
│ · banda de confirmar  │  toolCalls,    │        │                 + src/knowledge/*.md          │ ← CONOCIMIENTO
│ · links a out/        │  needsConfirm. │        ├─ src/llm/adapter.ts  LlmAdapter.enviar()      │
└───────────────────────┘                │        │    ├─ anthropic.ts · openai.ts · mock.ts      │
                                         │        └─ src/tools/registro.ts  zod → execute → log    │
                                         │             └─ src/tools/proveedor.ts (5 herramientas) │ ← EJECUCIÓN
                                         │                  ├─ dominio.ts   mapeo, soportes, RN   │
                                         │                  └─ generadores.ts xlsx/pdf/md         │
                                         └───────────────┬──────────────────────────┬─────────────┘
                                                         │ lectura                  │ escritura
                                              fixtures/reto-01/ + knowledge/reglas.json   out/<caso>/… + out/log.jsonl
```

| Capa | Dónde | Cambia cuando... |
|---|---|---|
| Comportamiento | `agent/prompt.md` | cambia cómo conversa el agente |
| Conocimiento | `src/knowledge/registro-proveedor.md` (narrativo, va al prompt) + `reglas.json` (paramétrico, lo leen las herramientas) | cambia una regla de negocio: país → identificador, umbrales de confianza, nombres de soportes, rutas sensibles |
| Ejecución | `src/tools/` | cambia una capacidad |

**Un cambio de reglas de negocio no toca el servidor.** El prompt y el conocimiento se releen en cada turno, así que editarlos no requiere reiniciar.

## 3. Ciclo del agente

`src/agent/ciclo.ts › ejecutarTurno()`:

1. **Compuerta RN4 (en código).** `confirmacionHumana = sesion.pendienteConfirmacion && esAfirmativo(mensaje)`. La bandera pendiente se apaga en cada turno: la confirmación solo vale en el mensaje *inmediatamente siguiente*.
2. Si la sesión agotó su presupuesto de tokens (`MAX_TOKENS_SESION`), responde sin llamar al modelo.
3. Bucle `for i < MAX_ITERACIONES (25)`:
   - `llm.enviar(sistema, mensajes, herramientas)` con timeout. Si falla, muestra un mensaje claro y **la sesión sigue viva** (CA5).
   - Sin llamadas a herramientas → respuesta final. Si el texto trae la marca `[[CONFIRMAR]]`, se oculta, se responde `needsConfirmation: true` y se activa `pendienteConfirmacion`. El front pinta el mensaje en ámbar y muestra los botones **Sí, confirmo / No**.
   - Con llamadas → `ejecutarHerramienta()` valida con zod, ejecuta, captura cualquier excepción, registra en `out/<caso>/log.jsonl` (RN5) y `out/log.jsonl` (CA4) y devuelve el resultado al modelo y al front.
4. Al alcanzar el tope (CA1), responde con lo que hizo y lo que falta.

**Confirmación con defensa en profundidad.** `proveedor_simular_envio` exige `confirmado: true` (argumento del modelo) **y** `ctx.confirmacionHumana !== false` (lo calcula el host a partir del mensaje real del usuario). Aunque el modelo "alucine" una confirmación, la herramienta rechaza con `requiere confirmación explícita`. `demo.ts` verifica ambos rechazos.

**Anti-alucinación por diseño (CA2).** El modelo nunca transporta valores: `generar_formulario` y `armar_paquete` **recalculan** el mapeo desde el maestro; el argumento `mapeo` es solo informativo. El número de cuenta sale enmascarado (`031*****345`) hacia el modelo, el chat y los logs; completo solo dentro del formulario.

## 4. Elección del modelo

| | |
|---|---|
| Proveedor | Anthropic (Messages API, con `fetch` nativo: sin SDK) |
| Modelo | `claude-sonnet-5-5` (configurable con `LLM_MODEL`) |
| Por qué | Buen uso de herramientas en secuencia, buen seguimiento de instrucciones negativas ("no inventes", "no envíes sin sí") y buen español. El trabajo pesado y determinista lo hacen las herramientas, así que no hace falta el modelo más grande; un modelo tipo Haiku es la siguiente optimización si las pruebas lo sostienen |
| Alternativas listas | `LLM_PROVIDER=openai` (OpenAI, Azure, Mistral, Ollama vía `OPENAI_BASE_URL`) y `mock` (determinista, sin red) |

**Costo estimado por caso** (medido sobre `ec-corp-andina`): system prompt + conocimiento ≈ 6.1 k caracteres, esquemas de herramientas ≈ 2.9 k y salidas de las 4 herramientas ≈ 4.9 k. Con 5 llamadas al modelo por caso, el historial acumulado da **≈ 19 k tokens de entrada y ≈ 1.5 k de salida**.
A una tarifa de referencia de clase Sonnet de USD 3 / 15 por millón de tokens (entrada/salida) son **≈ USD 0.08 por caso, ≈ USD 1 al mes** con 12 casos. *La tarifa es una referencia: hay que verificarla con la lista de precios vigente del proveedor.* Con *prompt caching* del system prompt el costo baja aún más.

## 5. Diseño del formato "portal web" (PRD §7.4)

**Estado actual:** la herramienta responde `formato no soportado` y genera `out/<caso>/valores-portal.md` con los valores y su estado, listos para copiar (caso `pa-logistica-istmo`).

**Estrategia propuesta (fase 2):** un navegador controlado por el agente con **Playwright**, en modo *asistido*, no autónomo.

| Paso | Quién | Detalle |
|---|---|---|
| 1. Abrir el portal | Agente | Navegador en un contenedor aislado y efímero (perfil limpio por sesión) |
| 2. Ingresar credenciales y MFA | **Humano** | La analista escribe usuario, contraseña y MFA directamente en la ventana (vista remota tipo noVNC). El agente **nunca** ve ni almacena credenciales |
| 3. Mapear el formulario | Agente | Lee el DOM y asocia `label`/`aria-label`/`placeholder` → etiquetas del maestro con el **mismo motor de mapeo** (glosario + reglas). Selectores aprendidos por cliente, guardados como "receta" versionada |
| 4. Llenar campos | Agente | Solo los `lleno`; resalta en pantalla los `requiere_confirmacion` y los `faltante` |
| 5. Cargar soportes | Agente | Solo los vigentes; si alguno está vencido o ausente, se detiene |
| 6. Revisión y **Enviar** | **Humano** | El clic final siempre es humano. El agente toma una captura y la deja en `out/<caso>/` como evidencia |

**Credenciales:** no van en el repo, el prompt, los logs ni las variables del agente. Si hubiera que persistirlas, irían en un gestor de secretos (Azure Key Vault o 1Password) con acceso del humano y no del agente; la sesión del navegador se destruye al terminar.

**Límites:** CAPTCHA (no se evade: lo resuelve el humano), MFA (humano), cambios de layout (la receta por cliente falla de forma segura: si un selector no existe, se reporta y se cae a `valores-portal.md`), portales con *timeouts* agresivos y términos de uso que prohíban la automatización (se revisan por cliente). Alternativas evaluadas: RPA tradicional (frágil y costosa para 1–2 portales al mes) y una extensión de navegador (buena opción si el volumen de portales crece: corre en la sesión del humano y elimina el manejo de credenciales).

## 6. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| D1 | Las herramientas **recalculan** los valores; el modelo nunca los transporta | Usar el `mapeo` que el modelo pasa a `generar_formulario` | Un modelo puede alterar o "completar" un valor al reenviarlo. Así CA2 se cumple por diseño y no depende del prompt |
| D2 | Compuerta de confirmación **en código** (host + herramienta) además del prompt | Solo instrucción en el prompt | RN4 es la regla más costosa de violar; un prompt es probabilístico |
| D3 | Mapeo determinista (glosario → normalización → clave del maestro → similitud de tokens con umbrales) | Que el LLM haga el mapeo | Trazable (ruta + confianza + vía), reproducible en `demo.ts` sin modelo, sin costo y auditable. El LLM queda para orquestar y explicar |
| D4 | Adaptador LLM propio con `fetch` (3 implementaciones) | SDK del proveedor o framework de agentes (LangChain, Vercel AI SDK) | Cero dependencias, control total de timeout y errores, y demostrar que cambiar de proveedor no toca el ciclo. Costo: escribir el mapeo de mensajes (unas 40 líneas por proveedor) |
| D5 | PDF generado con `pdf-lib` | AcroForm rellenado o `pdfkit` | El PRD acepta un PDF generado; `pdf-lib` es JS puro, no lee fuentes del disco y facilita un despliegue sin sorpresas |
| D6 | Adaptador **mock** como respaldo automático sin clave | Fallar al arrancar sin clave | El link siempre responde (aunque se agote la clave) y el ciclo se prueba sin red |
| D7 | Sesiones en memoria (máx. 200, sin persistencia) | Archivo o base de datos | El PRD no lo exige; los artefactos y los logs sí persisten en `out/` |

## 7. Supuestos

Registrados en la compuerta de validación de la spec ([`specs/02-validacion-spec.md`](specs/02-validacion-spec.md)):

1. **Fecha de ejecución** = hoy (TZ Bogotá), sobreescribible con `FECHA_EJECUCION`. Con la fecha real (nov-2026), la Cámara de Comercio (vence el 30-sep) y los parafiscales (vencen el 31-ago) están **vencidos**, por lo que ningún caso queda listo para firma. Es el comportamiento correcto según RN3.
2. Un campo `requiere_confirmacion` **sí** se escribe en el formulario (tiene fuente), resaltado en amarillo con una nota en la celda.
3. Etiquetas fuera del glosario: normalización (0.95), clave del maestro (0.9), similitud de tokens (0.5–0.8 → por confirmar; < 0.5 → faltante).
4. "Identificación tributaria" y "Número de identificación fiscal" se tratan como ambiguas incluso en CO.
5. "País" se escribe tal cual está en el maestro (`CO`), sin traducir: traducir sería producir un valor que no está en la fuente.
6. Un soporte exigido que no está en el índice (`certificado_cumplimiento_tributario`) es **ausente** y bloquea.
7. Se copian al paquete también los soportes vencidos (marcados en el checklist) para que la analista vea cuál reemplazar.
8. "Envía" es una *petición*; la confirmación es un afirmativo (`sí`, `confirmo`, `adelante`...) en el mensaje siguiente.
9. El envío simulado se permite con el paquete bloqueado, pero el agente lo advierte y `ENVIO-SIMULADO.md` lista los bloqueos. En producción, un paquete bloqueado no debería poder enviarse (ver §10).
10. Los soportes del repositorio los emitió CO; para clientes extranjeros se anota en el checklist.
11. `pa-logistica-istmo` (portal) trae `plantilla-campos.json`, que se usa para producir `valores-portal.md`.

## 8. Cobertura

| HU | Estado | Evidencia | Falta para producción |
|---|---|---|---|
| HU-1 Leer solicitud | ✅ Hecho | `demo.ts` + `ambiguos[]` con el equivalente por país | Parsear el correo real (hoy se recibe ya normalizado) |
| HU-2 Mapear campos | ✅ Hecho | 17/17 en CO; RUC y RTN por confirmar; 2 faltantes | Glosario mantenido por el negocio; aprender sinónimos confirmados |
| HU-3 Formulario | ✅ xlsx (P0) · ✅ pdf (P1) · ✅ portal → `valores-portal.md` (P2) | `demo.ts` relee las celdas del xlsx | Escribir sobre el xlsx/pdf **original** del cliente (AcroForm) en vez de generarlo |
| HU-4 Paquete y confirmación | ✅ Hecho | checklist, borrador sin datos bancarios (verificado en código), `ENVIO-SIMULADO.md` solo con un "sí" | Integración con firma electrónica y correo |
| HU-5 Errores | ✅ Hecho | caso inexistente, ruta maliciosa, herramienta desconocida, timeout y HTTP del LLM → mensaje claro | Alertas y monitoreo |
| Bonus módulo | ✅ Hecho | `modulo/` generado desde las mismas fuentes; `demo.ts` verifica la sincronía | Publicarlo como paquete npm |
| Link público | ⏳ | `render.yaml` + `Dockerfile` listos | Desplegar y pegar la URL en el README |

## 9. Uso de IA

| Asistente | Para qué |
|---|---|
| **Claude (Claude Opus 5.5, en claude.ai)** | Pareja de trabajo durante toda la sesión siguiendo ASDD: lectura del PRD y los fixtures, redacción de los artefactos de `specs/` (intent, spec trazable, validación de ambigüedades, diseño, plan), implementación de herramientas, ciclo, adaptadores y front, `demo.ts` y la documentación |

**Mi rol:** elegir el reto y la metodología (ASDD), validar las decisiones de la compuerta de spec, revisar el código y responder por cada línea entregada.

**Lo que se descartó de las propuestas y por qué:**
- Dejar que el modelo pase los valores del mapeo a `generar_formulario` → descartado (D1).
- Usar el SDK oficial del proveedor → descartado por un adaptador con `fetch` (D4).
- `pdfkit` → descartado por `pdf-lib` (D5).
- `readdirSync({recursive})` → descartado por una función recursiva propia para no depender de la versión de los tipos de Node.
- `toISOString()` para la fecha de ejecución → descartado porque devolvía la fecha UTC (día siguiente en Bogotá por la noche); se usa la fecha local.
- Una expresión regular de confirmación con `\b` → descartada porque `\b` no reconoce el límite después de "í" en "Sí,"; se usa *lookahead*.

## 10. Riesgos de llevarlo a producción

| Riesgo | Mitigación |
|---|---|
| El modelo inventa o "completa" datos | Valores solo desde las herramientas (D1), estado `faltante` explícito, el prompt lo prohíbe y hay muestreo de auditoría sobre `log.jsonl` |
| Envío o firma sin autorización | Compuerta en código (D2). En producción, además: bloquear el envío si `listo_para_firma=false`, aprobación con identidad del usuario (SSO) y registro inmutable |
| Fuga de datos sensibles al proveedor LLM | Enmascarado de cuentas; evaluar que el NIT y los nombres viajen solo como referencias; acuerdo de no retención con el proveedor; despliegue en la región requerida |
| Maestro desactualizado | Dueño del dato, fecha de última actualización por campo y alerta si un valor supera N meses |
| Plantillas reales peores que los fixtures (celdas combinadas, PDF escaneado) | Detectar la estructura del xlsx original; OCR o extracción de AcroForm; si la confianza es baja, `requiere_confirmacion` |
| Costo descontrolado | Tope de iteraciones y tokens por sesión ya implementados; además, tope mensual por clave, *prompt caching* y modelo pequeño para la orquestación |
| Disponibilidad del proveedor LLM | Timeout y mensajes claros; adaptador alterno (OpenAI-compatible) como *fallback* configurable |
| Abuso del link público | `ACCESS_KEY` opcional; en producción, SSO corporativo y rate limiting |
