// COBRANZAS del portal de ventas NTX. Archivo aparte dentro del mismo proyecto de Apps Script del receptor (usa sus funciones y VENDEDORES).
// No contiene secretos: la clave de Holded va en Configuración del proyecto › Propiedades de la secuencia de comandos (HOLDED_KEY).
// Qué hace:
//   ?a=cobro&x=…   el vendedor anota un cobro (el receptor le da número de recibo y guarda qué pagos tenía la nota en Holded en ese momento)
//   ?a=cobros  devuelve al vendedor sus cobros (por entregar / por confirmar / confirmados recientes)
//   ?a=anular  el vendedor anula un cobro suyo que aún no esté confirmado
//   conciliarCobros()  corre sola cada hora: mira Holded (solo lectura) y confirma los cobros cuyos pagos ya registró administración
//   instalarCobranzas()  se ejecuta UNA vez a mano: crea la hoja "Cobranzas NTX" y el reloj de cada hora
//   POST a=cap      el teléfono sube la captura del pago de un cobro (carpeta de Drive "Comprobantes NTX"; enlace en la columna Captura)
//   Tasa BCV        cada pocas horas (desde la conciliación) se lee la tasa oficial (bcv.org.ve; si falla, ve.dolarapi.com) y se guarda
//                   por fecha valor en la hoja "Tasas BCV". El portal la usa para pasar los bolívares de una captura a dólares BCV.
// Solo LEE Holded. Nunca registra pagos ni cambia nada allá.
var COB_COLS = ["Recibo", "Fecha", "Vendedor", "Cliente", "Nota", "Cobrado $", "Abono real $", "Efectivo $", "USDT $", "Zelle $", "Bs (en $)", "Tasa", "Referencia",
  "Estado", "Observación", "Confirmado el", "ts", "tag", "notaId", "uid", "base", "pagos", "dispositivo",
  "Tarifa", "Desc. divisas %", "Abono a la nota $", "Factura",    // columnas nuevas al final (nov 2026): BCV o USD, descuento por pago en divisas, abono en dólares de la nota, factura AdriMan de la nota
  "Mercantil Panamá $", "IVA cobrado $", "Monto Bs", "Tasa BCV", "Fecha del pago", "Cuenta destino", "Destino leído", "Cuenta Holded", "Captura", "Lectura", "Avisos",
  "Confirmado ts", "Cuenta real Holded", "Diferencia", "Aviso del vendedor"];
// (22 nov 2026, parte 2) cuándo se confirmó (para la ventana de la semana), en qué cuenta(s) de Holded quedó de verdad, si no coincide con la del recibo, y cuándo avisó el vendedor
// (22 nov 2026) captura del pago: lo que leyó el teléfono, la cuenta de la empresa a la que se pagó, el IVA que vino con el pago (no va a Holded)
// y la cuenta de Holded donde debe registrarse cada forma de pago. Las columnas de antes no se mueven.
var CUENTA_HOLDED = { ef: "CAJA CHICA", us: "USDT", ze: "NUEVO ZELLE", mp: "MERCANTIL PANAMÁ", bs: "Caja para Operaciones en Tránsito", bsFac: "Bolivares Cuenta Juridica" };

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
var COB_ACC = { cobro: 1, cobros: 1, anular: 1, solfac: 1, solcancel: 1, ret: 1, adm: 1, admacc: 1, recibos: 1, captura: 1, avisar: 1 };
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
    if (q.a === "recibos") return { estado: "ok", cobros: recibosDe(tag) };       // archivo de 3 meses («Mis recibos»)
    if (q.a === "captura") return capturaVer(tag, q);
    if (q.a === "avisar") return cobroAvisar(tag, q);
    var vivo = null; try { vivo = saldosVivos(q.ids); } catch (e2) {}          // si Holded falla, los cobros se devuelven igual
    var fx = { sol: [], ret: {} }; try { fx = fcDelVendedor(tag); } catch (e3) {}
    var tasas = []; try { tasas = tasasRecientes(); } catch (e4) {}
    return { estado: "ok", cobros: cobrosDe(tag), nt: vivo, sol: fx.sol, ret: fx.ret, tasas: tasas };
  } catch (err) { return { estado: "error", msg: String(err && err.message || err) }; }
}
/* cuenta de Holded donde administración debe registrar cada parte del cobro (cuentas ACTIVAS; los bolívares de notas con factura van a la jurídica) */
function cuentaHolded(ef, us, ze, mp, bsNeto, fac) {
  var o = []; if (ef > 0) o.push(CUENTA_HOLDED.ef); if (us > 0) o.push(CUENTA_HOLDED.us); if (ze > 0) o.push(CUENTA_HOLDED.ze); if (mp > 0) o.push(CUENTA_HOLDED.mp);
  if (bsNeto > 0.009) o.push(fac ? CUENTA_HOLDED.bsFac : CUENTA_HOLDED.bs);
  return o.join(" + ");
}
function refNorm(r) { return String(r || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
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
  var ef = num(c.ef), us = num(c.us), ze = num(c.ze), mp = num(c.mp), bs = num(c.bs), nom = Math.round((ef + us + ze + mp + bs) * 100) / 100, ab = num(c.ab), div = ef + us + ze + mp;
  if (uid.length < 8 || nid.length !== 24) return { estado: "error", msg: "Cobro incompleto" };
  if (nom <= 0) return { estado: "error", msg: "El monto debe ser mayor que cero" };
  // El abono real solo puede ser menor que lo cobrado por la parte en bolívares de una nota BCV (x 0,85).
  var F = 1 - descuentoBcv() / 100, tb = c.tb === "b", dd = tb ? Math.max(0, Math.min(50, Number(c.dd) || 0)) : 0;
  var iv = tb ? Math.min(bs, num(c.iv)) : 0;                                            // IVA que vino con el pago (solo notas facturadas, sale de los bolívares)
  var bv = tb ? Math.round((bs - iv + div / (1 - dd / 100)) * 100) / 100 : nom;          // abono en dólares de la nota (BCV o USD), sin el IVA
  if (ab > nom + 0.01 || ab < div + (bs - iv) * (tb ? F : 1) - 0.02) return { estado: "error", msg: "El abono no cuadra con lo cobrado" };
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var hoja = hojaCobros(), filas = leerCobros(hoja);
    for (var i = 0; i < filas.length; i++) if (filas[i].uid === uid) return { estado: "ok", repetido: true, cobro: vista(filas[i]) };   // reenvío del mismo cobro
    var nota = holded("documents/invoice/" + nid), cont = holded("contacts/" + nota.contact);
    if (((cont.tags || [""])[0] || "") !== tag) return { estado: "error", msg: "Esa nota no es de un cliente de tu cartera" };
    var fac0 = fcDeTags(nota.tags);
    if (iv > 0 && !fac0) return { estado: "error", msg: "Esta nota no tiene factura: el pago no puede llevar IVA" };
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
    // captura y datos nuevos (22 nov 2026)
    var tx = function (v, n) { return String(v || "").replace(/^[=+@-]+/, "").slice(0, n); };
    var fp = /^\d{4}-\d{2}-\d{2}$/.test(String(c.fp || "")) ? String(c.fp) : "", ct = tx(c.ct, 20), cd = tx(c.cd, 60), avisos = [];
    pon("Mercantil Panamá $", mp || ""); pon("IVA cobrado $", iv || ""); pon("Monto Bs", num(c.bsb) || ""); pon("Tasa BCV", Number(c.tbc) > 0 ? Number(c.tbc) : "");
    pon("Fecha del pago", fp ? "'" + fp : ""); pon("Cuenta destino", ct === "?" ? "no reconocida" : ct); pon("Destino leído", cd); pon("Lectura", tx(c.lx, 160));
    pon("Cuenta Holded", cuentaHolded(ef, us, ze, mp, bs - iv, !!fac0));
    if (ct === "?") avisos.push("La captura no muestra una cuenta de la empresa" + (cd ? " (" + cd + ")" : ""));
    var rfn = refNorm(c.rf);
    if (rfn.length >= 6) filas.forEach(function (f) { if (f.estado !== "anulado" && refNorm(f.ref) === rfn) avisos.push("Referencia repetida: ya está en el recibo " + f.recibo + " (" + f.vendedor + ", nota " + f.nota + ")"); });
    if (avisos.length) pon("Avisos", avisos.join(" · "));
    if (ab < 0.01 && iv > 0) { pon("Estado", "confirmado"); pon("Observación", "Solo IVA: no se registra en Holded"); pon("Confirmado el", fecha(ahora.toISOString())); pon("Confirmado ts", Math.floor(ahora.getTime() / 1000)); }   // nada que conciliar
    var fac = fcDeTags(nota.tags); if (fac) pon("Factura", "'" + fac[0]);   // el pago de una nota facturada se registra con su número de factura
    pon("dispositivo", corto(String(q.d || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 40)));
    hoja.appendRow(fila);
    props.setProperty("COB_N_" + tag, String(n));
    var f = leerCobros(hoja).filter(function (x) { return x.uid === uid; })[0];
    var aviso = avisos.filter(function (a) { return /^Referencia repetida/.test(a); })[0];
    return { estado: "ok", cobro: vista(f), saldoHolded: pend, aviso: aviso ? aviso + ". Si es un mismo pago repartido en dos notas, está bien; si no, revísalo." : "" };
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
// La semana se cuenta desde que se confirmó (o anuló), no desde que se anotó el cobro.
function cobrosDe(tag) {
  var corte = Date.now() / 1000 - 7 * 86400;
  return leerCobros(hojaCobros()).filter(function (f) { return f.tag === tag && (f.estado === "cobrado" || f.estado === "revisar" || (f.tsc || f.ts) >= corte); }).map(vista);
}
// Archivo de 3 meses del vendedor: todos sus cobros (menos los anulados) de los últimos 90 días, y los pendientes sin importar la edad.
function recibosDe(tag) {
  var corte = Date.now() / 1000 - 90 * 86400;
  return leerCobros(hojaCobros()).filter(function (f) { return f.tag === tag && f.estado !== "anulado" && (f.estado === "cobrado" || f.estado === "revisar" || f.ts >= corte); }).map(vista);
}
// Captura de un recibo (Drive pide iniciar sesión; el vendedor la ve a través del receptor). Devuelve la imagen en base64.
function capturaVer(tag, q) {
  var rec = String(q.r || ""), f = leerCobros(hojaCobros()).filter(function (x) { return x.recibo === rec && x.tag === tag; })[0];
  if (!f) return { estado: "error", msg: "No encontré ese recibo" };
  var m = /\/d\/([A-Za-z0-9_-]+)/.exec(f.cap) || /[?&]id=([A-Za-z0-9_-]+)/.exec(f.cap);
  if (!m) return { estado: "error", msg: "Este recibo no tiene captura guardada" };
  var blob = DriveApp.getFileById(m[1]).getBlob();
  return { estado: "ok", tipo: blob.getContentType(), b64: Utilities.base64Encode(blob.getBytes()) };
}
// El vendedor avisa a administración de un cobro con diferencia: queda anotado en la hoja y le llega un correo a Mango (una vez cada 6 horas por recibo).
function cobroAvisar(tag, q) {
  var rec = String(q.r || ""), lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var hoja = hojaCobros(), f = leerCobros(hoja).filter(function (x) { return x.recibo === rec && x.tag === tag; })[0];
    if (!f) return { estado: "error", msg: "No encontré ese recibo" };
    var ahora = new Date();
    if (!f.avv || !(Date.now() - (f.avvTs || 0) * 1000 < 6 * 3600000)) {
      escribir(hoja, f.fila, { "Aviso del vendedor": fecha(ahora.toISOString()) + " |" + Math.floor(ahora.getTime() / 1000) });
      aviso("cobro con diferencia: " + f.recibo, f.vendedor + " avisa que el recibo " + f.recibo + " (" + f.cliente + ", nota " + f.nota + ", $" + f.nominal.toFixed(2) + ") tiene una diferencia.\n\n" +
        (f.dif ? f.dif + "\n\n" : "") + (f.obs ? f.obs + "\n\n" : "") + "Hoja: " + hoja.getParent().getUrl());
    }
    return { estado: "ok", avv: fecha(ahora.toISOString()) };
  } finally { lock.releaseLock(); }
}
function vista(f) { return { rec: f.recibo, id: f.uid, n: f.notaId, nn: f.nota, cn: f.cliente, t: f.ts, nom: f.nominal, ab: f.abono, ef: f.ef, us: f.us, ze: f.ze, mp: f.mp, bs: f.bs, ta: f.tasa, rf: f.ref, est: f.estado, obs: f.obs, pg: f.pagos, dd: f.dd, bv: f.bv || (f.bv === 0 && f.iv ? 0 : null), tb: f.tarifa === "BCV" ? "b" : "", fa: f.fa || "",
  iv: f.iv, bsb: f.bsb, tbc: f.tbc, fp: f.fp, ct: f.ct, cap: f.cap ? 1 : 0, av: f.av,
  tsc: f.tsc || 0, ch: f.ch, cr: f.cr, dif: f.dif, avv: f.avv }; }
/* fecha aaaa-mm-dd de una celda (texto o fecha de la hoja) */
function ymd(v) { if (v instanceof Date) return Utilities.formatDate(v, "America/Caracas", "yyyy-MM-dd"); var s = String(v || "").replace(/^'/, ""); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ""; }

/* Saldos al momento: el teléfono manda los ids de las notas que tiene (?ids=a,b,c) y recibe cómo están AHORA en Holded:
   { id: [total, pagado, pendiente, descuento %, [[idPago, monto, fecha]], [factura, iva] | null] }. Así una nota cobrada en administración deja de salirle
   como pendiente al vendedor sin esperar al refresco de datos. Se guarda un minuto en memoria para no llamar a Holded en cada toque. */
function saldosVivos(ids) {
  var pedidos = String(ids || "").split(",").filter(function (x) { return /^[a-f0-9]{24}$/.test(x); }).slice(0, 90);
  if (!pedidos.length) return {};
  var cache = CacheService.getScriptCache(), raw = cache.get("COB_NT"), mapa;
  if (raw) mapa = JSON.parse(raw);
  else {
    mapa = {}; var ctas = cuentasHolded();
    for (var p = 1; p <= 6; p++) {
      var docs = holded("documents/invoice?page=" + p); if (!docs.length) break;
      docs.forEach(function (d) {
        var pagos = (d.paymentsDetail || []).map(function (y) { var c = ctas[y.bankId]; return [y.id, Math.round(Number(y.amount) * 100) / 100, y.date, c ? c[0] : "", c && c[1] ? 1 : 0]; });   // [id, monto, fecha, cuenta, archivada]
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
        if (c.estado === "confirmado") {
          v["pagos"] = JSON.stringify(c.pagos); v["Confirmado el"] = fecha(new Date().toISOString()); v["Confirmado ts"] = ahora; hechos++;
          try { var cu = cuentasReales(Object.assign({}, f, { pagos: c.pagos }), nota); v["Cuenta real Holded"] = cu.txt || "sin pago en Holded"; v["Diferencia"] = cu.dif; } catch (e6) {}
        }
        else avisos.push(f.recibo + " · " + f.vendedor + " · " + f.cliente + " · " + f.nota + " · $" + f.abono.toFixed(2) + "\n   " + c.obs);
        escribir(hoja, f.fila, v);
      });
    });
    try { cobrosRevisarCuentas(filas); } catch (e7) {}                         // cuenta real en Holded de los cobros ya confirmados (y los que tenían diferencia)
    try { fcMarcarEmitidas(); } catch (e4) {}                                   // solicitudes de factura ya emitidas (etiqueta fac###### en la nota)
    try { tasaBcvAlDia(); } catch (e5) {}                                       // tasa BCV para el portal (cada 3 horas)
    if (avisos.length) aviso("cobros por revisar (" + avisos.length + ")", "Estos cobros anotados por los vendedores no se pudieron confirmar solos contra Holded:\n\n" + avisos.join("\n\n") +
      "\n\nEn la hoja puedes escribir \"confirmado\" o \"anulado\" en la columna Estado para resolverlos a mano:\n" + hoja.getParent().getUrl());
    return hechos + " confirmados, " + avisos.length + " por revisar";
  } finally { lock.releaseLock(); }
}

/* ---------- cuentas de Holded: en cuál quedó de verdad cada pago ---------- */
/* Cuentas conocidas (id → [nombre, archivada]). La lista en vivo de Holded se suma encima, así una cuenta nueva aparece sola. Las archivadas
   (…OLD y el «Nuevo Zelle» viejo) son un error si un pago cae ahí. */
var CUENTAS_FIJAS = {
  "6a18ded2e9c8e3e7cd06f561": ["Caja Chica OLD", 1], "6a18df0d8b097bd21e05fd6d": ["USDT OLD", 1], "6a1b66ed75a5d282c8069074": ["Pasarela Sueldos Personal OLD", 1],
  "6a1f248a6a7381823109271e": ["Nuevo Zelle (archivada)", 1], "6a1f26611ca92927070706f9": ["Caja Tránsito para Bolivares OLD", 1], "6a1f2cf3e3892d37e408122c": ["Pasarela de Sueldos Personal OLD", 1],
  "6a1f2ef5b509c6643c0c1f86": ["Fondo de Operaciones - Sueldos Personal", 1], "6a1f3179c9574c97db053902": ["Caja Chica OLD", 1], "6a1f33f36588be3343036ba9": ["Mercantil Panama OLD", 1],
  "6a1f354c40aa1e3d3b04d22d": ["USD Sami Banesco OLD", 1], "6a1f3598f58910876d062391": ["USDT OLD", 1], "6a1ff16ec5f877f61306136f": ["Fondo de Operaciones - Reinhard", 1],
  "6a21eaccb7dfd73add017db7": ["Caja para Operaciones en Tránsito", 0], "6a21f1483e0218208d0617fc": ["USDT", 0], "6a21f411a4a649295b04885a": ["NUEVO ZELLE", 0], "6a21f48b02f61e3fdd0793bc": ["CAJA CHICA", 0],
  "6a21f70ee03e72b64706c44b": ["MERCANTIL PANAMÁ", 0], "6a21f7af8052642b7d0e4fe5": ["USD SAMI BANESCO", 0], "6a23f5b686b5b10a5d0be495": ["Caja Socio - Adriana Mujica", 0],
  "6a23f63fcf4d71b1b5007528": ["Caja Socio - Reinhard Mangado", 0], "6aef84229d87cfc6220ae3e7": ["Fondos apartados - Operaciones en Espera", 0], "6af09d323d3c13c660066e24": ["Por cobrar - Operaciones en Espera", 0],
  "6af785d7818ea0e4e008b81a": ["Bolivares Cuenta Juridica", 0]
};
function cuentasHolded() {
  var cache = CacheService.getScriptCache(), c = cache.get("COB_CTAS");
  if (c) return JSON.parse(c);
  var mapa = JSON.parse(JSON.stringify(CUENTAS_FIJAS));
  try {
    (holded("treasury") || []).forEach(function (x) {
      if (!x || !x.id) return;
      var nom = String(x.name || ""), fija = CUENTAS_FIJAS[x.id];
      mapa[x.id] = [fija ? fija[0] : nom, (fija ? fija[1] : (x.archived || /\bOLD\b/i.test(nom) ? 1 : 0)) ? 1 : 0];
    });
  } catch (e) {}
  try { cache.put("COB_CTAS", JSON.stringify(mapa), 21600); } catch (e2) {}
  return mapa;
}
/* «CAJA CHICA» y «Caja Chica NEW» son la misma cuenta: se comparan sin mayúsculas, tildes ni «new» */
function ctaNorm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\bnew\b/g, "").replace(/\s+/g, " ").trim(); }
/* cuentas de Holded donde debe ir lo que cobró el vendedor (activas; los bolívares de notas con factura van a la jurídica; el IVA no va a Holded) */
function cuentasEsperadas(f) {
  var o = []; if (f.ef > 0) o.push(CUENTA_HOLDED.ef); if (f.us > 0) o.push(CUENTA_HOLDED.us); if (f.ze > 0) o.push(CUENTA_HOLDED.ze); if (f.mp > 0) o.push(CUENTA_HOLDED.mp);
  if (f.bs - f.iv > 0.009) o.push(f.fa ? CUENTA_HOLDED.bsFac : CUENTA_HOLDED.bs);
  return o;
}
/* f = cobro con sus pagos de Holded [[idPago, monto]]; nota = la nota en Holded. Devuelve { txt: "CAJA CHICA $500,00", dif: "" | "Holded: … · tu recibo: …" } */
function cuentasReales(f, nota) {
  var mapa = cuentasHolded(), det = {}, por = {}, orden = [], arch = [];
  (nota.paymentsDetail || []).forEach(function (p) { det[p.id] = p; });
  (f.pagos || []).forEach(function (u) {
    var p = det[u[0]]; if (!p) return;
    var c = mapa[p.bankId] || ["cuenta desconocida", 0], k = c[0];
    if (!por.hasOwnProperty(k)) { por[k] = 0; orden.push(k); }
    por[k] += Number(u[1]) || 0; if (c[1] && arch.indexOf(k) < 0) arch.push(k);
  });
  var txt = orden.map(function (k) { return k + " $" + (Math.round(por[k] * 100) / 100).toFixed(2).replace(".", ","); }).join(" + ");
  var esp = cuentasEsperadas(f), real = {}, pedida = {}; orden.forEach(function (k) { real[ctaNorm(k)] = 1; }); esp.forEach(function (k) { pedida[ctaNorm(k)] = 1; });
  var dif = "";
  if (arch.length) dif = "Holded lo registró en una cuenta archivada: " + arch.join(" + ");
  else if (orden.length && esp.length && (esp.some(function (k) { return !real[ctaNorm(k)]; }) || orden.some(function (k) { return !pedida[ctaNorm(k)]; })))
    dif = "Holded: " + orden.join(" + ") + " · tu recibo: " + esp.join(" + ");
  return { txt: txt, dif: dif };
}
/* Cada hora: los cobros confirmados que aún no tienen su cuenta real (los de antes de este cambio), los que tenían diferencia y los confirmados en los últimos 3 días (por si administración los corrige).
   Máximo 20 notas por corrida para no pasar del tiempo de Apps Script. */
function cobrosRevisarCuentas(filas) {
  var hoja = hojaCobros(), ahora = Date.now() / 1000, grupos = {}, n = 0;
  filas.forEach(function (f) {
    if (f.estado !== "confirmado" || f.ts < ahora - 95 * 86400) return;
    if (!f.pagos.length) { if (!f.cr) escribir(hoja, f.fila, { "Cuenta real Holded": "sin pago en Holded" }); return; }
    if (f.cr && !(f.dif && f.ts >= ahora - 30 * 86400) && !(f.tsc >= ahora - 3 * 86400)) return;     // sin cuenta real aún · con diferencia reciente · confirmado hace menos de 3 días (administración suele corregir enseguida)
    (grupos[f.notaId] = grupos[f.notaId] || []).push(f);
  });
  Object.keys(grupos).forEach(function (nid) {
    if (n >= 20) return; n++;
    var nota; try { nota = holded("documents/invoice/" + nid); } catch (e) { return; }
    grupos[nid].forEach(function (f) {
      var cu = cuentasReales(f, nota), nuevo = cu.txt || "sin pago en Holded";
      if (nuevo !== f.cr || cu.dif !== f.dif) escribir(hoja, f.fila, { "Cuenta real Holded": nuevo, "Diferencia": cu.dif });
    });
  });
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
      ts: N(r[COB["ts"]]), tag: String(r[COB["tag"]]), notaId: String(r[COB["notaId"]]), uid: String(r[COB["uid"]]), base: J(r[COB["base"]]), pagos: J(r[COB["pagos"]]),
      mp: N(r[COB["Mercantil Panamá $"]]), iv: N(r[COB["IVA cobrado $"]]), bsb: N(r[COB["Monto Bs"]]), tbc: N(r[COB["Tasa BCV"]]), fp: ymd(r[COB["Fecha del pago"]]),
      ct: String(r[COB["Cuenta destino"]] || ""), ch: String(r[COB["Cuenta Holded"]] || ""), cap: String(r[COB["Captura"]] || ""), av: String(r[COB["Avisos"]] || ""),
      tsc: N(r[COB["Confirmado ts"]]), cr: String(r[COB["Cuenta real Holded"]] || ""), dif: String(r[COB["Diferencia"]] || ""),
      avv: String(r[COB["Aviso del vendedor"]] || "").split(" |")[0], avvTs: N(String(r[COB["Aviso del vendedor"]] || "").split(" |")[1]) });
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
    if (b.a === "cap") return json(capturaGuardar(b));
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

/* ---- captura del pago de un cobro: llega por POST {a:"cap", cod, d, x:{id}, tipo, b64} (la imagen ya viene reducida por el teléfono) ---- */
function capturaGuardar(b) {
  var tag = vendedorDe(b); if (!tag) return { estado: "no", msg: "Dispositivo o código no autorizado" };
  var tipo = String(b.tipo || ""), ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[tipo];
  if (!ext) return { estado: "error", msg: "Solo se aceptan imágenes" };
  var bytes = Utilities.base64Decode(String(b.b64 || ""));
  if (bytes.length < 200 || bytes.length > 6 * 1024 * 1024) return { estado: "error", msg: "La imagen está vacía o pesa más de 6 MB" };
  var uid = String((b.x || {}).id || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 40), lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var hoja = hojaCobros(), f = leerCobros(hoja).filter(function (x) { return x.uid === uid && x.tag === tag; })[0];
    if (!f) return { estado: "error", msg: "No encontré el cobro" };                      // aún no llega: el teléfono lo intenta luego
    if (f.cap) return { estado: "ok", repetido: true };
    var nombre = "Captura_" + f.recibo + "_" + f.nota + "_" + fcTxt(f.cliente, 40).replace(/[^\wÁÉÍÓÚÑáéíóúñ .-]/g, "") + "_" +
      Utilities.formatDate(new Date(), "America/Caracas", "yyyy-MM-dd_HHmm") + "." + ext;
    var arch = capCarpeta().createFile(Utilities.newBlob(bytes, tipo, nombre));
    escribir(hoja, f.fila, { "Captura": arch.getUrl() });
    return { estado: "ok" };
  } finally { lock.releaseLock(); }
}
function capCarpeta() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty("COB_CAP_DIR");
  if (id) try { return DriveApp.getFolderById(id); } catch (e) {}
  var c = DriveApp.createFolder("Comprobantes NTX"); props.setProperty("COB_CAP_DIR", c.getId()); return c;
}

/* ---- tasa BCV oficial (Bs por dólar) por fecha valor: hoja "Tasas BCV" del libro de cobranzas ---- */
var TASA_COLS = ["Fecha valor", "Tasa", "Fuente", "Leída el"];
function tasaHoja() {
  var lib = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("COB_HOJA") || ""), h = lib.getSheetByName("Tasas BCV");
  if (!h) { h = lib.insertSheet("Tasas BCV"); h.getRange(1, 1, 1, TASA_COLS.length).setValues([TASA_COLS]).setFontWeight("bold"); h.setFrozenRows(1); h.getRange(1, 1, h.getMaxRows(), 1).setNumberFormat("@"); }
  return h;
}
/* Primero la página del BCV (tasa y "Fecha Valor"); si no responde o cambió, ve.dolarapi.com (toma la misma tasa del BCV). */
function tasaBcvLeer() {
  var t = null;
  try {
    var h = UrlFetchApp.fetch("https://www.bcv.org.ve/", { muteHttpExceptions: true, validateHttpsCertificates: false, followRedirects: true }).getContentText();
    var m = /id="dolar"[\s\S]*?<strong>\s*([\d.,]+)\s*<\/strong>/.exec(h), f = /Fecha Valor:[\s\S]*?content="(\d{4}-\d{2}-\d{2})/.exec(h);
    if (m && f) t = { f: f[1], v: Number(m[1].replace(/\./g, "").replace(",", ".")), fu: "bcv.org.ve" };
  } catch (e) {}
  if (!t || !(t.v > 0)) try {
    var j = JSON.parse(UrlFetchApp.fetch("https://ve.dolarapi.com/v1/dolares/oficial", { muteHttpExceptions: true }).getContentText());
    if (j && Number(j.promedio) > 0) t = { f: String(j.fechaActualizacion || "").slice(0, 10), v: Number(j.promedio), fu: "ve.dolarapi.com" };
  } catch (e2) {}
  if (!t || !(t.v > 10) || !/^\d{4}-\d{2}-\d{2}$/.test(t.f)) return null;
  var hoja = tasaHoja(), filas = hoja.getDataRange().getValues(), i;
  for (i = 1; i < filas.length; i++) if (ymd(filas[i][0]) === t.f) break;
  var fila = [t.f, Math.round(t.v * 10000) / 10000, t.fu, fecha(new Date().toISOString())];
  if (i < filas.length) hoja.getRange(i + 1, 1, 1, fila.length).setValues([fila]); else hoja.appendRow(fila);
  CacheService.getScriptCache().remove("COB_TASAS");
  PropertiesService.getScriptProperties().setProperty("COB_TASA_T", String(Date.now()));
  return t;
}
function tasaBcvAlDia() { var u = Number(PropertiesService.getScriptProperties().getProperty("COB_TASA_T") || 0); if (Date.now() - u > 3 * 3600000) tasaBcvLeer(); }
/* las últimas 60 tasas [[fecha valor, tasa]]: el teléfono escoge la vigente en la fecha de cada pago */
function tasasRecientes() {
  var cache = CacheService.getScriptCache(), c = cache.get("COB_TASAS"); if (c) return JSON.parse(c);
  var filas = tasaHoja().getDataRange().getValues().slice(1).map(function (r) { return [ymd(r[0]), Number(r[1]) || 0]; }).filter(function (r) { return r[0] && r[1] > 0; });
  if (!filas.length && tasaBcvLeer()) return tasasRecientes();                      // primera vez: se lee en el momento
  filas.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }); filas = filas.slice(-60);
  cache.put("COB_TASAS", JSON.stringify(filas), 600); return filas;
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
