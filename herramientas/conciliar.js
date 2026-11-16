/* Conciliación de cobranzas NTX. Función pura (sin red ni almacenamiento): sirve igual en el receptor (Apps Script) y en la página.
   Holded es la única verdad. Un cobro anotado por un vendedor queda "cobrado" hasta que en Holded aparecen pagos NUEVOS de esa nota
   que cuadran con él; entonces pasa a "confirmado". Nunca se compara el saldo (cambia si se pone el 15 % después): se usan los pagos, por su id.

   nota   = { pendiente, pagos: [[idPago, monto, fecha]] }                       (tal como sale en datos.json / Holded paymentsDetail)
   cobros = [{ id, fecha, abono, bs, base, estado, pagos }]  de ESA nota:
            abono  = dólares reales que el cobro le quita a la nota (pago en Bs de una nota BCV: nominal x 0,85)
            bs     = true si alguna parte entró en bolívares (tolerancia mayor: el valor real lo fija administración)
            base   = ids de los pagos que la nota ya tenía en Holded cuando el receptor recibió el cobro (lo pone el receptor, en vivo)
            estado = "cobrado" | "revisar" | "confirmado" | "anulado";  pagos = [[idPago, montoUsado]] cuando está confirmado
   ahora  = segundos (para avisar de cobros viejos)
   Devuelve solo los cambios: [{ id, estado, pagos?, obs }].  "revisar" sigue contando como pendiente para el vendedor. */
function conciliar(nota, cobros, ahora) {
  var C = function (x) { return Math.round((Number(x) || 0) * 100); }, D = function (c) { return (c / 100).toFixed(2); };
  var tol = function (c) { return Math.max(50, c.bs ? Math.round(C(c.abono) * 0.03) : 0); };
  var pend = cobros.filter(function (c) { return c.estado === "cobrado" || c.estado === "revisar"; })
                   .sort(function (a, b) { return (a.fecha || 0) - (b.fecha || 0) || String(a.id).localeCompare(String(b.id)); });
  if (!pend.length) return [];
  var usado = {};
  cobros.forEach(function (c) { if (c.estado === "confirmado") (c.pagos || []).forEach(function (p) { usado[p[0]] = (usado[p[0]] || 0) + C(p[1]); }); });
  // Un pago es "nuevo" para el conjunto si no existía antes del cobro pendiente más viejo y le queda monto sin asignar.
  var base = {}; (pend[0].base || []).forEach(function (id) { base[id] = 1; });
  var libres = (nota.pagos || []).filter(function (p) { return !base[p[0]]; })
      .map(function (p) { return { id: p[0], r: C(p[1]) - (usado[p[0]] || 0), f: p[2] || 0 }; })
      .filter(function (p) { return p.r > 0; }).sort(function (a, b) { return a.f - b.f; });
  var S = libres.reduce(function (s, p) { return s + p.r; }, 0), out = [];
  var marca = function (c, obs) { if (c.estado !== "revisar" || c.obs !== obs) out.push({ id: c.id, estado: "revisar", obs: obs }); };
  if (S > 0) {
    // Busca qué cobros explican exactamente lo que entró. Prefiere los más viejos; si no hay combinación, no confirma nada.
    var n = Math.min(pend.length, 12), mejor = null;
    for (var m = 1; m < (1 << n); m++) {
      var s = 0, t = 0;
      for (var i = 0; i < n; i++) if (m & (1 << i)) { s += C(pend[i].abono); t += tol(pend[i]); }
      if (Math.abs(s - S) <= t && (mejor === null || orden(m) < orden(mejor))) mejor = m;
    }
    if (mejor !== null) {
      var q = 0;
      for (var j = 0; j < n; j++) if (mejor & (1 << j)) {
        var falta = C(pend[j].abono), ps = [];
        while (q < libres.length) {
          var ult = !resto(mejor, j), usa = ult && q === libres.length - 1 ? libres[q].r : Math.min(libres[q].r, falta);
          if (usa > 0) { ps.push([libres[q].id, usa / 100]); libres[q].r -= usa; falta -= usa; }
          if (libres[q].r <= 0) q++;
          if (falta <= 0 && !(ult && q < libres.length)) break;
        }
        out.push({ id: pend[j].id, estado: "confirmado", pagos: ps, obs: "Registrado en Holded" });
      }
      return out;
    }
    var lista = pend.map(function (c) { return "$" + D(C(c.abono)); }).join(", ");
    pend.forEach(function (c) { marca(c, "En Holded entraron $" + D(S) + " que no cuadran con lo anotado (" + lista + ")"); });
    return out;
  }
  pend.forEach(function (c) {
    var dias = Math.floor(((ahora || 0) - (c.fecha || 0)) / 86400);
    if (C(nota.pendiente) < 1) marca(c, "La nota ya está saldada en Holded y este cobro no se reconoció");
    else if (dias >= 10) marca(c, "Lleva " + dias + " días sin registrarse en Holded");
  });
  return out;
  function orden(m) { var v = 0; for (var i = 0; i < n; i++) if (m & (1 << i)) v += i * 100 + 1; return v; }   // menos cobros y más viejos primero
  function resto(m, j) { return (m >> (j + 1)) !== 0; }
}
/* Saldo que ve el vendedor: lo que dice Holded menos sus cobros todavía no confirmados. */
function saldoVisible(saldoReal, cobros) {
  var p = cobros.filter(function (c) { return c.estado === "cobrado" || c.estado === "revisar"; }).reduce(function (s, c) { return s + (Number(c.abono) || 0); }, 0);
  return { porConfirmar: Math.round(p * 100) / 100, saldo: Math.max(0, Math.round((saldoReal - p) * 100) / 100) };
}
if (typeof module !== "undefined") module.exports = { conciliar: conciliar, saldoVisible: saldoVisible };
