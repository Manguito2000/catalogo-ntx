/* Descuento de contado en notas a crédito (23 nov 2026, regla de Mango). Función pura: sirve igual en el receptor (Apps Script) y en la página.
   Si el cliente paga dentro de los primeros N días hábiles de la nota (config.json → contado_dias_habiles, hoy 4), el descuento
   (config.json → descuento_contado, hoy 15 %) se aplica solo y administración recibe el aviso. Si paga después, queda por aprobar.

   Cómo se cuentan los días hábiles: el día en que se hizo la nota NO cuenta; se cuentan de lunes a viernes, sin feriados
   (config.json → feriados), hasta el día del pago inclusive. Nota del lunes pagada el viernes = 4 días hábiles → automático.
   Día del pago = la fecha del pago (la de la captura o la que se escribió); si falta, hoy. Nunca después de hoy ni antes de la nota.

   Fechas siempre como texto aaaa-mm-dd (día de calendario en Venezuela). */
function chDia(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
function chTxt(t) { var d = new Date(t); return d.getUTCFullYear() + "-" + ("0" + (d.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + d.getUTCDate()).slice(-2); }
/* días hábiles DESPUÉS de "desde" y hasta "hasta" inclusive (0 si es el mismo día o antes) */
function diasHabiles(desde, hasta, feriados) {
  var a = chDia(desde), b = chDia(hasta), fer = {}, n = 0;
  if (isNaN(a) || isNaN(b)) return NaN;
  (feriados || []).forEach(function (f) { fer[String(f)] = 1; });
  for (var t = a + 86400000; t <= b && n < 400; t += 86400000) {
    var w = new Date(t).getUTCDay();
    if (w !== 0 && w !== 6 && !fer[chTxt(t)]) n++;
  }
  return n;
}
/* ¿El descuento de contado se aplica solo?
   o = { nota: "aaaa-mm-dd", pago: "aaaa-mm-dd" | "", hoy: "aaaa-mm-dd", limite: 4, feriados: [...] }
   → { dh: días hábiles hasta el pago, pago: día usado, auto: true | false } */
function contadoDecide(o) {
  var hoy = o.hoy, pago = /^\d{4}-\d{2}-\d{2}$/.test(String(o.pago || "")) ? String(o.pago) : hoy;
  if (chDia(pago) > chDia(hoy)) pago = hoy;
  if (chDia(pago) < chDia(o.nota)) pago = o.nota;
  var lim = Number(o.limite) >= 0 ? Number(o.limite) : 4, dh = diasHabiles(o.nota, pago, o.feriados);
  return { dh: dh, pago: pago, auto: !isNaN(dh) && dh <= lim };
}
/* Monto del descuento: sobre el total de la nota SIN descuento (Holded aplica el descuento a toda la nota). */
function contadoMonto(baseNota, pct) { return Math.round((Number(baseNota) || 0) * (Number(pct) || 0)) / 100; }
/* Descuento que hace cuadrar lo recibido (para administración): el % con que la nota queda saldada con lo que ya entró y lo que se va a registrar.
   pendiente = lo que Holded dice que falta HOY (sin descuento), recibido = lo que se va a registrar (y los demás cobros sin registrar), base = total sin descuento.
   → % con dos decimales (0 si no hace falta descuento; null si haría falta más del 50 %). */
function contadoCuadre(pendiente, recibido, base) {
  var falta = Math.round(((Number(pendiente) || 0) - (Number(recibido) || 0)) * 100) / 100;
  if (falta <= 0.009) return 0;
  if (!(base > 0)) return null;
  var p = Math.round(falta / base * 10000) / 100;
  return p > 50 ? null : p;
}
if (typeof module !== "undefined") module.exports = { diasHabiles: diasHabiles, contadoDecide: contadoDecide, contadoMonto: contadoMonto, contadoCuadre: contadoCuadre };
