# 00 · Intent

**Problema.** La analista administrativa de Periferia transcribe a mano, campo por campo, entre 8 y 12 formularios de registro como proveedor al mes. Los datos ya están en un repositorio maestro, pero el proceso depende de una sola persona y comete errores en datos sensibles (NIT, cuenta bancaria).

**Actor principal.** La analista administrativa, que conversa con el agente.

**Resultado esperado.** A partir de una solicitud recibida por correo, el agente:
1. identifica qué campos y qué soportes pide el cliente;
2. llena los campos **solo** desde el maestro y nunca inventa;
3. genera el formulario en el formato pedido (xlsx, pdf o valores para portal);
4. arma el paquete para firma (formulario, soportes, checklist y borrador de correo);
5. **se detiene y pregunta** antes de cualquier acción externa.

**Medida de éxito.** Cero transcripción manual en xlsx y pdf para los campos que existen en el maestro, el 100 % de los faltantes explícitos y cero acciones externas sin confirmación.

**Fuera de alcance.** Firma, envío real, portales reales, autenticación y base de datos.
