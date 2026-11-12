# 03 · Dominio y diseño

## Modelo de dominio

```
Solicitud(caso) ──tiene──▶ Plantilla(xlsx: celdas | pdf: campos | portal: —)
      │                        │
      │                        └──▶ CampoSolicitado(etiqueta, obligatorio, hoja?, celda?)
      │                                     │  mapear (glosario → reglas país → similitud)
      │                                     ▼
      │                           CampoMapeado{ estado: lleno | faltante | requiere_confirmacion,
      │                                         ruta?, valor?, confianza, nota? }
      └──exige──▶ Soporte(tipo) ──cruce índice──▶ estado: presente | ausente | vencido
Paquete = formulario + soportes presentes + checklist + borrador  → listo_para_firma = ¬(ausente ∨ vencido)
```

## Máquina de estados de un campo

```
etiqueta ─┬─ ¿regla tributaria de país? ── sí ─▶ (país=CO y etiqueta≠ambigua) ? lleno : requiere_confirmacion
          ├─ glosario exacto ─────────────────▶ conf 1.0
          ├─ glosario normalizado ────────────▶ conf 0.95
          ├─ clave del maestro (snake_case) ──▶ conf 0.9
          └─ similitud de tokens con glosario ▶ conf = Jaccard
conf ≥ 0.8 y ruta existe en maestro  → lleno
0.5 ≤ conf < 0.8 y ruta existe       → requiere_confirmacion
otro caso                            → faltante (valor = null, nunca inventado)
```

## Capas (la separación que se evalúa)

| Capa | Ubicación | Cambia cuando... |
|---|---|---|
| Comportamiento | `agent/prompt.md` | cambia cómo conversa el agente |
| Conocimiento | `src/knowledge/registro-proveedor.md` + `reglas.json` | cambia una regla de negocio (país, umbral, soportes) |
| Ejecución | `src/tools/proveedor.ts` (+ `registro.ts`) | cambia una capacidad |
| Orquestación | `src/agent/ciclo.ts` | cambia el bucle o las compuertas |
| Proveedor LLM | `src/llm/*.ts` detrás de `LlmAdapter` | cambia de modelo o proveedor |
| Transporte | `src/server.ts` | cambia la API |

## Flujo de confirmación (RN4 garantizada en código)

```
turno N:   modelo termina con la marca [[CONFIRMAR]] → servidor: session.pendiente = true; needsConfirmation = true
turno N+1: usuario "sí"  → confirmacionHumana = pendiente ∧ esAfirmativo(msg)
           proveedor_simular_envio({confirmado:true}) → la herramienta exige confirmado ∧ ctx.confirmacionHumana ≠ false
           cualquier otro mensaje → pendiente = false (la confirmación caduca)
```

## API

| Método | Ruta | Respuesta |
|---|---|---|
| POST | `/api/chat` | `{ reply, toolCalls[], needsConfirmation, usage }` |
| GET | `/api/sessions/:id` | historial completo |
| GET | `/api/health` | `{ ok, provider, model }` |
| GET | `/api/casos` | casos disponibles (ayuda del front) |
| GET | `/api/out/<caso>/<archivo>` | descarga de artefactos generados (path traversal bloqueado) |
