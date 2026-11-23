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
  "Confirmado ts", "Cuenta real Holded", "Diferencia", "Aviso del vendedor",
  "Origen", "Registro Holded", "Revisión admin",
  "Grupo", "Notas del grupo", "Saldo a favor"];
// (23 nov 2026) un pago para varias notas: el teléfono manda una fila por nota, todas con el mismo «Grupo» (id del pago) y el mismo número de recibo.
// «Notas del grupo» = "NE4240 + NE4262" (para leerlo en la hoja y en Holded) · «Saldo a favor» = lo que sobró del pago, por forma de pago, solo en la primera fila
// ({"ze":6.82}); no abona a ninguna nota ni va a Holded: administración decide qué hacer con él.
// (22 nov 2026, parte 3) Origen = "admin" en los cobros que registra administración (serie A-) · Registro Holded = partes ya pagadas en Holded desde la app
// (si un registro se corta a medias, al reintentar solo se paga lo que falta) · Revisión admin = cuándo administración dejó una diferencia de cuenta como está
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
var COB_ACC = { cobro: 1, cobros: 1, anular: 1, solfac: 1, solcancel: 1, ret: 1, adm: 1, admacc: 1, recibos: 1, captura: 1, avisar: 1, adcob: 1, adreg: 1, adrev: 1, adcap: 1 };
function esCobranzas(a) { return COB_ACC.hasOwnProperty(String(a || "")); }
function cobranzas(q) {
  try {
    if (q.a === "adm" || q.a === "admacc") return fcAdmin(q);           // bandeja de Mango (Pedidos NTX), con la llave ADMIN
    if (/^ad(cob|reg|rev|cap)$/.test(q.a)) return adCobros(q);           // ADMIN › Cobros (parte 3), con la llave ADMIN
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
  var gr = String(c.gr || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 40); if (gr.length < 8) gr = "";   // pago para varias notas: una fila por nota, mismo grupo
  var ef = num(c.ef), us = num(c.us), ze = num(c.ze), mp = num(c.mp), bs = num(c.bs), nom = Math.round((ef + us + ze + mp + bs) * 100) / 100, ab = num(c.ab), div = ef + us + ze + mp;
  if (uid.length < 8 || nid.length !== 24) return { estado: "error", msg: "Cobro incompleto" };
  if (nom <= 0) return { estado: "error", msg: "El monto debe ser mayor que cero" };
  // El abono real solo puede ser menor que lo cobrado por la parte en bolívares de una nota BCV (x 0,85).
  var F = 1 - descuentoBcv() / 100, tb = c.tb === "b", dd = tb ? Math.max(0, Math.min(50, Number(c.dd) || 0)) : 0;
  var iv = tb ? Math.min(bs, num(c.iv)) : 0;                                            // IVA que vino con el pago (solo notas facturadas, sale de los bolívares)
  var bv = tb ? Math.round((bs - iv + div / (1 - dd / 100)) * 100) / 100 : nom;          // abono en dólares de la nota (BCV o USD), sin el IVA
  if (ab > nom + 0.01 || ab < div + (bs - iv) * (tb ? F : 1) - 0.02) return { estado: "error", msg: "El abono no cuadra con lo cobrado" };
  // Administración (llave ADMIN): cobra cualquier nota; el recibo sale con la serie A- y el cobro se registra en Holded en el mismo momento.
  var adm = !!ADMIN && String(q.k || "") === ADMIN;
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var hoja = hojaCobros(), filas = leerCobros(hoja);
    for (var i = 0; i < filas.length; i++) if (filas[i].uid === uid) return { estado: "ok", repetido: true, cobro: vista(filas[i]) };   // reenvío del mismo cobro
    var nota = holded("documents/invoice/" + nid), cont = holded("contacts/" + nota.contact), tagCli = ((cont.tags || [""])[0] || "");
    if (!adm && tagCli !== tag) return { estado: "error", msg: "Esa nota no es de un cliente de tu cartera" };
    var tagFila = adm ? tagCli : tag, ckey = adm ? "COB_N_A" : "COB_N_" + tag;
    var usado = function (r) { return filas.some(function (f) { return f.recibo === r && (adm ? f.org === "admin" : f.tag === tag && f.org !== "admin"); }); };
    var fac0 = fcDeTags(nota.tags);
    if (iv > 0 && !fac0) return { estado: "error", msg: "Esta nota no tiene factura: el pago no puede llevar IVA" };
    // Todo se compara en dólares de la nota: en una nota BCV, lo que falta en Holded (reales) se lleva a dólares BCV con el descuento de la nota
    var pend = Number(nota.paymentsPending) || 0, dn = Number(nota.discount) || 0;
    var pendN = tb ? (dn > 0 ? pend / (1 - dn / 100) : pend) : pend;
    var mios = filas.filter(function (f) { return f.notaId === nid && (f.estado === "cobrado" || f.estado === "revisar"); })
      .reduce(function (s, f) { return s + (f.bv || (f.tarifa === "BCV" ? f.abono / F : f.abono)); }, 0);
    if (bv > pendN - mios + 0.5) return { estado: "error", msg: "El abono ($" + bv.toFixed(2) + (tb ? " BCV" : "") + ") es mayor que lo que falta de la nota ($" + Math.max(0, pendN - mios).toFixed(2) + (tb ? " BCV" : "") + ")" };
    var props = PropertiesService.getScriptProperties(), n = Number(props.getProperty(ckey) || 0) + 1, ahora = new Date();
    var pre = adm ? "A" : prefijoRecibo(tag), rec = pre + "-" + ("000" + n).slice(-4);
    // El teléfono propone el número (así entrega el recibo en el momento, incluso sin conexión). Se respeta si es de este vendedor y nadie lo usó.
    // Pago para varias notas: las filas que siguen a la primera llevan su mismo número de recibo (aunque el receptor le haya cambiado el que propuso el teléfono).
    var hermanos = gr ? filas.filter(function (f) { return f.gr === gr && f.tag === tagFila && f.estado !== "anulado"; }) : [];
    if (hermanos.length) {
      if (hermanos.some(function (f) { return f.notaId === nid; })) return { estado: "error", msg: "La nota " + String(nota.docNumber || "") + " ya está en este cobro" };
      var cli = function (s) { return String(s || "").trim().toLowerCase(); };
      if (cli(hermanos[0].cliente) !== cli(String(nota.contactName || c.cn || "").slice(0, 120))) return { estado: "error", msg: "Las notas de un mismo cobro deben ser del mismo cliente" };
      rec = hermanos[0].recibo; n = 0;                                                    // el contador no se mueve: es el mismo recibo
    } else {
      var prop = /^([A-Z]+)-(\d{4,6})$/.exec(String(c.rec || ""));
      if (prop && prop[1] === pre && !usado(c.rec)) { rec = String(c.rec); n = Math.max(n - 1, Number(prop[2])); }
      else while (usado(rec)) { n++; rec = pre + "-" + ("000" + n).slice(-4); }
    }
    var base = (nota.paymentsDetail || []).map(function (p) { return p.id; });
    var fila = []; COB_COLS.forEach(function () { fila.push(""); });
    var pon = function (k, v) { fila[COB[k]] = v; };
    pon("Recibo", rec); pon("Fecha", fecha(ahora.toISOString())); pon("Vendedor", adm ? carNombre(tagCli) : VENDEDORES[tag].nombre); if (adm) pon("Origen", "admin"); pon("Cliente", String(nota.contactName || c.cn || "").slice(0, 120));
    pon("Nota", String(nota.docNumber || "")); pon("Cobrado $", nom); pon("Abono real $", ab); pon("Efectivo $", ef || ""); pon("USDT $", us || ""); pon("Zelle $", ze || "");
    pon("Bs (en $)", bs || ""); pon("Tasa", num(c.ta) || ""); pon("Referencia", String(c.rf || "").replace(/^[=+@-]+/, "").slice(0, 120)); pon("Estado", "cobrado");
    pon("ts", Math.floor(ahora.getTime() / 1000)); pon("tag", tagFila); pon("notaId", nid); pon("uid", uid); pon("base", JSON.stringify(base)); pon("pagos", "[]");
    pon("Tarifa", tb ? "BCV" : "USD"); pon("Desc. divisas %", dd || ""); pon("Abono a la nota $", bv);
    // captura y datos nuevos (22 nov 2026)
    var tx = function (v, n) { return String(v || "").replace(/^[=+@-]+/, "").slice(0, n); };
    var fp = /^\d{4}-\d{2}-\d{2}$/.test(String(c.fp || "")) ? String(c.fp) : "", cd = tx(c.cd, 120), avisos = [];
    var cts = String(c.ct || "").split(",").map(function (x) { return tx(x, 20).trim(); }).filter(Boolean);   // una por captura
    pon("Mercantil Panamá $", mp || ""); pon("IVA cobrado $", iv || ""); pon("Monto Bs", num(c.bsb) || ""); pon("Tasa BCV", Number(c.tbc) > 0 ? Number(c.tbc) : "");
    pon("Fecha del pago", fp ? "'" + fp : ""); pon("Cuenta destino", cts.map(function (x) { return x === "?" ? "no reconocida" : x; }).join(", ")); pon("Destino leído", cd); pon("Lectura", tx(c.lx, 300));
    pon("Cuenta Holded", cuentaHolded(ef, us, ze, mp, bs - iv, !!fac0));
    if (cts.indexOf("?") >= 0) avisos.push("La captura no muestra una cuenta de la empresa" + (cd ? " (" + cd + ")" : ""));
    var refsDe = function (t) { return String(t || "").split("·").map(refNorm).filter(function (x) { return x.length >= 6; }); }, mias = refsDe(c.rf);
    var gn = gr ? tx(c.gn, 200) : "", sf = gr && !hermanos.length ? sfLee(c.sf) : {};          // lo que sobró del pago va solo en la primera fila del grupo
    pon("Grupo", gr); pon("Notas del grupo", gn); if (Object.keys(sf).length) pon("Saldo a favor", JSON.stringify(sf));
    if (mias.length) filas.forEach(function (f) { if (f.estado !== "anulado" && !(gr && f.gr === gr) && refsDe(f.ref).some(function (x) { return mias.indexOf(x) >= 0; })) avisos.push("Referencia repetida: ya está en el recibo " + f.recibo + " (" + f.vendedor + ", nota " + f.nota + ")"); });
    if (avisos.length) pon("Avisos", avisos.join(" · "));
    if (ab < 0.01 && iv > 0) { pon("Estado", "confirmado"); pon("Observación", "Solo IVA: no se registra en Holded"); pon("Confirmado el", fecha(ahora.toISOString())); pon("Confirmado ts", Math.floor(ahora.getTime() / 1000)); }   // nada que conciliar
    var fac = fcDeTags(nota.tags); if (fac) pon("Factura", "'" + fac[0]);   // el pago de una nota facturada se registra con su número de factura
    pon("dispositivo", corto(String(q.d || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 40)));
    hoja.appendRow(fila);
    if (n) props.setProperty(ckey, String(n));
    var filas2 = leerCobros(hoja), f = filas2.filter(function (x) { return x.uid === uid; })[0];
    var aviso = avisos.filter(function (a) { return /^Referencia repetida/.test(a); })[0];
    var out = { estado: "ok", cobro: vista(f), saldoHolded: pend, aviso: aviso ? aviso + ". Si es un mismo pago para varias notas, la próxima vez regístralo con «Este pago cubre varias notas»; si no, revísalo." : "" };
    if (adm && f.estado === "cobrado") {                                                  // administración ya tiene el dinero: se registra en Holded de una vez
      try { out.reg = registrarFila(hoja, filas2, f); } catch (e) { out.reg = { error: String(e && e.message || e) }; }
      out.cobro = vista(f);
    }
    return out;
  } finally { lock.releaseLock(); }
}
function cobroAnular(tag, q) {
  var rec = String(q.r || ""), lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var hoja = hojaCobros(), filas = leerCobros(hoja), f = filas.filter(function (x) { return x.recibo === rec && x.tag === tag && x.org !== "admin" && x.estado !== "anulado"; })[0];   // los de administración no los anula el vendedor
    if (!f) return { estado: "error", msg: "No encontré ese recibo" };
    // pago para varias notas: el recibo es uno solo, así que se anulan todas sus partes juntas (y ninguna si alguna ya está confirmada)
    var partes = f.gr ? filas.filter(function (x) { return x.gr === f.gr && x.tag === tag && x.org !== "admin" && x.estado !== "anulado"; }) : [f];
    var hecha = partes.filter(function (x) { return x.estado !== "cobrado" && x.estado !== "revisar"; })[0];
    if (hecha) return { estado: "error", msg: partes.length > 1 ? "La parte de la nota " + hecha.nota + " ya está " + hecha.estado + ": este cobro no se puede anular. Avisa a administración." : "Ese cobro ya está " + hecha.estado + " y no se puede anular" };
    var obs = "Anulado por el vendedor el " + fecha(new Date().toISOString());
    partes.forEach(function (x) { escribir(hoja, x.fila, { "Estado": "anulado", "Observación": obs }); });
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
  var rec = String(q.r || ""), id = String(q.id || ""), f = leerCobros(hojaCobros()).filter(function (x) { return tag === null ? x.uid === id : x.recibo === rec && x.tag === tag; })[0];
  if (!f) return { estado: "error", msg: "No encontré ese recibo" };
  var links = capLinks(f.cap), u = links[Math.max(0, Number(q.i) || 0)] || "";
  var m = /\/d\/([A-Za-z0-9_-]+)/.exec(u) || /[?&]id=([A-Za-z0-9_-]+)/.exec(u);
  if (!m) return { estado: "error", msg: "Este recibo no tiene captura guardada" };
  var blob = DriveApp.getFileById(m[1]).getBlob();
  return { estado: "ok", tipo: blob.getContentType(), b64: Utilities.base64Encode(blob.getBytes()), n: links.length };
}
function capLinks(s) { return String(s || "").split(" · ").filter(function (x) { return /^https?:/.test(x); }); }
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
  iv: f.iv, bsb: f.bsb, tbc: f.tbc, fp: f.fp, ct: f.ct, cap: capLinks(f.cap).length, av: f.av,
  tsc: f.tsc || 0, ch: f.ch, cr: f.cr, dif: f.rva ? "" : f.dif, avv: f.avv, ad: f.org === "admin" ? 1 : 0,
  gr: f.gr || "", gn: f.gn || "", sf: f.sf || {} }; }   // pago para varias notas: grupo, sus notas y lo que sobró (solo en la primera fila)   // diferencia que administración dejó como está: ya no se marca
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
      hechos += conciliarNota(hoja, filas, nid, nota, ahora, avisos);
    });
    try { cobrosRevisarCuentas(filas); } catch (e7) {}                         // cuenta real en Holded de los cobros ya confirmados (y los que tenían diferencia)
    try { fcMarcarEmitidas(); } catch (e4) {}                                   // solicitudes de factura ya emitidas (etiqueta fac###### en la nota)
    try { tasaBcvAlDia(); } catch (e5) {}                                       // tasa BCV para el portal (cada 3 horas)
    if (avisos.length) aviso("cobros por revisar (" + avisos.length + ")", "Estos cobros anotados por los vendedores no se pudieron confirmar solos contra Holded:\n\n" + avisos.join("\n\n") +
      "\n\nEn la hoja puedes escribir \"confirmado\" o \"anulado\" en la columna Estado para resolverlos a mano:\n" + hoja.getParent().getUrl());
    return hechos + " confirmados, " + avisos.length + " por revisar";
  } finally { lock.releaseLock(); }
}

/* Concilia los cobros de UNA nota contra cómo está en Holded. Escribe los cambios en la hoja y también en las filas en memoria
   (así quien llama ve el estado nuevo). Devuelve cuántos cobros confirmó. */
function conciliarNota(hoja, filas, nid, nota, ahora, avisos) {
  var grupo = filas.filter(function (f) { return f.notaId === nid && f.estado !== "anulado"; }), hechos = 0;
  var cambios = conciliar({ pendiente: Number(nota.paymentsPending) || 0, pagos: (nota.paymentsDetail || []).map(function (p) { return [p.id, p.amount, p.date]; }) },
    grupo.map(function (f) { return { id: f.uid, fecha: f.ts, abono: f.abono, bs: f.bs > 0, base: f.base, estado: f.estado, pagos: f.pagos, obs: f.obs }; }), ahora);
  cambios.forEach(function (c) {
    var f = grupo.filter(function (x) { return x.uid === c.id; })[0], v = { "Estado": c.estado, "Observación": c.obs };
    if (c.estado === "confirmado") {
      v["pagos"] = JSON.stringify(c.pagos); v["Confirmado el"] = fecha(new Date().toISOString()); v["Confirmado ts"] = ahora; hechos++;
      try { var cu = cuentasReales(Object.assign({}, f, { pagos: c.pagos }), nota); v["Cuenta real Holded"] = cu.txt || "sin pago en Holded"; v["Diferencia"] = cu.dif; f.cr = v["Cuenta real Holded"]; f.dif = cu.dif; } catch (e6) {}
      f.pagos = c.pagos; f.tsc = ahora;
    }
    else if (avisos) avisos.push(f.recibo + " · " + f.vendedor + " · " + f.cliente + " · " + f.nota + " · $" + f.abono.toFixed(2) + "\n   " + c.obs);
    escribir(hoja, f.fila, v); f.estado = c.estado; f.obs = c.obs;
  });
  return hechos;
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
    if (f.estado !== "confirmado" || f.ts < ahora - 95 * 86400 || f.rva) return;          // diferencia que administración dejó como está
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
      avv: String(r[COB["Aviso del vendedor"]] || "").split(" |")[0], avvTs: N(String(r[COB["Aviso del vendedor"]] || "").split(" |")[1]),
      org: String(r[COB["Origen"]] || ""), reg: J(r[COB["Registro Holded"]]), rva: String(r[COB["Revisión admin"]] || ""),
      gr: String(r[COB["Grupo"]] || ""), gn: String(r[COB["Notas del grupo"]] || ""), sf: sfLee(r[COB["Saldo a favor"]]) });
  }
  return out;
}
function escribir(hoja, fila, valores) { for (var k in valores) hoja.getRange(fila, COB[k] + 1).setValue(valores[k]); }
/* saldo a favor de un pago para varias notas: {"ze":6.82} → solo formas de pago conocidas y montos positivos */
function sfLee(x) {
  var o = x; if (typeof o === "string") { try { o = JSON.parse(o || "{}"); } catch (e) { o = {}; } }
  var out = {}; if (!o || typeof o !== "object") return out;
  ["ef", "us", "ze", "mp", "bs"].forEach(function (k) { var v = Math.round((Number(o[k]) || 0) * 100) / 100; if (v > 0 && v < 1e6) out[k] = v; });
  return out;
}
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
    if (b.a === "adcar") return json(adCarpeta(b));                       // ADMIN › Cobros: carpeta física
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
    var esAdm = !!ADMIN && String(b.k || "") === ADMIN;
    var hoja = hojaCobros(), filas = leerCobros(hoja), f = filas.filter(function (x) { return x.uid === uid && (x.tag === tag || esAdm); })[0];
    if (!f) return { estado: "error", msg: "No encontré el cobro" };                      // aún no llega: el teléfono lo intenta luego
    var i = Math.max(0, Math.min(3, Number((b.x || {}).i) || 0)), links = String(f.cap || "").split(" · ");   // varias capturas: un enlace por posición
    if (/^https?:/.test(links[i] || "")) return { estado: "ok", repetido: true };
    var nombre = "Captura_" + f.recibo + (i ? "_" + (i + 1) : "") + "_" + f.nota + "_" + fcTxt(f.cliente, 40).replace(/[^\wÁÉÍÓÚÑáéíóúñ .-]/g, "") + "_" +
      Utilities.formatDate(new Date(), "America/Caracas", "yyyy-MM-dd_HHmm") + "." + ext;
    var arch = capCarpeta().createFile(Utilities.newBlob(bytes, tipo, nombre));
    for (var j = 0; j < i; j++) if (!links[j]) links[j] = "-";
    links[i] = arch.getUrl();
    escribir(hoja, f.fila, { "Captura": links.join(" · ") });
    // pago para varias notas: la captura se sube una vez (con la primera fila) y queda enlazada en todas las partes del recibo
    if (f.gr) filas.forEach(function (x) { if (x.gr === f.gr && x.uid !== f.uid && x.tag === f.tag) escribir(hoja, x.fila, { "Captura": links.join(" · ") }); });
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

/* =====================================================================================================================
   ADMIN › COBROS (22 nov 2026, parte 3). Solo con la llave ADMIN (k). Es lo ÚNICO de cobranzas que ESCRIBE en Holded: un pago por cada
   cuenta, con POST documents/invoice/{id}/pay {date, amount, treasury, desc}. Nunca cambia ni borra pagos que ya estén en Holded.
   ?a=adcob                vista: cobros por registrar, con diferencia, tasa BCV, «por anotar en carpeta» y notas pendientes de todos
   ?a=adreg&id=<uid>       registra el cobro en Holded y lo confirma (antes concilia: si Holded ya lo tiene, no registra nada)
   ?a=adrev&id=<uid>&e=…   revisar (vuelve a leer la cuenta en Holded) · aceptar (deja la cuenta como está) · confirmar (sin pago enlazado) · anular
   ?a=adcap&id=<uid>       captura de cualquier cobro
   POST {a:"adcar", k, e:"anotado"|"pendiente", p:[[idPago, nota, monto]]}   carpeta física (los pagos que Mango ya anotó en la copia en papel)
   ?a=cobro&k=…            cobro de administración (serie A-): lo guarda cobroNuevo y lo registra en Holded en el mismo momento
   ===================================================================================================================== */
var CUENTA_ID = { "CAJA CHICA": "6a21f48b02f61e3fdd0793bc", "USDT": "6a21f1483e0218208d0617fc", "NUEVO ZELLE": "6a21f411a4a649295b04885a", "MERCANTIL PANAMÁ": "6a21f70ee03e72b64706c44b",
  "Caja para Operaciones en Tránsito": "6a21eaccb7dfd73add017db7", "Bolivares Cuenta Juridica": "6af785d7818ea0e4e008b81a" };
var CAR_COLS = ["Pago", "Estado", "Marcado el", "Nota", "Monto $", "ts"];
function adRd(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function adCobros(q) {
  if (!ADMIN || String(q.k || "") !== ADMIN) return { estado: "no", msg: "No autorizado" };
  if (q.a === "adcap") return capturaVer(null, q);
  var notas = q.a === "adcob" ? notasTodas() : null, tags = q.a === "adcob" ? contactosTags() : null;   // lo lento (Holded) antes de tomar la hoja
  var lock = LockService.getScriptLock(); lock.waitLock(28000);
  try {
    var hoja = hojaCobros(), filas = leerCobros(hoja), f = q.id ? filas.filter(function (x) { return x.uid === String(q.id); })[0] : null;
    if (q.a === "adreg") {
      if (!f) return { estado: "error", msg: "No encontré ese cobro" };
      return { estado: "ok", reg: registrarFila(hoja, filas, f), cobro: adFila(f, null) };
    }
    if (q.a === "adrev") return adRevisar(hoja, filas, f, String(q.e || ""));
    return adVista(hoja, filas, notas, tags);
  } finally { lock.releaseLock(); }
}
/* nombre de la carpeta física (una por vendedor) y prefijo de los recibos: la A- es de administración */
function carNombre(tag) {
  if (!tag) return "Sin vendedor"; if (tag === "rm") return "Mango";
  var v = VENDEDORES[tag]; if (v && v.nombre) return String(v.nombre).replace(/\s*\(.*\)$/, "");
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}
function prefijoRecibo(tag) { var v = VENDEDORES[tag] || {}; if (v.pre) return v.pre; var t = String(tag || "x").toUpperCase(); return t.charAt(0) === "A" ? t.charAt(0) + t.charAt(t.length - 1) : t.charAt(0); }
/* todas las notas de Holded, compactas (45 s en memoria): pagos con su cuenta, y las líneas solo de las notas de los últimos 3 días (el portal deduce la tarifa) */
function notasTodas() {
  var cache = CacheService.getScriptCache(), c = cache.get("COB_TODAS"); if (c) return JSON.parse(c);
  var out = [], hace3 = Date.now() / 1000 - 3 * 86400;
  for (var p = 1; p <= 10; p++) {
    var docs = holded("documents/invoice?page=" + p); if (!docs.length) break;
    docs.forEach(function (d) {
      if (d.draft || !d.docNumber) return;
      out.push({ id: d.id, num: String(d.docNumber), c: d.contact || "", cn: String(d.contactName || ""), f: Number(d.date) || 0, v: Number(d.dueDate) || 0,
        tot: adRd(d.total), pag: adRd(d.paymentsTotal), pen: adRd(d.paymentsPending), d: Number(d.discount) || 0, fac: fcDeTags(d.tags),
        pg: (d.paymentsDetail || []).map(function (y) { return [y.id, adRd(y.amount), Number(y.date) || 0, y.bankId || ""]; }),
        ln: (Number(d.date) || 0) >= hace3 ? (d.products || []).filter(function (l) { return l.sku; }).slice(0, 60).map(function (l) { return [String(l.sku), Number(l.price) || 0]; }) : null });
    });
    if (docs.length < 500) break;
  }
  try { cache.put("COB_TODAS", JSON.stringify(out), 45); } catch (e) {}
  return out;
}
/* etiqueta de vendedor de cada cliente (la primera etiqueta del contacto), una hora en memoria */
function contactosTags() {
  var cache = CacheService.getScriptCache(), c = cache.get("COB_TAGS"); if (c) return JSON.parse(c);
  var m = {};
  for (var p = 1; p <= 10; p++) { var l = holded("contacts?page=" + p); if (!l.length) break; l.forEach(function (x) { m[x.id] = String((x.tags || [""])[0] || ""); }); if (l.length < 500) break; }
  try { cache.put("COB_TAGS", JSON.stringify(m), 3600); } catch (e) {}
  return m;
}
/* lo que se registra en Holded: una parte por cuenta. Los bolívares van en dólares reales (lo que el cobro abona a la nota menos las divisas) */
function partesHolded(f, fac) {
  var p = [];
  [["ef", "CAJA CHICA"], ["us", "USDT"], ["ze", "NUEVO ZELLE"], ["mp", "MERCANTIL PANAMÁ"]].forEach(function (x) { if (f[x[0]] > 0.004) p.push({ k: x[0], cta: x[1], m: adRd(f[x[0]]) }); });
  var bs = adRd(f.abono - f.ef - f.us - f.ze - f.mp);
  if (bs > 0.009) p.push({ k: "bs", cta: fac ? CUENTA_HOLDED.bsFac : CUENTA_HOLDED.bs, m: bs });
  return p;
}
function fechaHolded(f) { return f.fp || Utilities.formatDate(new Date(f.ts * 1000), "America/Caracas", "yyyy-MM-dd"); }
/* aaaa-mm-dd → medianoche de España (así guarda Holded la fecha de los pagos que se anotan a mano) */
function tsHolded(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); if (!m) return Math.floor(Date.now() / 1000);
  var y = +m[1], mo = +m[2], d = +m[3], dom = function (mes) { var u = new Date(Date.UTC(y, mes, 0)); return u.getUTCDate() - u.getUTCDay(); };   // último domingo del mes
  var verano = (mo > 3 && mo < 10) || (mo === 3 && d >= dom(3)) || (mo === 10 && d < dom(10));
  return Date.UTC(y, mo - 1, d) / 1000 - (verano ? 7200 : 3600);
}
function cobHttp(metodo, ruta, cuerpo) {
  var k = PropertiesService.getScriptProperties().getProperty("HOLDED_KEY"); if (!k) throw new Error("Falta la propiedad HOLDED_KEY");
  var op = { method: metodo, headers: { key: k, Accept: "application/json" }, muteHttpExceptions: true }, r, cod = 0, datos = null;
  if (cuerpo != null) { op.contentType = "application/json"; op.payload = JSON.stringify(cuerpo); }
  try { r = UrlFetchApp.fetch("https://api.holded.com/api/invoicing/v1/" + ruta, op); cod = r.getResponseCode(); } catch (e) { cod = 0; }
  try { datos = r ? JSON.parse(r.getContentText() || "null") : null; } catch (e2) { datos = null; }
  return { codigo: cod, datos: datos };
}
/* empareja pagos de Holded con las partes de un cobro, por cuenta y monto */
function tomarPropios(pagos, partes) {
  var libres = pagos.slice(), ids = [], pares = [], completo = true;
  partes.forEach(function (p) {
    var i = -1; for (var j = 0; j < libres.length; j++) if (libres[j].bankId === CUENTA_ID[p.cta] && Math.abs(Number(libres[j].amount) - p.m) < 0.02) { i = j; break; }
    if (i < 0) { completo = false; return; }
    ids.push(libres[i].id); pares.push([libres[i].id, adRd(libres[i].amount)]); libres.splice(i, 1);
  });
  return { ids: ids, pares: pares, completo: completo };
}
/* Registra un cobro en Holded. Devuelve { ok, msg, aviso } · { ya, msg } (Holded ya lo tenía) · { alto, msg } (no se registró: hay algo que revisar).
   Si Holded rechaza una parte, lanza el error; lo ya pagado queda anotado en «Registro Holded» y al reintentar no se repite. */
function registrarFila(hoja, filas, f) {
  if (f.estado === "confirmado") return { ya: true, msg: "Este cobro ya estaba confirmado." };
  if (f.estado !== "cobrado" && f.estado !== "revisar") throw new Error("Este cobro está " + f.estado + ": no se registra.");
  var ahora = Math.floor(Date.now() / 1000), nota = holded("documents/invoice/" + f.notaId), antes = {};
  // 1) ¿Holded ya lo tiene? (administración pudo registrarlo a mano): se concilia la nota primero
  filas.forEach(function (x) { if (x.notaId === f.notaId) antes[x.uid] = x.estado; });
  conciliarNota(hoja, filas, f.notaId, nota, ahora);
  if (f.estado === "confirmado") return { ya: true, msg: "Holded ya tenía este pago" + (f.cr ? " (" + f.cr + ")" : "") + ": quedó confirmado sin registrar nada." };
  var otro = filas.filter(function (x) { return x.notaId === f.notaId && x.uid !== f.uid && antes[x.uid] !== "confirmado" && x.estado === "confirmado"; })[0];
  if (otro) return { alto: true, msg: "Holded ya tenía un pago nuevo en la nota " + f.nota + " y se asignó al recibo " + otro.recibo + ". Revisa la nota en Holded antes de registrar " + f.recibo + "." };
  // 2) pagos nuevos en Holded que no explica ni este cobro (un intento anterior a medias): mejor no registrar encima
  var fac = fcDeTags(nota.tags) || (f.fa ? [f.fa] : null), partes = partesHolded(f, !!fac), hechas = (f.reg || []).slice(), usados = {}, base = {};
  filas.forEach(function (x) { if (x.estado === "confirmado") (x.pagos || []).forEach(function (p) { usados[p[0]] = 1; }); });
  (f.base || []).forEach(function (id) { base[id] = 1; });
  var nuevos = (nota.paymentsDetail || []).filter(function (p) { return !base[p.id] && !usados[p.id]; });
  var propios = tomarPropios(nuevos, partes.filter(function (p) { return hechas.indexOf(p.k) >= 0; }));
  var raros = adRd(nuevos.filter(function (p) { return propios.ids.indexOf(p.id) < 0; }).reduce(function (s, p) { return s + Number(p.amount || 0); }, 0));
  if (raros >= 0.5) return { alto: true, msg: "En Holded hay un pago nuevo de $" + raros.toFixed(2) + " en la nota " + f.nota + " que no corresponde a ningún recibo. Revísalo en Holded antes de registrar " + f.recibo + "." };
  var faltan = partes.filter(function (p) { return hechas.indexOf(p.k) < 0; }), porPagar = adRd(faltan.reduce(function (s, p) { return s + p.m; }, 0)), pend = Number(nota.paymentsPending) || 0;
  if (!partes.length) throw new Error("Este cobro no tiene montos para registrar en Holded.");
  if (porPagar > pend + 0.5) return { alto: true, msg: "En Holded la nota " + f.nota + " solo tiene $" + pend.toFixed(2) + " pendientes y este cobro registra $" + porPagar.toFixed(2) + ". Revisa la nota en Holded." };
  var fh = tsHolded(fechaHolded(f)), desc = ("Recibo " + f.recibo + " · " + f.vendedor + (f.gn ? " · " + f.gn : "") + (f.ref ? " · ref. " + f.ref : "")).slice(0, 140);   // pago para varias notas: la misma referencia en cada nota
  for (var i = 0; i < faltan.length; i++) {
    var p = faltan[i], r = cobHttp("post", "documents/invoice/" + f.notaId + "/pay", { date: fh, amount: p.m, treasury: CUENTA_ID[p.cta], desc: desc });
    if (!((r.codigo === 200 || r.codigo === 201) && !(r.datos && r.datos.status === 0))) {
      escribir(hoja, f.fila, { "Registro Holded": JSON.stringify(hechas) }); f.reg = hechas;
      throw new Error("Holded no aceptó $" + p.m.toFixed(2) + " en " + p.cta + (r.datos && r.datos.info ? " (" + r.datos.info + ")" : " (respuesta " + r.codigo + ")") + "." +
        (hechas.length ? " Lo demás ya quedó en Holded; al tocar Registrar otra vez solo se registra lo que falta." : " No se registró nada; intenta de nuevo."));
    }
    hechas.push(p.k);
  }
  escribir(hoja, f.fila, { "Registro Holded": JSON.stringify(hechas) }); f.reg = hechas;
  try { var cache = CacheService.getScriptCache(); cache.remove("COB_TODAS"); cache.remove("COB_NT"); } catch (e) {}
  // 3) se confirma con los pagos que acaba de crear (por cuenta y monto): sin adivinar entre cobros parecidos de la misma nota
  var nota2 = holded("documents/invoice/" + f.notaId), mios = tomarPropios((nota2.paymentsDetail || []).filter(function (p) { return !base[p.id] && !usados[p.id]; }), partes);
  var v = { "Estado": "confirmado", "Observación": "Registrado en Holded desde la app (administración)", "pagos": JSON.stringify(mios.pares), "Confirmado el": fecha(new Date().toISOString()), "Confirmado ts": ahora };
  f.pagos = mios.pares; f.estado = "confirmado"; f.tsc = ahora; f.obs = v["Observación"];
  try { var cu = cuentasReales(f, nota2); v["Cuenta real Holded"] = cu.txt || "sin pago en Holded"; v["Diferencia"] = cu.dif; f.cr = v["Cuenta real Holded"]; f.dif = cu.dif; } catch (e3) {}
  escribir(hoja, f.fila, v);
  var out = { ok: true, msg: partes.map(function (x) { return "$" + x.m.toFixed(2).replace(".", ",") + " en " + x.cta; }).join(" + "), pend: Number(nota2.paymentsPending) || 0 }, av = [];
  if (!mios.completo) av.push("Holded aceptó el pago pero no lo encontré al releer la nota " + f.nota + ". Revísala en Holded.");
  if (f.tarifa === "BCV" && !(Number(nota2.discount) > 0) && out.pend >= 0.01) av.push("La nota " + f.nota + " aún no tiene el " + descuentoBcv() + " % en Holded: le quedan $" + out.pend.toFixed(2) + " pendientes hasta que le pongas el descuento.");
  if (av.length) out.aviso = av.join(" ");
  return out;
}
/* un cobro tal como lo ve administración */
function adFila(f, n) {
  var v = vista(f), fac = (n && n.fac) || (f.fa ? [f.fa] : null);
  v.ven = f.vendedor; v.org = f.org; v.reg = f.reg || []; v.rva = f.rva; v.partes = partesHolded(f, !!fac); v.fh = fechaHolded(f); v.fa = fac ? fac[0] : "";
  if (n) { v.npen = n.pen; v.nd = n.d; }
  return v;
}
function adRevisar(hoja, filas, f, e) {
  if (!f) return { estado: "error", msg: "No encontré ese cobro" };
  var hoy = fecha(new Date().toISOString()), ahora = Math.floor(Date.now() / 1000);
  if (e === "revisar") {                                                                 // «Ya lo corregí»: se vuelve a leer la cuenta en Holded
    var cu = cuentasReales(f, holded("documents/invoice/" + f.notaId));
    escribir(hoja, f.fila, { "Cuenta real Holded": cu.txt || "sin pago en Holded", "Diferencia": cu.dif }); f.cr = cu.txt || "sin pago en Holded"; f.dif = cu.dif;
    return { estado: "ok", sigue: !!cu.dif, cobro: adFila(f, null) };
  }
  if (e === "aceptar") { escribir(hoja, f.fila, { "Revisión admin": hoy }); f.rva = hoy; return { estado: "ok", cobro: adFila(f, null) }; }
  if (f.estado !== "cobrado" && f.estado !== "revisar") return { estado: "error", msg: "Ese cobro ya está " + f.estado };
  if (e === "confirmar") {
    escribir(hoja, f.fila, { "Estado": "confirmado", "Observación": "Confirmado a mano por administración el " + hoy, "Confirmado el": hoy, "Confirmado ts": ahora });
    f.estado = "confirmado"; return { estado: "ok", cobro: adFila(f, null) };
  }
  if (e === "anular") {
    if ((f.reg || []).length) return { estado: "error", msg: "Parte de este cobro ya está en Holded: no se puede anular." };
    escribir(hoja, f.fila, { "Estado": "anulado", "Observación": "Anulado por administración el " + hoy }); f.estado = "anulado"; return { estado: "ok", cobro: adFila(f, null) };
  }
  return { estado: "error", msg: "Acción no válida" };
}
/* ---- carpeta física: pagos de Holded que Mango aún no anota en la copia en papel de la nota. No vencen: salen solo cuando los marca. ---- */
function carHoja() { return fcHoja("Carpeta", CAR_COLS); }
function carEstados(h) { var v = h.getDataRange().getValues(), o = {}; for (var i = 1; i < v.length; i++) if (v[i][0]) o[String(v[i][0])] = { fila: i + 1, e: String(v[i][1]) }; return o; }
function carpetaLista(notas, filas, tags, ctas, ahora) {
  var h = carHoja(), est = carEstados(h), props = PropertiesService.getScriptProperties();
  if (!props.getProperty("COB_CAR_INI")) {                                             // primera vez: lo de hace más de 14 días se da por anotado
    var rows = [], corte = ahora - 14 * 86400, hoy = fecha(new Date().toISOString());
    notas.forEach(function (n) { n.pg.forEach(function (p) { if (p[2] < corte && !est[p[0]]) { rows.push([p[0], "base", hoy, n.num, p[1], ahora]); est[p[0]] = { e: "base" }; } }); });
    if (rows.length) h.getRange(h.getLastRow() + 1, 1, rows.length, CAR_COLS.length).setValues(rows);
    props.setProperty("COB_CAR_INI", String(ahora));
  }
  var rec = {}; filas.forEach(function (f) { if (f.estado === "confirmado") (f.pagos || []).forEach(function (p) { rec[p[0]] = f; }); });
  var out = [];
  notas.forEach(function (n) {
    n.pg.forEach(function (p) {
      var e = est[p[0]]; if (e && (e.e === "anotado" || e.e === "base")) return;
      var f = rec[p[0]], c = ctas[p[3]] || ["", 0], tag = tags[n.c] || "";
      out.push({ p: p[0], n: n.id, nn: n.num, cn: n.cn, ven: carNombre(tag), m: p[1], f: p[2], cta: c[0], arch: c[1] ? 1 : 0,
        rec: f ? f.recibo : "", ad: f && f.org === "admin" ? 1 : 0, tb: f ? (f.tarifa === "BCV" ? "b" : "u") : "",
        rbv: f && f.tarifa === "BCV" && f.abono > 0 && f.bv > 0 ? Math.round(f.bv / f.abono * 10000) / 10000 : 0, pen: n.pen, d: n.d });
    });
  });
  return out.sort(function (a, b) { return a.f - b.f; });
}
function adCarpeta(b) {
  if (!ADMIN || String(b.k || "") !== ADMIN) return { estado: "no", msg: "No autorizado" };
  var e = String(b.e || ""), lista = Array.isArray(b.p) ? b.p.slice(0, 600) : [];
  if (["anotado", "pendiente"].indexOf(e) < 0 || !lista.length) return { estado: "error", msg: "Datos incompletos" };
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var h = carHoja(), est = carEstados(h), hoy = fecha(new Date().toISOString()), ts = Math.floor(Date.now() / 1000), nuevas = [];
    lista.forEach(function (x) {
      var id = String((x && x[0]) || "").replace(/[^a-f0-9]/g, ""); if (id.length !== 24) return;
      if (est[id]) { if (est[id].e !== e && est[id].e !== "base") h.getRange(est[id].fila, 2, 1, 2).setValues([[e, e === "anotado" ? hoy : ""]]); }
      else if (e === "anotado") { nuevas.push([id, e, hoy, fcTxt(x[1], 20), adRd(x[2]) || "", ts]); est[id] = { e: e }; }
    });
    if (nuevas.length) h.getRange(h.getLastRow() + 1, 1, nuevas.length, CAR_COLS.length).setValues(nuevas);
    return { estado: "ok", n: lista.length };
  } finally { lock.releaseLock(); }
}
/* ---- la vista completa de ADMIN › Cobros ---- */
function adVista(hoja, filas, notas, tags) {
  var ahora = Math.floor(Date.now() / 1000), porId = {}, ctas = cuentasHolded();
  notas.forEach(function (n) { porId[n.id] = n; });
  // 1) conciliación al momento, con la lista que ya se leyó (sin más llamadas a Holded): lo que administración registró a mano sale solo
  var ids = {}; filas.forEach(function (f) { if (f.estado === "cobrado" || f.estado === "revisar") ids[f.notaId] = 1; });
  Object.keys(ids).forEach(function (nid) { if (porId[nid]) conciliarNota(hoja, filas, nid, { paymentsPending: porId[nid].pen, paymentsDetail: porId[nid].pg.map(function (p) { return { id: p[0], amount: p[1], date: p[2], bankId: p[3] }; }) }, ahora); });
  // 2) cobros que piden atención: por registrar y con diferencia
  var cob = filas.filter(function (f) { return f.estado === "cobrado" || f.estado === "revisar" || (f.estado === "confirmado" && f.dif && !f.rva && f.ts >= ahora - 95 * 86400); })
    .map(function (f) { return adFila(f, porId[f.notaId]); });
  // 3) pagos de Holded en cuentas archivadas o desconocidas (90 días) que ningún cobro reclama
  var recl = {}; filas.forEach(function (f) { (f.pagos || []).forEach(function (p) { recl[p[0]] = 1; }); });
  var arch = [];
  notas.forEach(function (n) { n.pg.forEach(function (p) { var c = ctas[p[3]]; if (p[2] >= ahora - 90 * 86400 && (!c || c[1]) && !recl[p[0]]) arch.push({ p: p[0], n: n.id, nn: n.num, cn: n.cn, ven: carNombre(tags[n.c] || ""), m: p[1], f: p[2], cta: c ? c[0] : "cuenta desconocida" }); }); });
  // 4) retenciones (para el formulario del cobro de administración en notas facturadas)
  var ret = {}; try { var hr = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("COB_HOJA")).getSheetByName("Retenciones"); if (hr) fcFilas(hr, FC_RET).forEach(function (o) { ret[o.notaId] = Number(o["Retención %"]) || 0; }); } catch (e) {}
  // 5) notas pendientes de todos los vendedores (para registrar un cobro desde administración)
  var np = notas.filter(function (n) { return n.pen >= 0.01; }).map(function (n) {
    var tag = tags[n.c] || "", mis = filas.filter(function (f) { return f.notaId === n.id && f.estado !== "anulado"; });
    return { id: n.id, num: n.num, c: n.c, cn: n.cn, tag: tag, ven: carNombre(tag), f: n.f, v: n.v, tot: n.tot, pag: n.pag, pen: n.pen, d: n.d, fac: n.fac, ln: n.ln,
      pg: n.pg.map(function (p) { var c = ctas[p[3]] || ["", 0]; return [p[0], p[1], p[2], c[0], c[1] ? 1 : 0]; }),
      pc: mis.filter(function (f) { return f.estado === "cobrado" || f.estado === "revisar"; }).map(function (f) { return [f.uid, f.recibo, f.vendedor, f.nominal, f.bv || f.abono]; }),
      ivr: n.fac ? adRd(mis.reduce(function (s, f) { return s + (f.iv || 0); }, 0)) : 0, rt: ret[n.id] || 0 };
  });
  var tasas = []; try { tasas = tasasRecientes(); } catch (e2) {}
  return { estado: "ok", ahora: ahora, cob: cob, arch: arch, car: carpetaLista(notas, filas, tags, ctas, ahora), np: np, tasas: tasas.slice(-15), dbcv: descuentoBcv() };
}
