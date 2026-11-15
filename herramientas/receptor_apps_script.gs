// Receptor del "Catálogo NTX Vendedores" (portal de ventas NTX). Vive en la cuenta de Google de Mango (script.google.com).
// Implementar como aplicación web: "Ejecutar como: yo", "Acceso: cualquier persona".
// Hace tres cosas:
//  1) Recibe los pedidos de la página (?p=...) y los manda por correo con el asunto "PEDIDO NTX <id>" (Claude los pasa a Holded).
//  2) Portero de dispositivos (?a=entrar): el primer dispositivo de cada vendedor queda registrado; cualquier otro queda
//     esperando la aprobación de Mango, que recibe un correo con botones para aprobar o rechazar.
//     Sin aprobación el servidor no entrega la llave del vendedor, y sin esa llave el código solo no abre nada.
//  3) Panel de control (?a=admin&k=...): ver dispositivos, quitar uno, bloquear o desbloquear a un vendedor.
// Generado por Claude. Los valores de VENDEDORES y ADMIN son secretos: no compartas este archivo.

var VENDEDORES = __VENDEDORES__;   // tag -> {nombre, h: sha256 del código, s: llave del servidor}
var ADMIN = "__ADMIN__";
var AVISAR = "humboldtpartsca@gmail.com";
var MAX_INTENTOS = 8;              // códigos errados por dispositivo y hora

/* ---------- entrada ---------- */
function doGet(e) {
  var q = (e && e.parameter) || {};
  if (q.a === "entrar") return json(entrar(q));
  if (q.a === "revisar") return paginaRevisar(q.r || "");
  if (q.a === "admin") return paginaAdmin(q.k || "");
  return recibirPedido(q.p || "");
}

/* ---------- 1) pedidos (igual que antes) ---------- */
function recibirPedido(p) {
  if (!/^[A-Za-z0-9_-]{20,6000}$/.test(p)) return pagina("No llegó ningún pedido", "Vuelve al catálogo y envíalo de nuevo.");
  var datos, b64 = p;
  while (b64.length % 4) b64 += "=";
  try {
    datos = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString("UTF-8"));
  } catch (err) {
    return pagina("No se pudo leer el pedido", "Envíalo por WhatsApp desde el catálogo.");
  }
  var cache = CacheService.getScriptCache();            // si recargan la pestaña no se duplica el correo
  if (!cache.get(String(datos.id))) {
    MailApp.sendEmail(destinatarios(), "PEDIDO NTX " + datos.id,
      "#NTX1." + p + "\n\n" + (datos.x || ("Cliente: " + (datos.cn ? "CLIENTE NUEVO: " + datos.cn : datos.ci) +
      "\nPiezas: " + datos.l + "\nTarifa: " + datos.tf + " · Descuento: " + datos.d + "%" + (datos.n ? "\nNota: " + datos.n : ""))));
    cache.put(String(datos.id), "1", 21600);
  }
  return pagina("Pedido recibido", "Ya puedes cerrar esta pestaña y volver al catálogo.");
}

/* ---------- 2) portero ---------- */
function entrar(q) {
  var cod = String(q.cod || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  var disp = String(q.d || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
  var etiqueta = String(q.e || "").replace(/[<>&"]/g, "").slice(0, 120) || "Dispositivo sin nombre";
  if (!cod || disp.length < 12) return { estado: "error", msg: "Solicitud incompleta" };
  var cache = CacheService.getScriptCache(), ck = "int_" + disp, n = Number(cache.get(ck) || 0);
  if (n >= MAX_INTENTOS) return { estado: "espera", msg: "Demasiados intentos. Prueba de nuevo en una hora." };
  var h = sha(cod), tag = null;
  for (var t in VENDEDORES) if (VENDEDORES[t].h === h) tag = t;
  if (!tag) { cache.put(ck, String(n + 1), 3600); return { estado: "codigo" }; }
  var v = VENDEDORES[tag], ahora = new Date().toISOString();
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var st = estado(tag);
    if (st.bloq) return { estado: "bloqueado" };
    var d = buscar(st.disp, disp);
    if (!d && st.disp.length === 0 && !st.usado) {            // primer dispositivo: queda registrado solo
      st.disp.push({ id: disp, et: etiqueta, alta: ahora, visto: ahora, como: "primero" });
      st.usado = true; guardar(tag, st);
      aviso(v.nombre + " registró su primer dispositivo",
        v.nombre + " entró al portal de ventas NTX por primera vez.\n\nDispositivo: " + etiqueta + " (" + corto(disp) + ")\nFecha: " + fecha(ahora) +
        "\n\nDesde ahora, si entra desde otro dispositivo, te llegará un correo para aprobarlo.\n\nPanel de control: " + url("admin", "k=" + ADMIN));
      return ok(v, tag, disp);
    }
    if (d) { d.visto = ahora; if (etiqueta && d.et !== etiqueta) d.et = etiqueta; guardar(tag, st); return ok(v, tag, disp); }
    // dispositivo desconocido
    if ((st.rech || []).indexOf(disp) >= 0) return { estado: "rechazado" };
    var props = PropertiesService.getScriptProperties(), pk = "PEND_" + tag + "_" + disp, rid = props.getProperty(pk);
    if (!rid) {
      rid = Utilities.getUuid().replace(/-/g, "");
      props.setProperty(pk, rid);
      props.setProperty("REQ_" + rid, JSON.stringify({ tag: tag, d: disp, et: etiqueta, fecha: ahora }));
      aviso(v.nombre + " pide entrar desde otro dispositivo",
        v.nombre + " intentó entrar al portal de ventas NTX desde un dispositivo nuevo.\n\nDispositivo: " + etiqueta + " (" + corto(disp) + ")\nFecha: " + fecha(ahora) +
        "\nDispositivos ya aprobados: " + (st.disp.map(function (x) { return x.et + " (" + corto(x.id) + ")"; }).join(", ") || "ninguno") +
        "\n\nNo verá precios ni inventario hasta que lo apruebes. Aprobar o rechazar:\n" + url("revisar", "r=" + rid) +
        "\n\nSi no fue él, rechaza y considera bloquear su código desde el panel:\n" + url("admin", "k=" + ADMIN));
    }
    return { estado: "pendiente", nombre: v.nombre };
  } finally { lock.releaseLock(); }
}
function ok(v, tag, disp) { return { estado: "ok", s: v.s, nombre: v.nombre.replace(/\s*\(.*\)$/, ""), tag: tag, disp: corto(disp) }; }

/* ---------- decisiones (botones de las páginas) ---------- */
function decidir(rid, accion) {
  rid = String(rid || "").replace(/[^a-f0-9]/g, "");
  var props = PropertiesService.getScriptProperties(), raw = props.getProperty("REQ_" + rid);
  if (!raw) return "Esta solicitud ya fue atendida o no existe.";
  var r = JSON.parse(raw), lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var st = estado(r.tag), nom = VENDEDORES[r.tag] ? VENDEDORES[r.tag].nombre : r.tag, ahora = new Date().toISOString();
    if (accion === "rechazar") {
      st.rech = (st.rech || []).concat([r.d]).slice(-30);
    } else {
      if (accion === "reemplazar") st.disp = [];
      if (!buscar(st.disp, r.d)) st.disp.push({ id: r.d, et: r.et, alta: ahora, visto: "", como: "aprobado" });
      st.rech = (st.rech || []).filter(function (x) { return x !== r.d; });
    }
    guardar(r.tag, st);
    props.deleteProperty("REQ_" + rid); props.deleteProperty("PEND_" + r.tag + "_" + r.d);
    return accion === "rechazar" ? "Rechazado. " + nom + " no podrá entrar desde ese dispositivo." :
      accion === "reemplazar" ? "Aprobado. " + nom + " ahora entra solo desde ese dispositivo; los anteriores quedaron fuera." :
      "Aprobado. " + nom + " puede entrar también desde ese dispositivo.";
  } finally { lock.releaseLock(); }
}
function adminAccion(k, accion, tag, disp) {
  if (k !== ADMIN || !VENDEDORES[tag]) return "No autorizado.";
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var st = estado(tag), nom = VENDEDORES[tag].nombre;
    if (accion === "quitar") { st.disp = st.disp.filter(function (x) { return x.id !== disp; }); guardar(tag, st); return "Dispositivo quitado. Si " + nom + " vuelve a entrar desde él, te llegará una solicitud."; }
    if (accion === "bloquear") { st.bloq = true; guardar(tag, st); return nom + " quedó bloqueado: no puede entrar desde ningún dispositivo."; }
    if (accion === "desbloquear") { st.bloq = false; guardar(tag, st); return nom + " puede volver a entrar desde sus dispositivos aprobados."; }
    if (accion === "perdonar") { st.rech = (st.rech || []).filter(function (x) { return x !== disp; }); guardar(tag, st); return "Listo: ese dispositivo puede volver a pedir aprobación."; }
    return "Acción desconocida.";
  } finally { lock.releaseLock(); }
}

/* ---------- páginas ---------- */
function paginaRevisar(rid) {
  rid = String(rid).replace(/[^a-f0-9]/g, "");
  var raw = PropertiesService.getScriptProperties().getProperty("REQ_" + rid);
  if (!raw) return pagina("Solicitud atendida", "Esta solicitud ya fue aprobada o rechazada.");
  var r = JSON.parse(raw), st = estado(r.tag), nom = VENDEDORES[r.tag] ? VENDEDORES[r.tag].nombre : r.tag;
  var antes = st.disp.map(function (x) { return "<li>" + esc(x.et) + " <small>(" + corto(x.id) + ")</small></li>"; }).join("") || "<li>Ninguno</li>";
  return html('<h1>' + esc(nom) + ' pide entrar desde otro dispositivo</h1>' +
    '<p class="dato"><b>Dispositivo nuevo:</b> ' + esc(r.et) + ' <small>(' + corto(r.d) + ')</small><br><b>Pedido el:</b> ' + fecha(r.fecha) + '</p>' +
    '<p><b>Dispositivos aprobados hoy:</b></p><ul>' + antes + '</ul>' +
    '<div class="bot"><button class="si" onclick="go(\'reemplazar\')">Aprobar y quitar los anteriores</button>' +
    '<button class="mas" onclick="go(\'agregar\')">Aprobar como dispositivo adicional</button>' +
    '<button class="no" onclick="go(\'rechazar\')">Rechazar</button></div><p id="res"></p>' +
    '<script>function go(a){document.querySelectorAll("button").forEach(function(b){b.disabled=true});document.getElementById("res").textContent="Guardando…";' +
    'google.script.run.withSuccessHandler(function(m){document.querySelector(".bot").remove();document.getElementById("res").textContent=m}).decidir(' + JSON.stringify(rid) + ',a)}</script>');
}
function paginaAdmin(k) {
  if (k !== ADMIN) return pagina("No autorizado", "Este enlace no es válido.");
  var props = PropertiesService.getScriptProperties().getProperties(), out = '<h1>Portal de ventas NTX · dispositivos</h1>';
  for (var tag in VENDEDORES) {
    var st = estado(tag), v = VENDEDORES[tag];
    out += '<section><h2>' + esc(v.nombre) + (st.bloq ? ' <span class="tag">BLOQUEADO</span>' : '') + '</h2>';
    out += st.disp.length ? '<ul>' + st.disp.map(function (x) {
      return '<li>' + esc(x.et) + ' <small>(' + corto(x.id) + ') · alta ' + fecha(x.alta) + (x.visto ? ' · último uso ' + fecha(x.visto) : '') + '</small> ' +
        boton("Quitar", "quitar", tag, x.id) + '</li>'; }).join("") + '</ul>' : '<p><small>' + (st.usado ? 'Sin dispositivos aprobados.' : 'Aún no ha entrado.') + '</small></p>';
    var pend = Object.keys(props).filter(function (p) { return p.indexOf("PEND_" + tag + "_") === 0; });
    if (pend.length) out += '<p><b>Esperando tu aprobación:</b></p><ul>' + pend.map(function (p) {
      var rid = props[p], r = JSON.parse(props["REQ_" + rid] || "{}");
      return '<li>' + esc(r.et || "") + ' <small>(' + corto(r.d || "") + ') · ' + fecha(r.fecha) + '</small> <a href="' + url("revisar", "r=" + rid) + '" target="_top">Revisar</a></li>'; }).join("") + '</ul>';
    if ((st.rech || []).length) out += '<p><small>Rechazados: ' + st.rech.map(function (d) { return corto(d) + " " + boton("Permitir que vuelva a pedir", "perdonar", tag, d); }).join(" · ") + '</small></p>';
    out += st.bloq ? boton("Desbloquear a " + v.nombre, "desbloquear", tag, "") : boton("Bloquear a " + v.nombre, "bloquear", tag, "");
    out += '</section>';
  }
  out += '<p id="res"></p><script>function act(a,t,d){if(a==="bloquear"&&!confirm("¿Bloquear a este vendedor? No podrá entrar desde ningún dispositivo."))return;' +
    'document.getElementById("res").textContent="Guardando…";google.script.run.withSuccessHandler(function(m){alert(m);location.reload()}).adminAccion(' + JSON.stringify(ADMIN) + ',a,t,d)}</script>';
  return html(out);
}
function boton(txt, a, tag, d) { return '<button class="mini" onclick=\'act(' + JSON.stringify(a) + ',' + JSON.stringify(tag) + ',' + JSON.stringify(d) + ')\'>' + esc(txt) + '</button>'; }

/* ---------- utilidades ---------- */
function estado(tag) {
  var raw = PropertiesService.getScriptProperties().getProperty("EST_" + tag);
  var st = raw ? JSON.parse(raw) : {}; st.disp = st.disp || []; st.rech = st.rech || []; return st;
}
function guardar(tag, st) { PropertiesService.getScriptProperties().setProperty("EST_" + tag, JSON.stringify(st)); }
function buscar(lista, id) { for (var i = 0; i < lista.length; i++) if (lista[i].id === id) return lista[i]; return null; }
function sha(s) { var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8), o = ""; for (var i = 0; i < d.length; i++) o += ("0" + (d[i] & 255).toString(16)).slice(-2); return o; }
function corto(d) { return sha("ntx" + d).slice(0, 4).toUpperCase(); }
function fecha(iso) { return iso ? Utilities.formatDate(new Date(iso), "America/Caracas", "dd/MM/yyyy h:mm a") : ""; }
function url(a, extra) { return ScriptApp.getService().getUrl() + "?a=" + a + "&" + extra; }
function destinatarios() { var yo = Session.getEffectiveUser().getEmail(); return yo === AVISAR ? yo : yo + "," + AVISAR; }
function aviso(asunto, cuerpo) { MailApp.sendEmail(destinatarios(), "Portal NTX: " + asunto, cuerpo); }
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function pagina(titulo, texto) { return html('<h1>' + esc(titulo) + '</h1><p>' + esc(texto) + '</p>'); }
function html(cuerpo) {
  return HtmlService.createHtmlOutput('<meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
    'body{font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:28px 18px;color:#16161A;line-height:1.45}h1{font-size:22px}h2{font-size:18px;margin:0 0 6px}' +
    'section{border:1px solid #ddd;border-radius:12px;padding:14px;margin:14px 0}small{color:#666}.dato{background:#f5f5f6;border-radius:10px;padding:12px}' +
    '.bot{display:grid;gap:10px;margin:18px 0}button{font:600 16px system-ui;padding:14px;border-radius:10px;border:0;cursor:pointer}.si{background:#E3222C;color:#fff}' +
    '.mas{background:#16161A;color:#fff}.no{background:#eee}.mini{font-size:13px;padding:6px 10px;background:#eee;margin:4px 0}.tag{background:#E3222C;color:#fff;font-size:12px;padding:2px 8px;border-radius:6px}' +
    '#res{font-weight:600}</style>' + cuerpo).setTitle("Portal NTX").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}
