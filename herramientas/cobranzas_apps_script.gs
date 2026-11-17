// COBRANZAS del portal de ventas NTX. Archivo aparte dentro del mismo proyecto de Apps Script del receptor (usa sus funciones y VENDEDORES).
// No contiene secretos: la clave de Holded va en Configuración del proyecto › Propiedades de la secuencia de comandos (HOLDED_KEY).
// Qué hace:
//   ?a=cobro&x=…   el vendedor anota un cobro (el receptor le da número de recibo y guarda qué pagos tenía la nota en Holded en ese momento)
//   ?a=cobros  devuelve al vendedor sus cobros (por entregar / por confirmar / confirmados recientes)
//   ?a=anular  el vendedor anula un cobro suyo que aún no esté confirmado
//   conciliarCobros()  corre sola cada hora: mira Holded (solo lectura) y confirma los cobros cuyos pagos ya registró administración
//   instalarCobranzas()  se ejecuta UNA vez a mano: crea la hoja "Cobranzas NTX" y el reloj de cada hora
// Solo LEE Holded. Nunca registra pagos ni cambia nada allá.
var COB_COLS = ["Recibo", "Fecha", "Vendedor", "Cliente", "Nota", "Cobrado $", "Abono real $", "Efectivo $", "USDT $", "Zelle $", "Bs (en $)", "Tasa", "Referencia",
  "Estado", "Observación", "Confirmado el", "ts", "tag", "notaId", "uid", "base", "pagos", "dispositivo",
  "Tarifa", "Desc. divisas %", "Abono a la nota $", "Factura"];   // columnas nuevas al final (nov 2026): BCV o USD, descuento por pago en divisas, abono en dólares de la nota, factura AdriMan de la nota

/* Descuento BCV (%): un solo número para todo el sistema, en config.json del repositorio del portal. Se lee cada 10 minutos; si no responde, 15. */
function descuentoBcv() {
  var cache = CacheService.getScriptCache(), v = Number(cache.get("COB_DBCV"));
  if (v > 0) return v;
  try { v = Number(JSON.parse(UrlFetchApp.fetch("https://manguito2000.github.io/catalogo-ntx/config.json", { muteHttpExceptions: true }).getContentText()).descuento_bcv); } catch (e) { v = 0; }
  if (!(v > 0 && v < 90)) v = 15;
  try { cache.put("COB_DBCV", String(v), 600); } catch (e) {}
  return v;
}
var COB = {}; COB_COLS.forEach(function (c, i) { COB[c] = i; });

// Rutas de cobranzas y facturas. En el receptor, doGet las enruta con: if (esCobranzas(q.a)) return json(cobranzas(q));
var COB_ACC = { cobro: 1, cobros: 1, anular: 1, solfac: 1, solcancel: 1, ret: 1, adm: 1, admacc: 1 };
function esCobranzas(a) { return COB_ACC.hasOwnProperty(String(a || "")); }
function cobranzas(q) {
  try {
    if (q.a === "adm" || q.a === "admacc") return fcAdmin(q);           // bandeja de Mango (Pedidos NTX), con la llave ADMIN
    var tag = vendedorDe(q);
    if (!tag) return { estado: "no", msg: "Dispositivo o código no autorizado" };
    if (q.a === "cobro") return cobroNuevo(tag, q);
    if (q.a === "anular") return cobroAnular(tag, q);
    if (q.a === "solfac") return fcSolicitar(tag, q);
    if (q.a === "solcancel") return fcCancelar(tag, q);
    if (q.a === "ret") return fcRetencion(tag, fcLee(q.x), "");
    var vivo = null; try { vivo = saldosVivos(q.ids); } catch (e2) {}          // si Holded falla, los cobros se devuelven igual
    var fx = { sol: [], ret: {} }; try { fx = fcDelVendedor(tag); } catch (e3) {}
    return { estado: "ok", cobros: cobrosDe(tag), nt: vivo, sol: fx.sol, ret: fx.ret };
  } catch (err) { return { estado: "error", msg: String(err && err.message || err) }; }
}
// Mismo control que el portero: código correcto, vendedor no bloqueado y dispositivo ya aprobado.
function vendedorDe(q) {
  var cod = String(q.cod || "").toUpperCase().replace(/[^A-Z0-9]/g, ""), disp = String(q.d || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
  if (!cod || disp.length < 12) return null;
  var h = sha(cod), tag = null;
  for (var t in VENDEDORES) if (VENDEDORES[t].h === h) tag = t;
  if (!tag) return null;
  var st = estado(tag);
  return st.bloq || !buscar(st.disp, disp) ? null : tag;
}
function cobroNuevo(tag, q) {
  var c, b64 = String(q.x || "");   // el cobro llega en "x": Google reserva los nombres "c" y "sid" y rechaza la petición si se usan
  if (!/^[A-Za-z0-9_-]{20,3000}$/.test(b64)) return { estado: "error", msg: "Cobro incompleto" };
  while (b64.length % 4) b64 += "=";
  try { c = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString("UTF-8")); } catch (e) { return { estado: "error", msg: "No se pudo leer el cobro" }; }
  var num = function (x) { x = Math.round((Number(x) || 0) * 100) / 100; return x > 0 && x < 1e6 ? x : 0; };
  var uid = String(c.id || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 40), nid = String(c.n || "").replace(/[^a-f0-9]/g, "");
  var ef = num(c.ef), us = num(c.us), ze = num(c.ze), bs = num(c.bs), nom = Math.round((ef + us + ze + bs) * 100) / 100, ab = num(c.ab);
  if (uid.length < 8 || nid.length !== 24) return { estado: "error", msg: "Cobro incompleto" };
  if (nom <= 0) return { estado: "error", msg: "El monto debe ser mayor que cero" };
  // El abono real solo puede ser menor que lo cobrado por la parte en bolívares de una nota BCV (x 0,85).
  var F = 1 - descuentoBcv() / 100, tb = c.tb === "b", dd = tb ? Math.max(0, Math.min(50, Number(c.dd) || 0)) : 0;
  var bv = tb ? Math.round((bs + (ef + us + ze) / (1 - dd / 100)) * 100) / 100 : nom;   // abono en dólares de la nota (BCV o USD)
  if (ab > nom + 0.01 || ab < ef + us + ze + bs * (tb ? F : 1) - 0.02) return { estado: "error", msg: "El abono no cuadra con lo cobrado" };
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var hoja = hojaCobros(), filas = leerCobros(hoja);
    for (var i = 0; i < filas.length; i++) if (filas[i].uid === uid) return { estado: "ok", repetido: true, cobro: vista(filas[i]) };   // reenvío del mismo cobro
    var nota = holded("documents/invoice/" + nid), cont = holded("contacts/" + nota.contact);
    if (((cont.tags || [""])[0] || "") !== tag) return { estado: "error", msg: "Esa nota no es de un cliente de tu cartera" };
    // Todo se compara en dólares de la nota: en una nota BCV, lo que falta en Holded (reales) se lleva a dólares BCV con el descuento de la nota
    var pend = Number(nota.paymentsPending) || 0, dn = Number(nota.discount) || 0;
    var pendN = tb ? (dn > 0 ? pend / (1 - dn / 100) : pend) : pend;
    var mios = filas.filter(function (f) { return f.notaId === nid && (f.estado === "cobrado" || f.estado === "revisar"); })
      .reduce(function (s, f) { return s + (f.bv || (f.tarifa === "BCV" ? f.abono / F : f.abono)); }, 0);
    if (bv > pendN - mios + 0.5) return { estado: "error", msg: "El abono ($" + bv.toFixed(2) + (tb ? " BCV" : "") + ") es mayor que lo que falta de la nota ($" + Math.max(0, pendN - mios).toFixed(2) + (tb ? " BCV" : "") + ")" };
    var props = PropertiesService.getScriptProperties(), n = Number(props.getProperty("COB_N_" + tag) || 0) + 1, ahora = new Date();
    var pre = VENDEDORES[tag].pre || tag.charAt(0).toUpperCase(), rec = pre + "-" + ("000" + n).slice(-4);
    // El teléfono propone el número (así entrega el recibo en el momento, incluso sin conexión). Se respeta si es de este vendedor y nadie lo usó.
    var prop = /^([A-Z]+)-(\d{4,6})$/.exec(String(c.rec || ""));
    if (prop && prop[1] === pre && !filas.some(function (f) { return f.tag === tag && f.recibo === c.rec; })) { rec = String(c.rec); n = Math.max(n - 1, Number(prop[2])); }
    else while (filas.some(function (f) { return f.tag === tag && f.recibo === rec; })) { n++; rec = pre + "-" + ("000" + n).slice(-4); }
    var base = (nota.paymentsDetail || []).map(function (p) { return p.id; });
    var fila = []; COB_COLS.forEach(function () { fila.push(""); });
    var pon = function (k, v) { fila[COB[k]] = v; };
    pon("Recibo", rec); pon("Fecha", fecha(ahora.toISOString())); pon("Vendedor", VENDEDORES[tag].nombre); pon("Cliente", String(nota.contactName || c.cn || "").slice(0, 120));
    pon("Nota", String(nota.docNumber || "")); pon("Cobrado $", nom); pon("Abono real $", ab); pon("Efectivo $", ef || ""); pon("USDT $", us || ""); pon("Zelle $", ze || "");
    pon("Bs (en $)", bs || ""); pon("Tasa", num(c.ta) || ""); pon("Referencia", String(c.rf || "").replace(/^[=+@-]+/, "").slice(0, 120)); pon("Estado", "cobrado");
    pon("ts", Math.floor(ahora.getTime() / 1000)); pon("tag", tag); pon("notaId", nid); pon("uid", uid); pon("base", JSON.stringify(base)); pon("pagos", "[]");
    pon("Tarifa", tb ? "BCV" : "USD"); pon("Desc. divisas %", dd || ""); pon("Abono a la nota $", bv);
    var fac = fcDeTags(nota.tags); if (fac) pon("Factura", "'" + fac[0]);   // el pago de una nota facturada se registra con su número de factura
    pon("dispositivo", corto(String(q.d || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 40)));
    hoja.appendRow(fila);
    props.setProperty("COB_N_" + tag, String(n));
    var f = leerCobros(hoja).filter(function (x) { return x.uid === uid; })[0];
    return { estado: "ok", cobro: vista(f), saldoHolded: pend };
  } finally { lock.releaseLock(); }
}
function cobroAnular(tag, q) {
  var rec = String(q.r || ""), lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var hoja = hojaCobros(), f = leerCobros(hoja).filter(function (x) { return x.recibo === rec && x.tag === tag; })[0];
    if (!f) return { estado: "error", msg: "No encontré ese recibo" };
    if (f.estado !== "cobrado" && f.estado !== "revisar") return { estado: "error", msg: "Ese cobro ya está " + f.estado + " y no se puede anular" };
    escribir(hoja, f.fila, { "Estado": "anulado", "Observación": "Anulado por el vendedor el " + fecha(new Date().toISOString()) });
    return { estado: "ok", cobros: cobrosDe(tag) };
  } finally { lock.releaseLock(); }
}
// Lo que ve el vendedor: todo lo pendiente, y lo confirmado o anulado de los últimos 7 días.
function cobrosDe(tag) {
  var corte = Date.now() / 1000 - 7 * 86400;
  return leerCobros(hojaCobros()).filter(function (f) { return f.tag === tag && (f.estado === "cobrado" || f.estado === "revisar" || f.ts >= corte); }).map(vista);
}
function vista(f) { return { rec: f.recibo, id: f.uid, n: f.notaId, nn: f.nota, cn: f.cliente, t: f.ts, nom: f.nominal, ab: f.abono, ef: f.ef, us: f.us, ze: f.ze, bs: f.bs, ta: f.tasa, rf: f.ref, est: f.estado, obs: f.obs, pg: f.pagos, dd: f.dd, bv: f.bv || null, tb: f.tarifa === "BCV" ? "b" : "", fa: f.fa || "" }; }

/* Saldos al momento: el teléfono manda los ids de las notas que tiene (?ids=a,b,c) y recibe cómo están AHORA en Holded:
   { id: [total, pagado, pendiente, descuento %, [[idPago, monto, fecha]], [factura, iva] | null] }. Así una nota cobrada en administración deja de salirle
   como pendiente al vendedor sin esperar al refresco de datos. Se guarda un minuto en memoria para no llamar a Holded en cada toque. */
function saldosVivos(ids) {
  var pedidos = String(ids || "").split(",").filter(function (x) { return /^[a-f0-9]{24}$/.test(x); }).slice(0, 80);
  if (!pedidos.length) return {};
  var cache = CacheService.getScriptCache(), raw = cache.get("COB_NT"), mapa;
  if (raw) mapa = JSON.parse(raw);
  else {
    mapa = {};
    for (var p = 1; p <= 6; p++) {
      var docs = holded("documents/invoice?page=" + p); if (!docs.length) break;
      docs.forEach(function (d) {
        var pagos = (d.paymentsDetail || []).map(function (y) { return [y.id, Math.round(Number(y.amount) * 100) / 100, y.date]; });
        var hace = Date.now() / 1000 - 30 * 86400, reciente = pagos.some(function (y) { return y[2] >= hace; });
        if ((Number(d.paymentsPending) || 0) >= 0.01 || reciente) mapa[d.id] = [Number(d.total) || 0, Number(d.paymentsTotal) || 0, Number(d.paymentsPending) || 0, Number(d.discount) || 0, pagos, fcDeTags(d.tags)];
      });
      if (docs.length < 500) break;
    }
    try { cache.put("COB_NT", JSON.stringify(mapa), 60); } catch (e) {}
  }
  var out = {};
  pedidos.forEach(function (id) { out[id] = mapa[id] || null; });   // null = Holded ya no la tiene como pendiente ni pagada hace poco
  return out;
}

/* ---------- conciliación automática (reloj de cada hora) ---------- */
function conciliarCobros() {
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var hoja = hojaCobros(), filas = leerCobros(hoja), ahora = Math.floor(Date.now() / 1000), ids = {}, avisos = [], hechos = 0;
    filas.forEach(function (f) { if (f.estado === "cobrado" || f.estado === "revisar") ids[f.notaId] = 1; });
    Object.keys(ids).forEach(function (nid) {
      var nota;
      try { nota = holded("documents/invoice/" + nid); } catch (e) { return; }           // si Holded falla, se intenta en la próxima hora
      var grupo = filas.filter(function (f) { return f.notaId === nid && f.estado !== "anulado"; });
      var cambios = conciliar({ pendiente: Number(nota.paymentsPending) || 0, pagos: (nota.paymentsDetail || []).map(function (p) { return [p.id, p.amount, p.date]; }) },
        grupo.map(function (f) { return { id: f.uid, fecha: f.ts, abono: f.abono, bs: f.bs > 0, base: f.base, estado: f.estado, pagos: f.pagos, obs: f.obs }; }), ahora);
      cambios.forEach(function (c) {
        var f = grupo.filter(function (x) { return x.uid === c.id; })[0], v = { "Estado": c.estado, "Observación": c.obs };
        if (c.estado === "confirmado") { v["pagos"] = JSON.stringify(c.pagos); v["Confirmado el"] = fecha(new Date().toISOString()); hechos++; }
        else avisos.push(f.recibo + " · " + f.vendedor + " · " + f.cliente + " · " + f.nota + " · $" + f.abono.toFixed(2) + "\n   " + c.obs);
        escribir(hoja, f.fila, v);
      });
    });
    try { fcMarcarEmitidas(); } catch (e4) {}                                   // solicitudes de factura ya emitidas (etiqueta fac###### en la nota)
    if (avisos.length) aviso("cobros por revisar (" + avisos.length + ")", "Estos cobros anotados por los vendedores no se pudieron confirmar solos contra Holded:\n\n" + avisos.join("\n\n") +
      "\n\nEn la hoja puedes escribir \"confirmado\" o \"anulado\" en la columna Estado para resolverlos a mano:\n" + hoja.getParent().getUrl());
    return hechos + " confirmados, " + avisos.length + " por revisar";
  } finally { lock.releaseLock(); }
}

/* ---------- hoja, Holded e instalación ---------- */
function hojaCobros() {
  var id = PropertiesService.getScriptProperties().getProperty("COB_HOJA");
  if (!id) throw new Error("Falta instalar cobranzas (ejecuta instalarCobranzas una vez)");
  var h = SpreadsheetApp.openById(id).getSheetByName("Cobros");
  if (h.getLastColumn() < COB_COLS.length) h.getRange(1, 1, 1, COB_COLS.length).setValues([COB_COLS]).setFontWeight("bold");   // hoja creada con menos columnas
  return h;
}
function leerCobros(hoja) {
  var v = hoja.getDataRange().getValues(), out = [], N = function (x) { return Number(x) || 0; }, J = function (x) { try { return JSON.parse(x || "[]"); } catch (e) { return []; } };
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[COB["uid"]]) continue;
    out.push({ fila: i + 1, recibo: String(r[COB["Recibo"]]), vendedor: String(r[COB["Vendedor"]]), cliente: String(r[COB["Cliente"]]), nota: String(r[COB["Nota"]]),
      nominal: N(r[COB["Cobrado $"]]), abono: N(r[COB["Abono real $"]]), ef: N(r[COB["Efectivo $"]]), us: N(r[COB["USDT $"]]), ze: N(r[COB["Zelle $"]]), bs: N(r[COB["Bs (en $)"]]),
      tasa: N(r[COB["Tasa"]]), ref: String(r[COB["Referencia"]]), estado: String(r[COB["Estado"]]).trim().toLowerCase(), obs: String(r[COB["Observación"]]),
      tarifa: String(r[COB["Tarifa"]] || ""), fa: String(r[COB["Factura"]] || ""), dd: N(r[COB["Desc. divisas %"]]), bv: N(r[COB["Abono a la nota $"]]),
      ts: N(r[COB["ts"]]), tag: String(r[COB["tag"]]), notaId: String(r[COB["notaId"]]), uid: String(r[COB["uid"]]), base: J(r[COB["base"]]), pagos: J(r[COB["pagos"]]) });
  }
  return out;
}
function escribir(hoja, fila, valores) { for (var k in valores) hoja.getRange(fila, COB[k] + 1).setValue(valores[k]); }
function holded(ruta) {
  var k = PropertiesService.getScriptProperties().getProperty("HOLDED_KEY");
  if (!k) throw new Error("Falta la propiedad HOLDED_KEY");
  var r = UrlFetchApp.fetch("https://api.holded.com/api/invoicing/v1/" + ruta, { headers: { key: k, Accept: "application/json" }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error("Holded no respondió (" + r.getResponseCode() + "). Intenta de nuevo en un momento.");
  return JSON.parse(r.getContentText());
}
// Ejecutar UNA vez a mano desde el editor. Se puede repetir sin dañar nada.
function instalarCobranzas() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty("HOLDED_KEY")) throw new Error("Primero guarda la clave de Holded en Configuración del proyecto › Propiedades de la secuencia de comandos, con el nombre HOLDED_KEY");
  var n = holded("documents/invoice?page=1").length, id = props.getProperty("COB_HOJA"), libro;
  if (id) libro = SpreadsheetApp.openById(id);
  else {
    libro = SpreadsheetApp.create("Cobranzas NTX"); var h = libro.getSheets()[0]; h.setName("Cobros");
    h.getRange(1, 1, 1, COB_COLS.length).setValues([COB_COLS]).setFontWeight("bold"); h.setFrozenRows(1);
    ["Recibo", "Fecha", "Nota", "Referencia", "Confirmado el", "tag", "notaId", "uid", "base", "pagos", "dispositivo"].forEach(function (c) { h.getRange(1, COB[c] + 1, h.getMaxRows(), 1).setNumberFormat("@"); });
    h.hideColumns(COB["ts"] + 1, COB_COLS.length - COB["ts"]);
    props.setProperty("COB_HOJA", libro.getId());
  }
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "conciliarCobros") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("conciliarCobros").timeBased().everyHours(1).create();
  var msg = "Cobranzas instalado. Holded respondió bien (" + n + " notas leídas). Hoja: " + libro.getUrl();
  aviso("cobranzas instalado", msg + "\n\nLa conciliación corre sola cada hora.");
  Logger.log(msg); return msg;
}

/* ---------- conciliar(): copia exacta de herramientas/conciliar.js (probada aparte) ---------- */
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

/* =====================================================================================================================
   FACTURAS AdriMan desde el portal (nov 2026)
   - El vendedor pide la factura legal de una nota (?a=solfac) con comentarios. No sale ningún correo: la solicitud queda en la
     hoja "Solicitudes factura" y Mango la ve en su app (Pedidos NTX) con ?a=adm&k=ADMIN.
   - Cuando Claude emite la factura fiscal, etiqueta la nota en Holded con fac###### (y iva##### = IVA en centavos de dólares
     de la nota). La conciliación de cada hora marca la solicitud como "emitida" y el portal muestra la nota con su factura.
   - Retención de IVA: el vendedor marca si el cliente retiene (0, 75 o 100 %) y cómo llega el comprobante: adjunto (se sube
     desde el teléfono a Google Drive, carpeta "Retenciones NTX"), WhatsApp o físico. Hoja "Retenciones" (una fila por nota).
   ===================================================================================================================== */
var FC_SOL = ["Fecha", "Vendedor", "Cliente", "Nota", "Comentarios", "Estado", "Factura", "Atendida el", "ts", "tag", "notaId", "uid"];
var FC_RET = ["Fecha", "Vendedor", "Cliente", "Nota", "Factura", "Retención %", "Comprobante", "Archivo", "Recibido en administración", "ts", "tag", "notaId"];
var FC_CP = { "": "", adjunto: "adjunto", whatsapp: "whatsapp", fisico: "fisico" };

/* etiquetas de la nota → [número de factura, IVA en dólares de la nota | null], o null si no está facturada */
function fcDeTags(tags) {
  var f = null, iva = null;
  (tags || []).forEach(function (t) {
    t = String(t).toLowerCase(); var m = /^fac(\d{1,10})$/.exec(t), v = /^iva(\d{1,12})$/.exec(t);
    if (m) f = ("000000" + m[1]).slice(-Math.max(6, m[1].length));
    if (v) iva = Number(v[1]) / 100;
  });
  return f ? [f, iva] : null;
}
function fcLee(x) {
  var b64 = String(x || "");
  if (!/^[A-Za-z0-9_-]{8,4000}$/.test(b64)) return null;
  while (b64.length % 4) b64 += "=";
  try { return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString("UTF-8")); } catch (e) { return null; }
}
/* la nota, solo si es de un cliente del vendedor */
function fcNota(tag, nid) {
  nid = String(nid || "").replace(/[^a-f0-9]/g, "");
  if (nid.length !== 24) throw new Error("Nota no válida");
  var nota = holded("documents/invoice/" + nid), cont = holded("contacts/" + nota.contact);
  if (((cont.tags || [""])[0] || "") !== tag) throw new Error("Esa nota no es de un cliente de tu cartera");
  return nota;
}
function fcHoja(nombre, cols) {
  var libro = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("COB_HOJA") || ""), h = libro.getSheetByName(nombre);
  if (!h) {
    h = libro.insertSheet(nombre); h.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight("bold"); h.setFrozenRows(1);
    ["Nota", "Factura", "ts", "tag", "notaId", "uid"].forEach(function (c) { var i = cols.indexOf(c); if (i >= 0) h.getRange(1, i + 1, h.getMaxRows(), 1).setNumberFormat("@"); });
    h.hideColumns(cols.indexOf("ts") + 1, cols.length - cols.indexOf("ts"));
  }
  return h;
}
function fcFilas(h, cols) {
  var v = h.getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) { var o = { fila: i + 1 }; cols.forEach(function (c, k) { o[c] = v[i][k]; }); if (o.notaId) out.push(o); }
  return out;
}
function fcPon(h, cols, fila, vals) { for (var k in vals) h.getRange(fila, cols.indexOf(k) + 1).setValue(vals[k]); }
function fcFila(cols, vals) { return cols.map(function (c) { return vals.hasOwnProperty(c) ? vals[c] : ""; }); }
var fcTxt = function (s, n) { return String(s || "").replace(/^[=+@-]+/, "").replace(/[\u0000-\u0008\u000B-\u001F]/g, "").slice(0, n); };
function fcSolVista(o) { return { id: String(o.uid), n: String(o.notaId), nn: String(o.Nota), cn: String(o.Cliente), t: Number(o.ts) || 0, cm: String(o.Comentarios), est: String(o.Estado).trim().toLowerCase(), fa: String(o.Factura || ""), ven: String(o.Vendedor), at: String(o["Atendida el"] || "") }; }
function fcRetVista(o) { return { n: String(o.notaId), nn: String(o.Nota), cn: String(o.Cliente), fa: String(o.Factura || ""), rt: Number(o["Retención %"]) || 0, cp: String(o.Comprobante || ""), url: String(o.Archivo || ""), rec: String(o["Recibido en administración"] || ""), t: Number(o.ts) || 0, ven: String(o.Vendedor) }; }

/* ---- vendedor ---- */
function fcSolicitar(tag, q) {
  var x = fcLee(q.x); if (!x) return { estado: "error", msg: "Solicitud incompleta" };
  var nota = fcNota(tag, x.n), ya = fcDeTags(nota.tags);
  if (ya) return { estado: "error", msg: "Esta nota ya tiene la factura " + ya[0] };
  var cm = fcTxt(x.cm, 600), lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var h = fcHoja("Solicitudes factura", FC_SOL), filas = fcFilas(h, FC_SOL), ahora = new Date();
    var abierta = filas.filter(function (o) { return o.notaId === nota.id && String(o.Estado).trim().toLowerCase() === "pendiente"; })[0];
    if (abierta) fcPon(h, FC_SOL, abierta.fila, { "Comentarios": cm, "Fecha": fecha(ahora.toISOString()), "ts": Math.floor(ahora.getTime() / 1000) });
    else h.appendRow(fcFila(FC_SOL, { "Fecha": fecha(ahora.toISOString()), "Vendedor": VENDEDORES[tag].nombre, "Cliente": fcTxt(nota.contactName, 120), "Nota": String(nota.docNumber || ""),
      "Comentarios": cm, "Estado": "pendiente", "ts": Math.floor(ahora.getTime() / 1000), "tag": tag, "notaId": nota.id, "uid": Utilities.getUuid().slice(0, 13) }));
    return { estado: "ok", actualizada: !!abierta, sol: fcDelVendedor(tag).sol };
  } finally { lock.releaseLock(); }
}
function fcCancelar(tag, q) {
  var id = String(q.r || ""), lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var h = fcHoja("Solicitudes factura", FC_SOL), o = fcFilas(h, FC_SOL).filter(function (x) { return String(x.uid) === id && x.tag === tag; })[0];
    if (!o) return { estado: "error", msg: "No encontré esa solicitud" };
    if (String(o.Estado).trim().toLowerCase() !== "pendiente") return { estado: "error", msg: "Esa solicitud ya fue atendida" };
    fcPon(h, FC_SOL, o.fila, { "Estado": "cancelada", "Atendida el": "Cancelada por el vendedor el " + fecha(new Date().toISOString()) });
    return { estado: "ok", sol: fcDelVendedor(tag).sol };
  } finally { lock.releaseLock(); }
}
/* r = {n, rt (0|75|100), cp ("", adjunto, whatsapp, fisico)}; url = enlace del archivo subido (si lo hay) */
function fcRetencion(tag, r, url) {
  if (!r) return { estado: "error", msg: "Datos incompletos" };
  var rt = [0, 75, 100].indexOf(Number(r.rt)) >= 0 ? Number(r.rt) : -1, cp = FC_CP.hasOwnProperty(String(r.cp || "")) ? String(r.cp || "") : null;
  if (rt < 0 || cp === null) return { estado: "error", msg: "Datos de retención no válidos" };
  var nota = fcNota(tag, r.n), fac = fcDeTags(nota.tags), lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var h = fcHoja("Retenciones", FC_RET), o = fcFilas(h, FC_RET).filter(function (x) { return x.notaId === nota.id; })[0], ahora = new Date();
    var v = { "Fecha": fecha(ahora.toISOString()), "Vendedor": VENDEDORES[tag].nombre, "Cliente": fcTxt(nota.contactName, 120), "Nota": String(nota.docNumber || ""),
      "Factura": fac ? fac[0] : "", "Retención %": rt, "Comprobante": rt ? cp : "", "ts": Math.floor(ahora.getTime() / 1000), "tag": tag, "notaId": nota.id };
    if (url) v["Archivo"] = url;                                          // sin archivo nuevo, se conserva el que ya hubiera
    if (o) fcPon(h, FC_RET, o.fila, v); else h.appendRow(fcFila(FC_RET, v));
    return { estado: "ok", ret: fcDelVendedor(tag).ret };
  } finally { lock.releaseLock(); }
}
/* lo que ve el vendedor: sus solicitudes (pendientes y las de los últimos 30 días) y la retención de sus notas */
function fcDelVendedor(tag) {
  var lib = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("COB_HOJA") || ""), corte = Date.now() / 1000 - 30 * 86400, out = { sol: [], ret: {} };
  var hs = lib.getSheetByName("Solicitudes factura"), hr = lib.getSheetByName("Retenciones");
  if (hs) out.sol = fcFilas(hs, FC_SOL).filter(function (o) { return o.tag === tag && (String(o.Estado).trim().toLowerCase() === "pendiente" || Number(o.ts) >= corte); }).map(fcSolVista);
  if (hr) fcFilas(hr, FC_RET).forEach(function (o) { if (o.tag === tag) out.ret[o.notaId] = fcRetVista(o); });
  return out;
}

/* ---- comprobante de retención adjunto: llega por POST (la imagen o el PDF no caben en una dirección) ---- */
// Cuerpo (texto JSON): {a:"ret", cod, d, x:{n, rt}, nombre, tipo, b64}
function doPost(e) {
  try {
    var b = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (b.a !== "ret") return json({ estado: "error", msg: "Acción desconocida" });
    var tag = vendedorDe(b); if (!tag) return json({ estado: "no", msg: "Dispositivo o código no autorizado" });
    var tipo = String(b.tipo || ""), ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }[tipo];
    if (!ext) return json({ estado: "error", msg: "Solo se aceptan fotos o PDF" });
    var bytes = Utilities.base64Decode(String(b.b64 || ""));
    if (bytes.length < 200 || bytes.length > 9 * 1024 * 1024) return json({ estado: "error", msg: "El archivo está vacío o pesa más de 9 MB" });
    var x = b.x || {}, nota = fcNota(tag, x.n), fac = fcDeTags(nota.tags);
    var nombre = "Retencion_" + (fac ? "F" + fac[0] + "_" : "") + String(nota.docNumber || "") + "_" + fcTxt(nota.contactName, 40).replace(/[^\wÁÉÍÓÚÑáéíóúñ .-]/g, "") +
      "_" + Utilities.formatDate(new Date(), "America/Caracas", "yyyy-MM-dd_HHmm") + "." + ext;
    var f = fcCarpeta().createFile(Utilities.newBlob(bytes, tipo, nombre));
    return json(fcRetencion(tag, { n: nota.id, rt: x.rt, cp: "adjunto" }, f.getUrl()));
  } catch (err) { return json({ estado: "error", msg: String(err && err.message || err) }); }
}
function fcCarpeta() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty("COB_RET_DIR");
  if (id) try { return DriveApp.getFolderById(id); } catch (e) {}
  var c = DriveApp.createFolder("Retenciones NTX"); props.setProperty("COB_RET_DIR", c.getId()); return c;
}

/* ---- cada hora (desde conciliarCobros): solicitudes cuya nota ya tiene factura ---- */
function fcMarcarEmitidas() {
  var lib = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("COB_HOJA") || "");
  var hs = lib.getSheetByName("Solicitudes factura"), hr = lib.getSheetByName("Retenciones");
  if (hs) fcFilas(hs, FC_SOL).forEach(function (o) {
    if (String(o.Estado).trim().toLowerCase() !== "pendiente") return;
    var nota; try { nota = holded("documents/invoice/" + o.notaId); } catch (e) { return; }
    var fac = fcDeTags(nota.tags);
    if (fac) fcPon(hs, FC_SOL, o.fila, { "Estado": "emitida", "Factura": fac[0], "Atendida el": fecha(new Date().toISOString()) });
  });
  if (hr) fcFilas(hr, FC_RET).forEach(function (o) {                    // retenciones marcadas antes de que existiera el número de factura
    if (o.Factura) return;
    var nota; try { nota = holded("documents/invoice/" + o.notaId); } catch (e) { return; }
    var fac = fcDeTags(nota.tags); if (fac) fcPon(hr, FC_RET, o.fila, { "Factura": fac[0] });
  });
}

/* ---- bandeja de Mango (Pedidos NTX): ?a=adm&k=ADMIN  ·  ?a=admacc&k=ADMIN&s=<id solicitud>&e=pendiente|descartada  ·  &r=<id nota>&e=recibido|pendiente ---- */
function fcAdmin(q) {
  if (String(q.k || "") !== ADMIN) return { estado: "no", msg: "No autorizado" };
  var lib = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("COB_HOJA") || "");
  if (q.a === "admacc") {
    var lock = LockService.getScriptLock(); lock.waitLock(25000);
    try {
      var e = String(q.e || "");
      if (q.s) {
        var hs = fcHoja("Solicitudes factura", FC_SOL), o = fcFilas(hs, FC_SOL).filter(function (x) { return String(x.uid) === String(q.s); })[0];
        if (!o || ["pendiente", "descartada"].indexOf(e) < 0) return { estado: "error", msg: "Solicitud o acción no válida" };
        fcPon(hs, FC_SOL, o.fila, { "Estado": e, "Atendida el": e === "pendiente" ? "" : fecha(new Date().toISOString()) });
      } else if (q.r) {
        var hr = fcHoja("Retenciones", FC_RET), w = fcFilas(hr, FC_RET).filter(function (x) { return x.notaId === String(q.r); })[0];
        if (!w || ["recibido", "pendiente"].indexOf(e) < 0) return { estado: "error", msg: "Retención o acción no válida" };
        fcPon(hr, FC_RET, w.fila, { "Recibido en administración": e === "recibido" ? fecha(new Date().toISOString()) : "" });
      } else return { estado: "error", msg: "Falta qué atender" };
    } finally { lock.releaseLock(); }
  }
  var corte = Date.now() / 1000 - 21 * 86400, hs2 = lib.getSheetByName("Solicitudes factura"), hr2 = lib.getSheetByName("Retenciones");
  return { estado: "ok",
    sol: hs2 ? fcFilas(hs2, FC_SOL).filter(function (o) { return String(o.Estado).trim().toLowerCase() === "pendiente" || Number(o.ts) >= corte; }).map(fcSolVista).sort(function (a, b) { return b.t - a.t; }) : [],
    ret: hr2 ? fcFilas(hr2, FC_RET).map(fcRetVista).filter(function (r) { return r.rt > 0 && (!r.rec || r.t >= corte); }).sort(function (a, b) { return b.t - a.t; }) : [] };
}
