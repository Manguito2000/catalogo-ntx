# Cobranzas del portal de ventas NTX — estado y contrato (nov 2026)

Hecho y probado: datos, conciliación, receptor y la pestaña «Cobros» del portal (lista de pendientes, registrar cobro, por entregar, recibo en imagen, cola sin conexión).
La pestaña vive en `cobranzas_pagina.js/.css`; `aplicar_cobranzas.py plano.json` la inyecta en el catálogo (flujo: `portal.py abrir` → `aplicar_cobranzas.py` → `portal.py armar`). Es repetible.
El receptor devuelve en cada cobro `pg` (ids de los pagos de Holded con que se confirmó): la página lo usa para que el saldo no rebote entre la confirmación y el siguiente refresco de datos.json.

## Datos que ya recibe la página (datos.json, dentro del bloque cifrado de cada vendedor)
`nt` = notas de sus clientes, pendientes y saldadas en los últimos 21 días. Cada una:
`[id, número, idCliente, fecha, vence, total, pagado, pendiente, tarifa, desc%, saldoReal, saldoBs, [[idPago, monto, fecha]]]`
- `tarifa`: `u` USD, `l` Lista, `b` BCV, `?` sin determinar (mostrar solo saldoReal).
- `saldoReal`: lo que falta en dólares reales. `saldoBs` (solo BCV): lo que falta si paga en Bs a tasa BCV (= saldoReal / 0,85).
- Vencida si `vence` < hoy (fechas en segundos). Se refresca 12:40 pm y 6:40 pm, lunes a sábado.

## Reglas de negocio (confirmadas por Mango)
- Nota BCV pagada en bolívares: el cliente paga $100 y se abonan $85 (x 0,85). En divisas (efectivo, Zelle, USDT) abona 1:1 contra saldoReal.
- Nota USD pagada en Bs (raro): el vendedor pone monto en $ y la tasa; abona 1:1.
- `abono = efectivo + usdt + zelle + bs x (tarifa == 'b' ? 0.85 : 1)`. El recibo del cliente muestra lo cobrado, nunca el 85.
- Saldo que ve el vendedor = saldoReal − cobros suyos en estado cobrado/revisar (`saldoVisible` en conciliar.js), con "abono por confirmar $X".
- Recibo: imagen con logo + texto acompañante ("Recibo G-0042 · Cliente · Nota NE1234 · Abono $100 · Saldo $900"), leyenda "sujeto a verificación".
  Compartir con navigator.share (archivo + texto); si no se puede, solo texto por wa.me.
- Entrada: pestaña inferior "Catálogo | Cobranzas". Pantallas: Pendientes (por cliente, total por cobrar y vencido) · Registrar cobro · Por entregar (total en efectivo).

## Receptor (mismo /exec que los pedidos; GET; responde JSON). Siempre con `cod` (código del vendedor) y `d` (id del dispositivo), igual que `a=entrar`.
- `a=cobro&c=<base64url de JSON>` con `{id (uuid generado en el teléfono, ≥8 caracteres), n (id de la nota), ef, us, ze, bs (montos en $), ab (abono real), ta (tasa, opcional), rf (referencia, opcional)}`
  → `{estado:"ok", cobro:{rec:"G-0001", id, n, nn, cn, t, nom, ab, ef, us, ze, bs, ta, rf, est, obs}}`. Reenviar el mismo `id` no duplica (`repetido:true`).
  Errores → `{estado:"error", msg}` (mostrar msg tal cual). `{estado:"no"}` = dispositivo o código no autorizado.
  Sin conexión: guardar en el teléfono y reenviar con el mismo `id`; el número de recibo lo da el receptor.
- `a=cobros` → `{estado:"ok", cobros:[...]}`: los pendientes y los confirmados/anulados de los últimos 7 días. `est`: cobrado | revisar | confirmado | anulado ("revisar" se muestra al vendedor como por confirmar).
- `a=anular&r=G-0001` → anula un cobro propio no confirmado; devuelve la lista actualizada.

## Archivos
- `refrescar_datos.py`: arma `nt`. · `conciliar.js` + `conciliar_pruebas.js`: lógica y 14 casos (`node herramientas/conciliar_pruebas.js`).
- `cobranzas_apps_script.gs`: archivo aparte del proyecto de Apps Script (hoja "Cobranzas NTX", conciliación cada hora, solo lee Holded). Incluye una copia de conciliar.js: si se cambia uno, cambiar el otro.
- `receptor_apps_script.gs`: una línea nueva en doGet que enruta cobro/cobros/anular.
