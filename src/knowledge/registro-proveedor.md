# Conocimiento del proceso: registro de Periferia como proveedor

> Capa de **conocimiento**. El servidor no la interpreta: se inyecta al system prompt y sus parámetros numéricos y por país viven en `reglas.json`, que leen las herramientas. Cambiar una regla de negocio = editar estos dos archivos.

## Flujo estándar de un caso
1. **Leer la solicitud** (`proveedor_leer_solicitud`): país, cliente, formato (xlsx | pdf | portal), campos pedidos y soportes exigidos. Revisar `ambiguos`.
2. **Mapear campos** (`proveedor_mapear_campos`): cada campo queda `lleno`, `faltante` o `requiere_confirmacion`.
3. **Generar el formulario** (`proveedor_generar_formulario`): xlsx en las celdas exactas, pdf en el orden dado; un portal no se automatiza y se generan los valores para copiar.
4. **Armar el paquete** (`proveedor_armar_paquete`): formulario, soportes, `checklist.md` y `borrador-correo.md`.
5. **Resumir y preguntar.** Nunca se envía ni se firma sin confirmación explícita.
6. **Envío simulado** (`proveedor_simular_envio`): solo tras un "sí" explícito del usuario.

## Identificador tributario por país (RN1)
| País | Nombre local |
|---|---|
| Colombia (CO) | NIT |
| Ecuador (EC), Perú (PE), Panamá (PA) | RUC |
| Honduras (HN) | RTN |

Periferia solo tiene NIT colombiano. Fuera de CO el campo se llena con el NIT y queda en `requiere_confirmacion` con la nota "identificador extranjero": la analista debe confirmar con el cliente si acepta el NIT o si se necesita un registro local.

## Datos bancarios (RN2)
- Solo se llenan si la plantilla los pide.
- Nunca van en el borrador de correo.
- El número de cuenta se muestra enmascarado en el chat y en los logs; completo solo dentro del formulario.

## Soportes (RN3)
- **Presente**: existe en el repositorio y está vigente (o no tiene vencimiento, como el RUT).
- **Vencido**: `vigencia_hasta` anterior a la fecha de ejecución. Bloquea la firma. La Cámara de Comercio dura 30 días: hay que pedir uno nuevo.
- **Ausente**: el cliente lo exige y no existe en el repositorio. Bloquea la firma.
- Un campo faltante **no** bloquea, pero aparece en el checklist para completarlo a mano o pedirlo al dueño del dato.
- Todos los soportes del repositorio los emitió Colombia; para clientes extranjeros se indica en el checklist.

## Qué hacer con cada estado de campo
| Estado | Acción de la analista |
|---|---|
| `lleno` | Ninguna. El valor sale del maestro (ruta trazable). |
| `requiere_confirmacion` | Validar el valor propuesto antes de firmar (identificador extranjero, mapeo de baja confianza o etiqueta ambigua). |
| `faltante` | Conseguir el dato con su dueño. El agente nunca lo inventa. |

## Portales web
No se automatizan. El agente entrega `valores-portal.md` y la analista ingresa al portal con las credenciales que recibió el representante legal. El ingreso de credenciales y el clic en "Enviar" siempre son humanos.
