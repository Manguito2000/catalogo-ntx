# Cobranzas del portal de ventas NTX — estado y contrato (nov 2026)

Hecho y probado: datos, conciliación, receptor y la pestaña «Cobros» del portal (lista de pendientes, registrar cobro, por entregar, recibo en imagen, cola sin conexión).
La pestaña vive en `cobranzas_pagina.js/.css`; `aplicar_cobranzas.py plano.json` la inyecta en el catálogo (flujo: `portal.py abrir` → `aplicar_cobranzas.py` → `portal.py armar`). Es repetible.
El receptor devuelve en cada cobro `pg` (ids de los pagos de Holded con que se confirmó): la página lo usa para que el saldo no rebote entre la confirmación y el siguiente refresco de datos.json.

## Datos que ya recibe la página (datos.json, dentro del bloque cifrado de cada vendedor)
`nt` = notas de sus clientes, pendientes y saldadas en los últimos 21 días. Cada una:
`[id, número, idCliente, fecha, vence, total, pagado, pendiente, tarifa, desc%, saldoReal, saldoBs, [[idPago, monto, fecha]]]`
- `tarifa`: `u` USD, `l` Lista, `b` BCV, `?` sin determinar (mostrar solo saldoReal).
- `saldoReal`: lo que falta en dólares reales. `saldoBs` (solo BCV): lo que falta si paga en Bs a tasa BCV (= saldoReal / 0,85).
- Vencida si el día de `vence` < hoy. Ojo: Holded da las fechas en segundos como medianoche de España; para el día de calendario se suma 2 h y se lee en UTC (`cbDia` en cobranzas_pagina.js). Se refresca 12:40 pm y 6:40 pm, lunes a sábado.

## Reglas de negocio (confirmadas por Mango)
- Nota BCV pagada en bolívares: el cliente paga $100 y se abonan $85 (x 0,85). En divisas (efectivo, Zelle, USDT) abona 1:1 contra saldoReal.
- Nota USD pagada en Bs (raro): el vendedor pone monto en $ y la tasa; abona 1:1.
- `abono = efectivo + usdt + zelle + bs x (tarifa == 'b' ? 0.85 : 1)`. El recibo del cliente muestra lo cobrado, nunca el 85.
- Saldo que ve el vendedor = saldoReal − cobros suyos en estado cobrado/revisar (`saldoVisible` en conciliar.js), con "abono por confirmar $X".
- Recibo: imagen con logo + texto acompañante ("Recibo G-0042 · Cliente · Nota NE1234 · Abono $100 · Saldo $900"), leyenda "sujeto a verificación".
  Compartir con navigator.share (archivo + texto); si no se puede, solo texto por wa.me.
- Entrada: pestaña inferior "Catálogo | Cobranzas". Pantallas: Pendientes (por cliente, total por cobrar y vencido) · Registrar cobro · Por entregar (total en efectivo).

## Receptor (mismo /exec que los pedidos; GET; responde JSON). Siempre con `cod` (código del vendedor) y `d` (id del dispositivo), igual que `a=entrar`.
- `a=cobro&x=<base64url de JSON>` (nunca usar parámetros llamados `c` o `sid`: Google Apps Script los reserva y responde un error sin llegar al script) con `{id (uuid generado en el teléfono, ≥8 caracteres), n (id de la nota), ef, us, ze, bs (montos en $), ab (abono real), ta (tasa, opcional), rf (referencia, opcional)}`
  → `{estado:"ok", cobro:{rec:"G-0001", id, n, nn, cn, t, nom, ab, ef, us, ze, bs, ta, rf, est, obs}}`. Reenviar el mismo `id` no duplica (`repetido:true`).
  Errores → `{estado:"error", msg}` (mostrar msg tal cual). `{estado:"no"}` = dispositivo o código no autorizado.
  Sin conexión: guardar en el teléfono y reenviar con el mismo `id`; el número de recibo lo da el receptor.
- `a=cobros&ids=<ids de notas separados por coma>` → `{estado:"ok", cobros:[...], nt:{id:[total,pagado,pendiente,desc%,pagos]|null}}` (`nt` = saldos de Holded al momento; la página los aplica con `cbVivo`): los pendientes y los confirmados/anulados de los últimos 7 días. `est`: cobrado | revisar | confirmado | anulado ("revisar" se muestra al vendedor como por confirmar).
- `a=anular&r=G-0001` → anula un cobro propio no confirmado; devuelve la lista actualizada.

## Archivos
- `refrescar_datos.py`: arma `nt`. · `conciliar.js` + `conciliar_pruebas.js`: lógica y 14 casos (`node herramientas/conciliar_pruebas.js`).
- `cobranzas_apps_script.gs`: archivo aparte del proyecto de Apps Script (hoja "Cobranzas NTX", conciliación cada hora, solo lee Holded). Incluye una copia de conciliar.js: si se cambia uno, cambiar el otro.
- `receptor_apps_script.gs`: una línea nueva en doGet que enruta cobro/cobros/anular.

## Notas BCV y descuento BCV (nov 2026, regla de Mango)
- El vendedor ve y cobra las notas BCV en **dólares a tasa BCV** (`nt[11]`): sin factores ni calculadora. La conversión a dólares reales es de administración.
- Pago en bolívares de una nota BCV: abona 1 a 1 en dólares BCV. Pago en divisas: se abre el campo "Descuento por pago en divisas" (por defecto el descuento BCV; el vendedor puede poner otro): abona divisas / (1 − desc).
- Cada cobro lleva `bv` (abono en dólares de la nota), `dd` (descuento aplicado a divisas) y `tb` ("b" si la nota es BCV); `ab` sigue siendo dólares reales (bolívares × factor BCV + divisas) para conciliar con los pagos de Holded.
- **El descuento BCV es un solo número, en `config.json` (raíz del repo, `descuento_bcv`).** Lo leen el portal, `refrescar_datos.py` y el receptor (vía GitHub Pages, caché 10 min). Para cambiarlo: editar ese número, rearmar el portal y publicar. Nada más.
- Colores: `--red-tx` es el rojo para texto (más oscuro de día, coral de noche); `--red` queda solo para fondos y bordes.

## Facturas AdriMan (nov 2026) — parte 1 lista: datos y receptor
- **Vínculo nota → factura**: al emitir la factura fiscal real, Claude etiqueta la nota en Holded con `fac000004` (y `iva1213` = IVA en centavos de dólares de la nota).
  `PUT documents/invoice/<id>` con `{"tags": [...las que tenía, "fac…", "iva…"], "discount": <el mismo de la nota>}`. **Ojo: un PUT sin `discount` lo pone en 0** (probado en NE4244; se restauró). Releer y comparar después.
- `datos.json` → `nt[13]` = `[número, iva|null]` o `null`. `a=cobros` devuelve además `nt[id][5]` (lo mismo, en vivo), `sol` (solicitudes del vendedor) y `ret` (retención por nota).
- Monto: el saldo de siempre es el **neto**. El IVA es solo informativo para el vendedor (16 % de la base; si viene la etiqueta iva se usa esa).
- Rutas nuevas (GET, con `cod` y `d`): `solfac&x={n, cm}` · `solcancel&r=<id>` · `ret&x={n, rt: 0|75|100, cp: ""|whatsapp|fisico|adjunto}`.
  POST (texto JSON) `{a:"ret", cod, d, x:{n, rt}, nombre, tipo, b64}` sube el comprobante (foto o PDF ≤ 9 MB) a Drive, carpeta "Retenciones NTX".
- Bandeja de Mango (Pedidos NTX): `a=adm&k=ADMIN` → `{sol, ret}`; `a=admacc&k=ADMIN&s=<id>&e=pendiente|descartada` o `&r=<idNota>&e=recibido|pendiente`.
  Las solicitudes pasan solas a "emitida" en la conciliación de cada hora cuando la nota ya tiene la etiqueta fac. No se envía ningún correo.
- Hojas nuevas en "Cobranzas NTX": "Solicitudes factura" y "Retenciones". En "Cobros", columna nueva "Factura".
- En el receptor, doGet enruta con `if (esCobranzas(q.a)) return json(cobranzas(q));`.

## Facturas AdriMan — parte 2: pantallas del portal (nov 2026)
- Vendedor: en cada nota, botón «Pedir factura legal» (con comentario ≤600 car.) → `a=solfac`; cuando la nota trae factura (`nt[13]`) se ve «Factura AdriMan ######», IVA (solo ver, `config.json` → `iva`, 16 %), chips de retención (No retiene / 75 % / 100 %) y comprobante (subir aquí / WhatsApp / físico). La subida va por POST (text/plain JSON) al receptor → carpeta Drive «Retenciones NTX». El monto a cobrar es el NETO; el IVA que paga el cliente = IVA − retención.
- Admin: pestaña ADMIN del portal, visible solo con el código de Mango (tag `rm`). La llave `adm` viaja únicamente dentro de los datos cifrados de rm (`refrescar_datos.py` la toma del campo `admin` de vendedores_ext o de la variable `NTX_ADMIN`; nunca va al repo). Pestañas Facturas / Retenciones, «Copiar para Claude», Descartar/Reabrir, Marcar recibido. Sondeo cada 180 s; insignia roja con pendientes.
- Build: `aplicar_cobranzas.py` es idempotente (fase 1 cobranzas + fase 2 ADMIN).
- Pendiente de verificar en vivo: subida real a Drive y doPost (desde el sandbox script.google.com está bloqueado; solo se probó con receptor falso).

## Captura del pago, tasa BCV e IVA en el cobro (22 nov 2026, parte 1 del historial de cobranzas)
- **Lector en el teléfono**: en «Registrar cobro» el vendedor adjunta la captura (Zelle, Binance/USDT-USDC, pago móvil, transferencia, Mercantil Panamá). `ocr/` sirve Tesseract.js 5.1.1 + modelo `spa`; el teléfono lo baja la primera vez. Hasta 3 lecturas (tal cual · preparada: gris, invertida si es oscura, contraste · texto suelto, psm 11). `lxLee()` (bloque `/*LECTOR*/` de cobranzas_pagina.js) saca método, monto, fecha (dd/mm; si se cruza con mm/dd, la más cercana al día de la imagen), hora, referencia y cuenta destino. Probado con 11 capturas reales (fuera del repo: tienen datos personales).
- **Cuentas de la empresa** (`CB_CTAS`): `[{id, nombre, met: ze|us|bs|mp, claves:[texto sin espacios ni acentos], solo_factura?, sin_factura?}]`. NO van en el repo: están en el documento `datos/vendedores_ext` del artefacto Pedidos NTX (campo `cuentas`, el mismo V.json de portal.py) y `aplicar_cobranzas.py plano.json V.json` las inyecta en el catálogo cifrado. `solo_factura` / `sin_factura` encienden el aviso de cuenta equivocada (apagados hasta que las facturas se cobren en la cuenta de AdriMan).
- **Avisos al vendedor** tras leer: forma de pago o monto no encontrados, cuenta destino no reconocida, captura sin fecha (se usa la de la imagen), pago repetido (misma referencia, o mismo monto y fecha que otro cobro suyo).
- **Bolívares**: fila «Monto en Bs · Tasa · Fecha del pago». Nota BCV: la tasa BCV de la fecha del pago se pone sola (`cbTasaDe`, de `tasas` del receptor) y se puede cambiar. Nota USD: «Tasa acordada», obligatoria si hay bolívares. Dólares = Bs ÷ tasa.
- **Mercantil Panamá** (`mp`): forma de pago nueva (divisa, abona 1:1; en nota BCV con el descuento de divisas).
- **IVA de notas facturadas**: si con el saldo neto entra más, el excedente en bolívares es IVA (`iv`): no abona a la nota ni va a Holded. `bv` = neto abonado, `ab` = (bs − iv) × factor + divisas. Al guardar, `cbIvaDetecta` compara el IVA recibido con el que corresponde al neto cubierto: ≥97 % completo (retención 0) · 22–28 % → retención 75 % · nada y neto completo → 100 % · otro → aviso de IVA incompleto. Marca la retención sola (`ret`) y avisa que falta el comprobante. Un cobro solo de IVA (neto ya cobrado) queda «confirmado» con obs «Solo IVA».
- **Captura guardada**: tras guardar el cobro, el teléfono la reduce (1400 px, JPEG) y la sube por POST `{a:"cap", cod, d, x:{id}, tipo, b64}` → carpeta Drive «Comprobantes NTX», enlace en la columna Captura. Cola en el teléfono (`ntx-cap-cola`): espera a que el cobro llegue al receptor; 6 intentos como máximo.
- **Campos nuevos del cobro** (`a=cobro`): `mp, iv, bsb` (monto en Bs), `tbc` (tasa BCV usada), `fp` (fecha del pago aaaa-mm-dd), `ct` (id de cuenta o "?"), `cd` (destino leído si no se reconoció), `lx` (resumen de la lectura). El receptor responde además `aviso` (referencia repetida en cualquier vendedor).
- **Hoja Cobros, columnas nuevas al final**: Mercantil Panamá $, IVA cobrado $, Monto Bs, Tasa BCV, Fecha del pago, Cuenta destino, Destino leído, Cuenta Holded, Captura, Lectura, Avisos. **Cuenta Holded** = dónde registrar cada parte (cuentas ACTIVAS): efectivo CAJA CHICA · USDT/USDC USDT · Zelle NUEVO ZELLE · Mercantil Panamá MERCANTIL PANAMÁ · bolívares «Caja para Operaciones en Tránsito», o «Bolivares Cuenta Juridica» si la nota tiene factura (`CUENTA_HOLDED`).
- **Tasa BCV**: `tasaBcvLeer()` lee bcv.org.ve (tasa y «Fecha Valor»; si falla, ve.dolarapi.com) y la guarda por fecha valor en la hoja «Tasas BCV». La conciliación de cada hora la refresca si pasaron 3 h (`tasaBcvAlDia`). `a=cobros` devuelve `tasas: [[fecha, tasa]]` (últimas 60).
- Pruebas: `node herramientas/conciliar_pruebas.js` (sin cambios). El receptor se probó con Google y Holded simulados, y el portal armado en Chrome con capturas reales y receptor simulado (scripts fuera del repo).
- Siguiente (parte 2, pantallas): «Mis recibos» (archivo por nota, 3 meses, incluye pagos registrados por administración). Parte 3: ADMIN › Cobros (por registrar con un toque, cuenta distinta contra Holded, «Por anotar en carpeta» desde todos los pagos de Holded, cobro desde administración con serie A-).
