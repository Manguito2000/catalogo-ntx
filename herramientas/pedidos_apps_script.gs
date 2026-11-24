// Pedidos del portal de ventas NTX directo a Holded + bandeja de Mango + revisión de notas que salen de pedidos (nov 2026).
// Archivo aparte dentro del proyecto de Apps Script del receptor (junto a receptor y cobranzas). No contiene secretos.
// Usa del receptor: VENDEDORES, ADMIN, destinatarios(), correoPedido(), din(), esc(), html(), json(), pagina(), fecha(), sha().
// Usa de cobranzas: la propiedad HOLDED_KEY y la hoja de cálculo COB_HOJA.
//
// Instalación (una vez):
//  1) Pegar este archivo como "pedidos" en el proyecto.
//  2) En doGet del receptor, justo después de  var q = (e && e.parameter) || {};  añadir la línea:
//       if (typeof pdRuta === "function") { var r = pdRuta(q); if (r) return r; }
//  3) Ejecutar pdInstalar() desde el editor (pide permisos la primera vez) y publicar una nueva versión de la aplicación web.
//
// Qué hace:
//  - ?p=<pedido>: valida (cliente, cartera, tarifa, stock, conectores de 4 en 4) y crea el pedido o presupuesto en Holded en el acto.
//    Lo anota en la hoja "Pedidos", manda el correo a Mango con el resultado y le muestra al vendedor el número o el motivo.
//    Si Holded no responde, queda "en cola" y pdCiclo lo reintenta.
//  - pdCiclo (cada 10 min): reintenta la cola y revisa las notas que salieron de pedidos o presupuestos:
//      envío (si el pedido no se "envió", lo envía para que baje el stock), vencimiento (30 días; 3 si es de contado),
//      descuento (que la nota no tenga menos descuento que el pedido) y la nota del vendedor (que los códigos que pidió estén).
//  - ?a=bandeja&k=ADMIN: datos de la bandeja de Mango (pedidos y presupuestos abiertos, en cola, por revisar, hechos 7 días).
//  - ?a=bacc&k=ADMIN&...: acciones de la bandeja (ocultar / mostrar, marcar revisado).

var PD_FICHAS = {                 // sha256 de la ficha k de cada vendedor -> tag (la ficha viaja en cada pedido)
  "458b20a55ec125ffba3970ce1bb62a0d6b4e94b9c49abb1926335622d063e172": "elias",
  "86adfa89c4be4218e579c4a071ec31743ec59da3d9e9f927720329b8a36a5515": "gabriel",
  "a3e63689548907d267d597ff81a78e7108c3c1a1951dd278de6065d53bd7e675": "rm",
  "48c7e8edfbaa2ce4928186312b11144fcff1bd198df9fef2cfaf5efef7cbf09d": "natasha",
  "9e3e47b609989a4926558c836c6bcbaf2dc247393770f4ea00fb28cf09d3495b": "nersi",
  "62319bf991661524d9ac33a5fb466e240f646210b8713bda5398617845f369c5": "randy", "95c14b7315e9da132bb239421c0f3399b5f61c13a3fe8d5388e4484dd77d0dff": "julian"
};
var PD = {
  nuevo: "6af59ce1fe2e564cd90b25b4",       // contacto CLIENTE NUEVO
  bcv: "6a230ac4aac0c5474e02901d",         // tarifa BCV
  credito: 30, contado: 3,                 // días de vencimiento de la nota (regla de Mango)
  hechosDias: 7, presVence: 15,            // bandeja: hechos visibles 7 días; presupuestos vencidos a los 15
  revisarDias: 3,                          // solo se corrigen notas de los últimos 3 días...
  piso: 1794783600, pisoHasta: 1796097600, // ...salvo la primera vez: hasta el 1 dic 2026 se revisan también las notas desde el 16 nov (NE4248, NE4254, NE4258…)
  enviarSolo: true, corregirVencimiento: true
};
var PD_COLS = ["Recibido", "Vendedor", "Cliente", "Tipo", "Tarifa", "Desc %", "Contado", "Líneas", "Nota", "Estado", "Documento", "Total", "Observación",
  "ts", "tag", "pid", "docId", "clienteId", "intentos", "ref"];
var PD_REV = ["Fecha", "Nota", "Origen", "Cliente", "Vendedor", "Total", "Envío", "Vencimiento", "Descuento", "Nota del vendedor", "Avisos", "Revisado",
  "ts", "notaId", "origenId", "tipo", "visto", "det", "chk", "primera"];

/* ---------- entrada ---------- */
function pdRuta(q) {
  if (q.a === "bandeja") return json(pdSeguro(function () { return pdBandeja(q); }));
  if (q.a === "bacc") return json(pdSeguro(function () { return pdAccion(q); }));
  if (!q.a && q.p) return pdRecibir(String(q.p));
  return null;
}
function pdSeguro(f) { try { return f(); } catch (e) { return { estado: "error", msg: String(e.message || e) }; } }

/* ---------- 1) pedido que llega del portal ---------- */
function pdRecibir(p) {
  if (!/^[A-Za-z0-9_-]{20,6000}$/.test(p)) return pagina("No llegó ningún pedido", "Vuelve al catálogo y envíalo de nuevo.");
  var d = pdDecodificar(p);
  if (!d || !d.id) return pagina("No se pudo leer el pedido", "Envíalo por WhatsApp desde el catálogo.");
  var lock = LockService.getScriptLock(), r, nuevo = false;
  if (!lock.tryLock(30000)) {                                                          // muy ocupado: queda en cola y lo pasa pdCiclo
    r = { estado: "cola", obs: "Recibido con el sistema ocupado; se pasa solo en unos minutos." };
    pdHoja("Pedidos", PD_COLS).appendRow(pdFila(PD_COLS, pdFilaPedido(d, r, p)));
    return pdPagina(d, r);
  }
  try {
    var h = pdHoja("Pedidos", PD_COLS), prev = pdFilas(h, PD_COLS).filter(function (x) { return String(x.pid) === String(d.id); })[0];
    if (prev) r = { estado: String(prev.Estado), doc: String(prev.Documento), total: Number(prev.Total) || 0, obs: String(prev["Observación"]) };
    else {
      r = pdProcesar(d); nuevo = true;
      h.appendRow(pdFila(PD_COLS, pdFilaPedido(d, r, p)));
    }
  } finally { lock.releaseLock(); }
  if (nuevo) { try { pdCorreo(d, p, r); } catch (e) {} }
  return pdPagina(d, r);
}
function pdDecodificar(p) {
  var b = p; while (b.length % 4) b += "=";
  try { return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(b)).getDataAsString("UTF-8")); } catch (e) { return null; }
}
function pdTag(k) { return k ? (PD_FICHAS[sha(String(k))] || "") : ""; }
function pdNombre(tag) { return tag === "rm" ? "Mango" : ((VENDEDORES[tag] || {}).nombre || tag || "").replace(/\s*\(.*\)$/, ""); }

// Pedido decodificado -> objeto de trabajo
function pdOrden(d) {
  var pr = String(d.pr || "").split(",");
  return {
    id: String(d.id), t: d.t, ci: String(d.ci || ""), cn: String(d.cn || "").trim(), nm: String(d.nm || ""),
    tipo: d.tp === "q" ? "presupuesto" : "pedido", tarifa: String(d.tf || ""), desc: d.d == null ? 0 : Number(d.d), contado: d.c == 1, nota: String(d.n || "").trim(),
    lineas: String(d.l || "").split(",").filter(String).map(function (x, i) {
      var j = x.lastIndexOf("*");
      return { c: (j > 0 ? x.slice(0, j) : x).trim(), q: j > 0 ? Number(x.slice(j + 1)) : NaN, p: pr[i] === "" || pr[i] == null ? null : Number(pr[i]) };
    })
  };
}

// Valida y crea el documento. Devuelve {estado: holded|revisar|cola, doc, docId, total, obs, tag, vend, cliente}
function pdProcesar(d) {
  var o = pdOrden(d), tag = pdTag(d.k), vend = tag ? pdNombre(tag) : "", base = { tag: tag, vend: vend, cliente: o.cn ? "CLIENTE NUEVO: " + o.cn : o.nm };
  var out = function (x) { for (var k in base) if (!(k in x)) x[k] = base[k]; return x; };
  if (!tag) return out({ estado: "revisar", obs: "Vendedor no reconocido (ficha desconocida)" });
  var idx, cont;
  try {
    idx = pdProductos();
    if (!/^[a-f0-9]{24}$/.test(o.ci)) return out({ estado: "revisar", obs: "Falta el cliente" });
    var rc = pdHttp("get", "contacts/" + o.ci);
    if (rc.codigo === 404 || (rc.codigo === 200 && !rc.datos)) return out({ estado: "revisar", obs: "El cliente no existe en Holded" });
    if (rc.codigo !== 200) throw pdTemporal(rc);
    cont = rc.datos;
    if (!base.cliente) base.cliente = cont.name || ("Cliente " + o.ci.slice(-6));
    var v = pdValidar(o, idx, cont, tag, vend, Math.floor(Date.now() / 1000));
    if (!v.ok) return out({ estado: "revisar", obs: v.obs });
    var tipo = o.tipo === "presupuesto" ? "estimate" : "salesorder";
    var rp = pdHttp("post", "documents/" + tipo, v.body);
    if (rp.codigo !== 200 && rp.codigo !== 201) throw pdTemporal(rp);
    var id = rp.datos && rp.datos.id;
    if (!id) return out({ estado: "revisar", obs: "Holded no devolvió el documento: " + JSON.stringify(rp.datos).slice(0, 200) });
    var chk = pdComprobar(tipo, id, v);
    return out({ estado: "holded", doc: chk.num, docId: id, total: chk.total, obs: ["Stock confirmado. Total " + din(chk.total) + "."].concat(v.avisos, chk.avisos).join(" ") });
  } catch (e) {
    if (e && e.temporal) return out({ estado: "cola", obs: "Holded no respondió (" + e.codigo + "); se reintenta solo." });
    return out({ estado: "revisar", obs: "Error: " + String(e.message || e).slice(0, 200) });
  }
}

// Reglas de la tarea "Procesar pedidos NTX" (nov 2026). Pura: no llama a nada.
function pdValidar(o, idx, cont, tag, vend, ahora) {
  var err = [], avisos = [];
  if (!cont || cont.type !== "client") err.push("El contacto no es un cliente");
  var nuevo = o.ci === PD.nuevo;
  if (nuevo && !o.cn) err.push("Cliente nuevo sin nombre");
  if (o.cn && !nuevo) err.push("Cliente nuevo mal marcado");
  if (tag && tag !== "rm" && !nuevo && cont && ((cont.tags || [])[0] || "") !== tag) err.push("El cliente no es de la cartera del vendedor");
  if (o.tarifa !== "usd" && o.tarifa !== "bcv") err.push("Tarifa no válida (" + o.tarifa + ")");
  var desc = Number(o.desc); if (isNaN(desc) || desc < 0 || desc > 15) err.push("Descuento fuera de 0 a 15 %");
  if (!o.lineas.length) err.push("Pedido sin líneas");
  var items = [], esperado = 0;
  o.lineas.forEach(function (l) {
    var p = idx[l.c];
    if (!p) { err.push(l.c + ": no existe en Holded"); return; }
    var precio = o.tarifa === "bcv" ? p.bcv : p.usd;
    if (!(precio > 0)) { err.push(l.c + ": sin precio en la tarifa " + o.tarifa.toUpperCase()); return; }
    if (!(l.q >= 1 && l.q <= 999 && Math.floor(l.q) === l.q)) { err.push(l.c + ": cantidad no válida"); return; }
    if (p.con && l.q % 4) { err.push(l.c + ": los conectores van de 4 en 4"); return; }
    if (p.con && p.stock <= 8) { err.push(l.c + ": quedan " + p.stock + ", no alcanza para vender"); return; }
    if (l.q > p.stock) { err.push(l.c + ": pides " + l.q + " y hay " + Math.max(0, p.stock)); return; }
    if (l.p != null && Math.abs(l.p - precio) > 0.01) avisos.push(l.c + ": el vendedor vio " + din(l.p) + " y Holded tiene " + din(precio) + ".");
    items.push({ name: l.c, sku: l.c, desc: p.desc || "", units: l.q, subtotal: precio, discount: desc, tax: 0 });
    esperado += Math.round(l.q * precio * (100 - desc)) / 100;
  });
  if (err.length) return { ok: false, obs: err.join("; ") };
  var partes = ["Pedido desde Pedidos NTX", "Vendedor: " + (vend || tag)];
  if (o.tarifa === "bcv") partes.push("TARIFA BCV");
  if (desc > 0 && !/cr[eé]dito/i.test(o.nota)) o.contado = true; if (o.contado) partes.push("Pago de contado " + desc + "%"); else if (desc > 0) partes.push("Descuento " + desc + "%");
  if (nuevo) partes.push("CLIENTE NUEVO: " + o.cn + " (falta crear su ficha: RIF y teléfono llegan por WhatsApp)");
  if (o.nota) partes.push("Nota: " + o.nota);
  partes.push("Ref " + o.id);
  var body = { contactId: o.ci, date: ahora, notes: partes.join(" · "), items: items };
  if (!o.contado) body.dueDate = ahora + PD.credito * 86400;
  var dv = "";
  if (nuevo) dv = "CLIENTE NUEVO: " + o.cn + (o.nota ? " · 📝 " + o.nota : "");
  else if (o.nota) dv = "📝 NOTA DE " + String(vend || tag).toUpperCase() + ": " + o.nota;
  if (dv) body.desc = dv.length > 250 ? dv.slice(0, 249) + "…" : dv;
  return { ok: true, body: body, esperado: Math.round(esperado * 100) / 100, avisos: avisos };
}

// Relee el documento creado y arregla vencimiento o descripción si Holded no los guardó
function pdComprobar(tipo, id, v) {
  var avisos = [], doc = pdGet("documents/" + tipo + "/" + id);
  if (v.body.desc && String(doc.desc || "") !== v.body.desc) { pdHttp("put", "documents/" + tipo + "/" + id, { desc: v.body.desc }); doc = pdGet("documents/" + tipo + "/" + id); }
  if (v.body.dueDate && Math.abs((Number(doc.dueDate) || 0) - (Number(doc.date) + PD.credito * 86400)) > 3600) {
    pdHttp("put", "documents/" + tipo + "/" + id, { date: Number(doc.date), dueDate: Number(doc.date) + PD.credito * 86400 });
    doc = pdGet("documents/" + tipo + "/" + id);
    if (Math.abs((Number(doc.dueDate) || 0) - (Number(doc.date) + PD.credito * 86400)) > 3600) avisos.push("No quedó el vencimiento a 30 días.");
  }
  var total = Math.round((Number(doc.total) || 0) * 100) / 100;
  if (Math.abs(total - v.esperado) > 0.05) avisos.push("Total en Holded " + din(total) + ", calculado " + din(v.esperado) + ".");
  return { num: doc.docNumber || "", total: total, avisos: avisos };
}

function pdFilaPedido(d, r, p) {
  var o = pdOrden(d);
  return { "Recibido": fecha(new Date().toISOString()), "Vendedor": r.vend || "?", "Cliente": r.cliente || o.cn || o.nm, "Tipo": o.tipo, "Tarifa": o.tarifa.toUpperCase(),
    "Desc %": o.desc || 0, "Contado": o.contado ? "sí" : "", "Líneas": o.lineas.map(function (l) { return l.q + " " + l.c; }).join(", "), "Nota": o.nota,
    "Estado": r.estado, "Documento": r.doc || "", "Total": r.total || "", "Observación": r.obs || "", "ts": Math.floor(Date.now() / 1000), "tag": r.tag || "",
    "pid": o.id, "docId": r.docId || "", "clienteId": o.ci, "intentos": 1, "ref": p };
}

function pdCorreo(d, p, r) {
  var c = correoPedido(d, p), o = pdOrden(d), tipo = o.tipo === "presupuesto" ? "Presupuesto" : "Pedido";
  var cab = r.estado === "holded" ? tipo + " " + r.doc + " creado en Holded · " + din(r.total)
    : r.estado === "cola" ? tipo + " en cola: Holded no respondió, se pasa solo en unos minutos"
    : "REVISAR: no se creó en Holded. " + r.obs;
  var asunto = "NTX · " + (r.estado === "holded" ? tipo + " " + r.doc : r.estado === "cola" ? tipo + " en cola" : "REVISAR " + tipo.toLowerCase()) +
    " · " + (r.cliente || o.cn || o.nm) + " · " + (r.vend || "?");          // no empieza con "PEDIDO NTX": la tarea vieja no lo toma
  var color = r.estado === "holded" ? "#1E7B34" : r.estado === "cola" ? "#8A6100" : "#B3261E";
  var obs = r.estado === "holded" && r.obs && r.obs.indexOf("Stock confirmado.") === 0 ? r.obs.replace(/^Stock confirmado\. Total [^ ]+\.\s*/, "") : "";
  MailApp.sendEmail({ to: destinatarios(), subject: asunto, name: "Portal de ventas NTX",
    body: cab + (obs ? "\n" + obs : "") + "\n\n" + c.texto,
    htmlBody: '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto 10px;background:' + color + ';color:#fff;border-radius:10px;padding:10px 14px;font-weight:700">' +
      esc(cab) + (obs ? '<div style="font-weight:400;font-size:13px;margin-top:4px">' + esc(obs) + '</div>' : '') + '</div>' + c.html });
}

function pdPagina(d, r) {
  var o = pdOrden(d), tipo = o.tipo === "presupuesto" ? "presupuesto" : "pedido";
  if (r.estado === "holded") return html('<h1>✅ ' + (tipo === "pedido" ? "Pedido recibido" : "Presupuesto recibido") + '</h1><div class="dato"><b>' + esc(r.doc) + '</b> · ' +
    esc(r.cliente || "") + '<br>Total ' + din(r.total) + '</div><p>Ya está en el sistema. Puedes cerrar esta pestaña y volver al catálogo.</p>');
  if (r.estado === "cola") return html('<h1>✅ Pedido recibido</h1><p>El sistema lo pasa en unos minutos. Puedes cerrar esta pestaña.</p>');
  return html('<h1>⚠️ Pedido recibido, con un detalle</h1><div class="dato">' + esc(r.obs) + '</div><p>Administración ya lo ve. Si quieres, corrígelo en el catálogo y envíalo de nuevo.</p>');
}

/* ---------- 2) ciclo cada 10 minutos: cola + revisión de notas ---------- */
function pdCiclo() {
  var res = [], lock = LockService.getScriptLock();
  if (lock.tryLock(20000)) {
    try { res.push(pdReintentar()); } catch (e) { res.push("cola: " + e.message); } finally { lock.releaseLock(); }
  }
  try { res.push(pdRevisarNotas(false)); } catch (e2) { res.push("notas: " + e2.message); }
  return res.join(" · ");
}
function pdReintentar() {
  var h = pdHoja("Pedidos", PD_COLS), n = 0, ahora = Math.floor(Date.now() / 1000);
  var cola = pdFilas(h, PD_COLS).filter(function (x) { return String(x.Estado) === "cola" && ahora - Number(x.ts) < 3 * 86400; });
  if (!cola.length) return "cola vacía";
  var recientes = [];                                                                  // por si Holded sí lo creó aunque no respondió a tiempo
  ["salesorder", "estimate"].forEach(function (t) { recientes = recientes.concat(pdGet("documents/" + t + "?starttmp=" + (ahora - 4 * 86400) + "&endtmp=" + (ahora + 86400))); });
  cola.forEach(function (x) {
    var d = pdDecodificar(String(x.ref)); if (!d) return;
    var ya = recientes.filter(function (y) { return String(y.notes || "").indexOf("Ref " + d.id) >= 0; })[0];
    var r = ya ? { estado: "holded", doc: ya.docNumber, docId: ya.id, total: Math.round(Number(ya.total) * 100) / 100, obs: "Creado en Holded (confirmado al reintentar).", tag: pdTag(d.k), vend: pdNombre(pdTag(d.k)), cliente: ya.contactName }
      : pdProcesar(d), fi = pdFilaPedido(d, r, String(x.ref));
    pdPon(h, PD_COLS, x.fila, { "Estado": r.estado, "Documento": fi["Documento"], "Total": fi["Total"], "Observación": fi["Observación"], "docId": fi["docId"],
      "Cliente": fi["Cliente"], "Vendedor": fi["Vendedor"], "tag": fi["tag"], "intentos": (Number(x.intentos) || 1) + 1 });
    if (r.estado !== "cola") { n++; try { pdCorreo(d, String(x.ref), r); } catch (e) {} }
  });
  return n + " de la cola";
}

// Revisa las notas (facturas NE) que salieron de un pedido o presupuesto en los últimos días
function pdRevisarNotas(seco) {
  var ahora = Math.floor(Date.now() / 1000), desde = ahora - (PD.revisarDias + 1) * 86400;
  if (ahora < PD.pisoHasta) desde = Math.min(desde, PD.piso);
  var notas = pdGet("documents/invoice?starttmp=" + desde + "&endtmp=" + (ahora + 86400) + "&sort=created-desc");
  var h = pdHoja("Revisión notas", PD_REV), filas = pdFilas(h, PD_REV), porId = {};
  filas.forEach(function (f) { porId[String(f.notaId)] = f; });
  var hermanas = null, skus = pdSkus(), hechas = 0, log = [], mapa = null, alertas = [];
  if (notas.some(function (n) { return !(n.from || {}).id && (n.tags || []).some(function (t) { return /^(so|e)\d{6}$/.test(t); }); })) mapa = pdMapaNumeros(ahora);
  notas.forEach(function (n) {
    var org = pdOrigenDe(n, mapa); if (!org) return;
    var f = porId[n.id];
    if (f && (String(f.visto) || pdTodoOk(f)) ) return;                                // ya está bien o Mango lo marcó revisado
    if (f && ahora - Number(f.chk || 0) < 1800 && !seco) return;                        // como mucho cada 30 min por nota
    if (!hermanas) hermanas = pdGet("documents/invoice?starttmp=" + (ahora - 75 * 86400) + "&endtmp=" + (ahora + 86400));
    var origen = pdGet("documents/" + org.tipo + "/" + org.id);
    var env = org.tipo === "salesorder" && !org.porEtiqueta ? pdGet("documents/salesorder/" + org.id + "/shippeditems") : null;
    var ev = pdEvaluar(n, origen, org, desde, hermanas.filter(function (x) { var o2 = pdOrigenDe(x, mapa); return o2 && o2.id === org.id; }), env, skus, ahora);
    var acc = [];
    if (!seco && PD.enviarSolo && ev.enviar.length) {
      var rs = pdHttp("post", "documents/salesorder/" + org.id + "/shipbylines", { lines: ev.enviar.map(function (x) { return { itemLinePosition: x.itemLinePosition, units: x.units }; }) });
      if (rs.codigo === 200) { ev.envio = "enviado solo: " + ev.enviar.map(function (x) { return x.units + " " + x.sku; }).join(", "); acc.push(ev.envio); }
      else ev.envio = "no se pudo enviar (" + rs.codigo + "): falta enviarlo en Holded";
    }
    if (!seco && PD.corregirVencimiento && ev.venc.fix) {
      // Ojo: un PUT de Holded pone en 0 el descuento global si no se manda (pasó en NE4244): se manda todo lo que tiene la nota y se relee.
      var antes = { t: Number(n.total), d: Number(n.discount) || 0, desc: String(n.desc || ""), tags: n.tags || [] };
      var put = { date: Number(n.date), dueDate: ev.venc.fix, discount: antes.d, tags: antes.tags };
      if (antes.desc) put.desc = antes.desc;
      pdHttp("put", "documents/invoice/" + n.id, put);
      var nn = pdGet("documents/invoice/" + n.id), malo = [];
      if (Math.abs((Number(nn.discount) || 0) - antes.d) > 0.001) { pdHttp("put", "documents/invoice/" + n.id, { discount: antes.d, tags: antes.tags }); nn = pdGet("documents/invoice/" + n.id); }
      if (Math.abs(Number(nn.total) - antes.t) >= 0.01) malo.push("el total pasó de " + din(antes.t) + " a " + din(nn.total));
      if (String(nn.desc || "") !== antes.desc) malo.push("cambió la descripción");
      if ((nn.tags || []).join() !== antes.tags.join()) malo.push("cambiaron las etiquetas");
      if (Math.abs(Number(nn.dueDate) - ev.venc.fix) >= 3600) malo.push("no tomó el vencimiento");
      if (!malo.length) { ev.venc.txt = "corregido a " + ev.venc.dias + " días"; acc.push(n.docNumber + " vence a " + ev.venc.dias + " días"); }
      else { ev.venc.txt = "revisar en Holded: " + malo.join(", "); ev.avisos.push("Al corregir el vencimiento " + malo.join(", ")); }
    }
    var vals = { "Fecha": pdDia(n.date), "Nota": n.docNumber, "Origen": origen.docNumber, "Cliente": n.contactName,
      "Vendedor": pdVendDoc(origen, null) || pdVendDoc(n, null), "Total": Math.round(Number(n.total) * 100) / 100, "Envío": ev.envio, "Vencimiento": ev.venc.txt,
      "Descuento": ev.desc.txt, "Nota del vendedor": ev.notaV.txt, "Avisos": ev.avisos.join(" · "), "ts": Number(n.date), "notaId": n.id, "origenId": org.id,
      "tipo": org.tipo, "det": JSON.stringify(ev.det), "chk": ahora, "primera": f ? Number(f.primera) || ahora : ahora };
    if (seco) { log.push(vals); return; }
    var stock = ev.avisos.filter(function (a) { return a.indexOf("STOCK:") === 0; }).concat(/^no se pudo enviar/.test(ev.envio) ? [ev.envio] : []);
    if (stock.length && (!f || String(f.Avisos).indexOf("STOCK:") < 0)) alertas.push(n.docNumber + " (" + n.contactName + ", de " + origen.docNumber + "): " + stock.join(" · ").replace(/STOCK: /g, ""));
    if (f) pdPon(h, PD_REV, f.fila, vals); else h.appendRow(pdFila(PD_REV, vals));
    if (acc.length) hechas++;
  });
  if (alertas.length && !seco) MailApp.sendEmail(destinatarios(), "Portal NTX: stock por corregir (" + alertas.length + ")",
    "Estas notas dejaron el stock de Holded distinto de lo entregado:\n\n" + alertas.join("\n\n") +
    "\n\nPídele a Claude que lo regularice (o hazlo en Holded › producto › Actualizar stock). Para que no pase: si el cliente pide algo más, agrégalo al pedido antes de convertirlo en nota.");
  return seco ? log : hechas + " notas corregidas";
}
function pdTodoOk(f) { return /^(ok|n\/a|enviado|corregido)/.test(String(f["Envío"])) && /^(ok|corregido|pagada)/.test(String(f["Vencimiento"])) &&
  /^ok/.test(String(f["Descuento"])) && /^(ok|n\/a)/.test(String(f["Nota del vendedor"])) && !String(f.Avisos); }

// Origen de una nota: el enlace de Holded (conversión en pantalla) o una etiqueta so260025 / e260009 (notas creadas por API)
function pdOrigenDe(n, mapa) {
  var f = n.from || {};
  if (f.id && (f.docType === "salesorder" || f.docType === "estimate")) return { tipo: f.docType, id: f.id, porEtiqueta: false };
  var t = (n.tags || []).filter(function (x) { return /^(so|e)\d{6}$/.test(x); })[0];
  if (t && mapa && mapa[t]) return { tipo: mapa[t].tipo, id: mapa[t].id, porEtiqueta: true };
  return null;
}
function pdMapaNumeros(ahora) {                                                        // "so260025" -> {tipo, id}
  var m = {};
  [["salesorder", "salesorder"], ["estimate", "estimate"]].forEach(function (t) {
    pdGet("documents/" + t[0] + "?starttmp=" + (ahora - 200 * 86400) + "&endtmp=" + (ahora + 86400)).forEach(function (x) { m[String(x.docNumber || "").toLowerCase()] = { tipo: t[1], id: x.id }; });
  });
  return m;
}
function pdDia(ts) { return Utilities.formatDate(new Date((Number(ts) + 7200) * 1000), "UTC", "dd/MM/yyyy"); }   // fechas de Holded: medianoche de España

// Evalúa una nota contra su pedido o presupuesto. Pura (no llama a Holded).
function pdEvaluar(n, origen, org, desde, hermanas, env, skus, ahora) {
  var det = {}, avisos = [];
  var linO = (origen.products || []), linN = (n.products || []);
  var uN = {}, uH = {};
  linN.forEach(function (p) { var k = pdSku(p); uN[k] = (uN[k] || 0) + (Number(p.units) || 0); });
  (hermanas.length ? hermanas : [n]).forEach(function (x) { (x.products || []).forEach(function (p) { var k = pdSku(p); uH[k] = (uH[k] || 0) + (Number(p.units) || 0); }); });
  var enO = {}; linO.forEach(function (p) { enO[pdSku(p)] = 1; });

  // a) envío: lo facturado de cada línea del pedido debe estar "enviado" (si no, el stock no baja)
  var enviar = [], faltan = [], envio = "n/a";
  if (org.tipo === "salesorder" && !org.porEtiqueta && env) {
    var resto = {}; for (var k in uH) resto[k] = uH[k];
    linO.forEach(function (p, i) {
      var s = pdSku(p), tot = Number(p.units) || 0, e = env[i] && pdSku(env[i]) === s ? env[i] : env.filter(function (x) { return pdSku(x) === s; })[0] || { sent: 0 };
      var fact = Math.min(tot, resto[s] || 0); resto[s] = (resto[s] || 0) - fact;
      var falta = fact - (Number(e.sent) || 0);
      if (falta > 0) enviar.push({ itemLinePosition: i, units: falta, sku: s });
      if (falta < 0) avisos.push("STOCK: se envió más de lo facturado: " + s + " (" + (Number(e.sent) || 0) + " enviados, " + fact + " en notas)");
      if (fact < tot) faltan.push([s, tot - fact]);
    });
    envio = enviar.length ? "falta enviar" : "ok";
  }
  var extras = []; for (var s2 in uN) if (!enO[s2]) extras.push([s2, uN[s2]]);
  // Comprobado en el historial de stock (nov 2026): en una nota que sale de un pedido, solo baja del stock lo que el pedido "envía" (albarán W…).
  // Lo que se agrega a la nota y no estaba en el pedido NO baja (NE4262: A612, MT1; NE4256: C251A, C128A). Las notas que salen de presupuestos sí bajan solas.
  if (extras.length && org.tipo === "salesorder" && !org.porEtiqueta) avisos.push("STOCK: no bajaron " + extras.map(function (x) { return x[1] + " " + x[0]; }).join(", ") + " (se agregaron a la nota y no estaban en el pedido)");
  if (faltan.length) avisos.push("Quedó sin facturar: " + faltan.map(function (x) { return x[1] + " " + x[0]; }).join(", "));

  // b) vencimiento: 30 días; 3 si el pedido era de contado
  var notes = String(origen.notes || ""), portal = /Pedido desde Pedidos NTX/.test(notes);
  var dO = (linO.map(function (p) { return Number(p.discount) || 0; }));
  var hayDesc = (Number(origen.discount) || 0) > 0 || dO.some(function (x) { return x > 0; }); var contado = /Pago de contado/i.test(notes) || (hayDesc && !/cr[eé]dito/i.test(notes + " " + String(origen.desc || "")));
  if (!hayDesc && origen.dueDate && Number(origen.dueDate) - Number(origen.date) >= 20 * 86400 && org.tipo === "salesorder") contado = false;
  var dias = contado ? PD.contado : PD.credito, actual = Math.round(((Number(n.dueDate) || Number(n.date)) - Number(n.date)) / 86400);
  var pagada = (Number(n.paymentsPending) || 0) <= 0.01;
  var venc = { dias: dias, actual: actual, fix: null, txt: "ok (" + actual + " días)" };
  if (actual < dias) {
    if (pagada) venc.txt = "pagada (" + actual + " días)";
    else if (Number(n.date) >= desde) { venc.fix = Number(n.date) + dias * 86400; venc.txt = "corregir: " + actual + " → " + dias + " días"; }
    else venc.txt = "vence a " + actual + " días; debía ser " + dias;
  }

  // c) descuento: la nota no puede quedar con menos descuento que el pedido en las mismas piezas
  var gO = Number(origen.discount) || 0, gN = Number(n.discount) || 0, menos = [];
  var dN = {}; linN.forEach(function (p) { dN[pdSku(p)] = Number(p.discount) || 0; });
  linO.forEach(function (p) {
    var s = pdSku(p); if (!(s in dN)) return;
    var fO = (1 - (Number(p.discount) || 0) / 100) * (1 - gO / 100), fN = (1 - dN[s] / 100) * (1 - gN / 100);
    if (fN > fO + 0.0005) menos.push(s + " " + Math.round((1 - fO) * 1000) / 10 + "% → " + Math.round((1 - fN) * 1000) / 10 + "%");
  });
  var desc = { txt: menos.length ? "falta: " + menos.slice(0, 4).join(", ") + (menos.length > 4 ? " y " + (menos.length - 4) + " más" : "") : "ok" };

  // d) nota del vendedor: los códigos que escribió deben estar en la nota
  var texto = pdNotaVendedor(origen), notaV = { txt: "n/a" };
  if (texto) {
    var pide = pdCodigosEnTexto(texto, skus), falta2 = [];
    pide.forEach(function (x) { if (!uN[x.c] || (x.q && uN[x.c] < x.q)) falta2.push((x.q ? x.q + " " : "") + x.c); });
    notaV.txt = !pide.length ? "leer: «" + texto + "»" : falta2.length ? "falta: " + falta2.join(", ") + " · «" + texto + "»" : "ok: «" + texto + "»";
  }
  if (origen.contact === PD.nuevo && n.contact === PD.nuevo) avisos.push("Cliente nuevo: falta crear la ficha y cambiarlo en la nota");

  det = { enviar: enviar, faltan: faltan, extras: extras, dias: dias, actual: actual, contado: contado };
  return { enviar: enviar, envio: envio, venc: venc, desc: desc, notaV: notaV, avisos: avisos, det: det };
}
function pdSku(p) { return String(p.sku || p.name || "").trim().toUpperCase(); }
function pdNotaVendedor(doc) {
  var m = String(doc.notes || "").match(/·\s*Nota:\s*([\s\S]*?)(?:\s*·\s*Ref\s+\S+)?\s*$/);
  if (m && m[1].trim()) return m[1].trim();
  var d = String(doc.desc || ""), m2 = d.match(/📝\s*(?:NOTA DE [^:]*:\s*)?([\s\S]+)$/);
  return m2 ? m2[1].trim() : "";
}
// "10 C251A", "C251A x10", "C251A*10", "agregar MT1" -> [{c, q}]
function pdCodigosEnTexto(t, skus) {
  var out = [], vistos = {}, T = String(t).toUpperCase();
  var re = /(?:(\d{1,3})\s*(?:X|\*|UDS?\.?|UNIDADES|PZAS?|PIEZAS)?\s*)?\b([A-Z]{1,4}\d[A-Z0-9\-]*)\b(?:\s*(?:X|\*)\s*(\d{1,3}))?/g, m;
  while ((m = re.exec(T))) {
    var c = m[2]; if (!skus[c] || vistos[c]) continue;
    vistos[c] = 1; out.push({ c: c, q: Number(m[1] || m[3]) || 0 });
  }
  return out;
}
// Vendedor de un documento: etiqueta -> hoja Pedidos -> texto "Vendedor: X" de las notas (pedidos creados por la tarea vieja o sin enlace). Vacío = Mango.
function pdVendDoc(doc, pt) {
  var v = pdVendDe(doc.tags) || (pt ? String(pt.Vendedor || "") : "");
  if (v && v !== "?") return v;
  var m = String(doc.notes || "").match(/Vendedor:\s*([^·]+?)\s*(?:·|$)/);
  return m ? m[1].trim() : "";
}
// Nombre del cliente nuevo (el contacto de Holded se llama CLIENTE NUEVO; el nombre real viaja en las notas y en la descripción)
function pdNombreNuevo(doc) {
  if (doc.contact !== PD.nuevo) return "";
  var m = String(doc.notes || "").match(/CLIENTE NUEVO:\s*(.+?)\s*(?:\(falta crear|·|$)/) || String(doc.desc || "").match(/CLIENTE NUEVO:\s*([^·]+?)\s*(?:·|$)/);
  return m ? m[1].trim() : "";
}
function pdVendDe(tags) { var t = (tags || []).filter(function (x) { return x === "rm" || VENDEDORES.hasOwnProperty(x); })[0]; return t ? pdNombre(t) : ""; }

/* ---------- 3) bandeja de Mango ---------- */
function pdBandeja(q) {
  if (String(q.k || "") !== ADMIN) return { estado: "no", msg: "No autorizado" };
  var cache = CacheService.getScriptCache(), c = cache.get("PD_BANDEJA");
  if (c && q.f !== "1") return JSON.parse(c);
  var ahora = Math.floor(Date.now() / 1000), oc = pdOcultos(), skus = pdSkus();
  var sos = pdGet("documents/salesorder?starttmp=" + (ahora - 200 * 86400) + "&endtmp=" + (ahora + 86400));
  var ess = pdGet("documents/estimate?starttmp=" + (ahora - 200 * 86400) + "&endtmp=" + (ahora + 86400));
  var nts = pdGet("documents/invoice?starttmp=" + (ahora - 75 * 86400) + "&endtmp=" + (ahora + 86400));
  var hechoPor = {};                                                                   // id de pedido/presupuesto -> nota que lo factura
  var porNum = {}; sos.concat(ess).forEach(function (x) { porNum[String(x.docNumber || "").toLowerCase()] = x.id; });
  nts.forEach(function (n) {
    var f = n.from || {}; if (f.id) hechoPor[f.id] = n.docNumber;
    (n.tags || []).forEach(function (t) { if (porNum[t]) hechoPor[porNum[t]] = n.docNumber; });
  });
  var hp = pdHoja("Pedidos", PD_COLS), ped = pdFilas(hp, PD_COLS), portalPor = {};
  ped.forEach(function (x) { if (x.docId) portalPor[String(x.docId)] = x; });
  var vista = function (x, tipo) {
    var pt = portalPor[x.id], notes = String(x.notes || "");
    return { id: x.id, num: x.docNumber, tipo: tipo, fecha: Number(x.date), cliente: x.contactName, clienteId: x.contact, vend: pdVendDoc(x, pt), nombreNuevo: pdNombreNuevo(x),
      total: Math.round(Number(x.total) * 100) / 100, tarifa: /TARIFA BCV/.test(notes) ? "bcv" : /Pedido desde Pedidos NTX/.test(notes) ? "usd" : "",
      contado: /Pago de contado/i.test(notes) || (/Descuento \d/.test(notes) && !/cr[eé]dito/i.test(notes)), desc: Number(x.discount) || Math.max.apply(null, [0].concat((x.products || []).map(function (p) { return Number(p.discount) || 0; }))),
      vence: x.dueDate ? Math.round((Number(x.dueDate) - Number(x.date)) / 86400) : 0, nota: pdNotaVendedor(x), nuevo: x.contact === PD.nuevo,
      portal: !!pt || /Pedido desde Pedidos NTX/.test(notes), lineas: (x.products || []).map(function (p) { return [pdSku(p), Number(p.units) || 0, Number(p.price) || 0, Number(p.discount) || 0]; }),
      dias: Math.floor((ahora - Number(x.date)) / 86400) };
  };
  var abiertos = function (lista, tipo) {
    return lista.filter(function (x) { return Number(x.status) === 0 && !hechoPor[x.id] && !oc[x.id]; }).map(function (x) { return vista(x, tipo); })
      .sort(function (a, b) { return a.fecha - b.fecha; });
  };
  var pre = abiertos(ess, "presupuesto");
  pre.forEach(function (p) { p.vencido = p.dias >= PD.presVence; });
  var cola = [], rev = [];
  ped.forEach(function (x) {
    if (oc[String(x.pid)]) return;
    var o = { id: String(x.pid), recibido: Number(x.ts), cliente: String(x.Cliente), vend: String(x.Vendedor), tipo: String(x.Tipo), lineas: String(x["Líneas"]), nota: String(x.Nota), obs: String(x["Observación"]) };
    if (String(x.Estado) === "cola") cola.push(o);
    if (String(x.Estado) === "revisar" && ahora - Number(x.ts) < 30 * 86400) rev.push(o);
  });
  var hr = pdHoja("Revisión notas", PD_REV), hechos = pdFilas(hr, PD_REV).filter(function (f) { return ahora - Number(f.ts) <= (PD.hechosDias + 1) * 86400; }).map(function (f) {
    return { notaId: String(f.notaId), nota: String(f.Nota), origen: String(f.Origen), tipo: String(f.tipo) === "estimate" ? "presupuesto" : "pedido", cliente: String(f.Cliente),
      vend: String(f.Vendedor), total: Number(f.Total) || 0, fecha: Number(f.ts), envio: String(f["Envío"]), venc: String(f.Vencimiento), desc: String(f.Descuento),
      notaV: String(f["Nota del vendedor"]), avisos: String(f.Avisos), visto: String(f.visto || ""), ok: pdTodoOk(f), primera: Number(f.primera) || 0 };
  }).sort(function (a, b) { return b.fecha - a.fecha; });
  var r = { estado: "ok", ahora: ahora, ped: abiertos(sos, "pedido"), pre: pre, cola: cola, rev: rev, hechos: hechos, cfg: { hechosDias: PD.hechosDias, presVence: PD.presVence } };
  try { cache.put("PD_BANDEJA", JSON.stringify(r), 60); } catch (e) {}
  return r;
}
// ?a=bacc&k=ADMIN & h=<id de pedido/presupuesto o pid del portal> & e=ocultar|mostrar   ·   & n=<id de nota> & e=revisado|pendiente
function pdAccion(q) {
  if (String(q.k || "") !== ADMIN) return { estado: "no", msg: "No autorizado" };
  var e = String(q.e || "");
  if (q.h && (e === "ocultar" || e === "mostrar")) {
    var oc = pdOcultos(); if (e === "ocultar") oc[String(q.h)] = Math.floor(Date.now() / 1000); else delete oc[String(q.h)];
    PropertiesService.getScriptProperties().setProperty("PD_OCULTOS", JSON.stringify(oc));
  } else if (q.n && (e === "revisado" || e === "pendiente")) {
    var h = pdHoja("Revisión notas", PD_REV), f = pdFilas(h, PD_REV).filter(function (x) { return String(x.notaId) === String(q.n); })[0];
    if (!f) return { estado: "error", msg: "Nota no encontrada" };
    pdPon(h, PD_REV, f.fila, { "visto": e === "revisado" ? Math.floor(Date.now() / 1000) : "", "Revisado": e === "revisado" ? fecha(new Date().toISOString()) : "" });
  } else return { estado: "error", msg: "Acción no válida" };
  CacheService.getScriptCache().remove("PD_BANDEJA");
  return pdBandeja({ k: q.k, f: "1" });
}
function pdOcultos() {
  var o; try { o = JSON.parse(PropertiesService.getScriptProperties().getProperty("PD_OCULTOS") || "{}"); } catch (e) { o = {}; }
  var lim = Math.floor(Date.now() / 1000) - 120 * 86400; for (var k in o) if (o[k] < lim) delete o[k];
  return o;
}

/* ---------- Holded, productos y hojas ---------- */
function pdHttp(metodo, ruta, cuerpo) {
  var k = PropertiesService.getScriptProperties().getProperty("HOLDED_KEY");
  if (!k) throw new Error("Falta la propiedad HOLDED_KEY");
  var op = { method: metodo, headers: { key: k, Accept: "application/json" }, muteHttpExceptions: true };
  if (cuerpo != null) { op.contentType = "application/json"; op.payload = JSON.stringify(cuerpo); }
  for (var i = 0; i < 3; i++) {
    var r, cod;
    try { r = UrlFetchApp.fetch("https://api.holded.com/api/invoicing/v1/" + ruta, op); cod = r.getResponseCode(); } catch (e) { cod = 0; }
    if (cod === 429 || cod >= 500 || cod === 0) { if (metodo === "get" && i < 2) { Utilities.sleep(3000); continue; } }
    var datos = null; try { datos = r ? JSON.parse(r.getContentText() || "null") : null; } catch (e2) { datos = r ? r.getContentText().slice(0, 300) : null; }
    return { codigo: cod, datos: datos };
  }
}
function pdGet(ruta) { var r = pdHttp("get", ruta); if (r.codigo !== 200) throw pdTemporal(r); return r.datos; }
function pdTemporal(r) { var e = new Error("Holded respondió " + r.codigo); e.temporal = r.codigo === 0 || r.codigo === 429 || r.codigo >= 500; e.codigo = r.codigo; return e; }
function pdProductos() {
  var idx = {}, skus = {};
  for (var pg = 1; pg < 20; pg++) {
    var l = pdGet("products?page=" + pg); if (!l || !l.length) break;
    l.forEach(function (p) {
      var s = String(p.sku || "").trim().toUpperCase(); if (!s) return;
      var bcv = (p.rates || []).filter(function (r) { return r.id === PD.bcv; })[0];
      idx[s] = { id: p.id, desc: p.desc || "", usd: Number(p.price) || 0, bcv: bcv ? Number(bcv.subtotal) || 0 : 0, stock: Number(p.stock) || 0,
        con: (p.tags || []).some(function (t) { return String(t).toUpperCase() === "CONECTORES"; }) };
      skus[s] = 1;
    });
  }
  try { CacheService.getScriptCache().put("PD_SKUS", JSON.stringify(skus), 21600); } catch (e) {}
  return idx;
}
function pdSkus() { var c = CacheService.getScriptCache().get("PD_SKUS"); if (c) return JSON.parse(c); var s = {}; var i = pdProductos(); for (var k in i) s[k] = 1; return s; }
function pdHoja(nombre, cols) {
  var libro = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("COB_HOJA") || ""), h = libro.getSheetByName(nombre);
  if (!h) {
    h = libro.insertSheet(nombre); h.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight("bold"); h.setFrozenRows(1);
    h.getRange(1, cols.indexOf("ts") + 1, h.getMaxRows(), cols.length - cols.indexOf("ts")).setNumberFormat("@");
    h.hideColumns(cols.indexOf("ts") + 1, cols.length - cols.indexOf("ts"));
  }
  return h;
}
function pdFilas(h, cols) {
  var v = h.getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) { var o = { fila: i + 1 }; cols.forEach(function (c, k) { o[c] = v[i][k]; }); out.push(o); }
  return out;
}
function pdPon(h, cols, fila, vals) { for (var k in vals) if (cols.indexOf(k) >= 0) h.getRange(fila, cols.indexOf(k) + 1).setValue(vals[k]); }
function pdFila(cols, vals) { return cols.map(function (c) { var v = vals.hasOwnProperty(c) ? vals[c] : ""; return typeof v === "string" ? v.replace(/^[=+@-]/, "'$&") : v; }); }

/* ---------- instalación ---------- */
// Ejecutar UNA vez desde el editor. Se puede repetir sin dañar nada.
function pdInstalar() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty("HOLDED_KEY") || !props.getProperty("COB_HOJA")) throw new Error("Primero tiene que estar instalado cobranzas (HOLDED_KEY y COB_HOJA)");
  pdHoja("Pedidos", PD_COLS); pdHoja("Revisión notas", PD_REV);
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "pdCiclo") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("pdCiclo").timeBased().everyMinutes(10).create();
  var n = Object.keys(pdProductos()).length, prueba = pdRevisarNotas(true);
  var txt = "Pedidos directo a Holded quedó instalado.\n\nProductos leídos de Holded: " + n + "\nNotas recientes que salieron de pedidos o presupuestos: " + prueba.length + "\n\n" +
    prueba.map(function (v) { return v["Nota"] + " (de " + v["Origen"] + ", " + v["Cliente"] + "): envío " + v["Envío"] + " · vencimiento " + v["Vencimiento"] + " · descuento " + v["Descuento"] +
      (v["Avisos"] ? " · " + v["Avisos"] : ""); }).join("\n") +
    "\n\nDesde ahora los pedidos del portal entran solos a Holded y estas notas se revisan cada 10 minutos.";
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), "Portal NTX: pedidos directo a Holded instalado", txt);
  return txt;
}
