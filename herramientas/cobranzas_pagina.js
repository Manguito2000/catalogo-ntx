/*COBRANZAS*/
/* Pestaña Cobranzas del portal de ventas NTX (herramientas/COBRANZAS.md). Se inyecta en el catálogo con herramientas/aplicar_cobranzas.py.
   Datos: S.nt (notas del vendedor, vienen de datos.json) + cobros que anota el vendedor (los guarda y concilia el receptor de Apps Script). */
const CB = { tab:"pend", solo:false, nota:null, edit:null, rec:null, last:"", url:{}, f:{ ef:"", us:"", ze:"", bs:"", ta:"", rf:"", dd:"" }, err:"", busy:false, ok:null, cobros:null, cola:[], avisos:[], del:null, t0:0, img:{}, cargado:false, sync:"", sol:[], ret:{}, fac:null, facTxt:"", facErr:"", facBusy:false, msgOk:"", up:"" };
const LSK = "ntx-cobros", LSQ = "ntx-cobros-cola";
/* Descuento BCV (%): sale de config.json del repositorio (un solo número para todo el sistema). Mientras carga, el último conocido o 15. */
let DBCV = 15; try{ DBCV = Number(localStorage.getItem("ntx-dbcv")) || 15; }catch(e){}
const FBCV = () => 1 - DBCV / 100;          // dólares reales por cada dólar BCV
fetch("config.json?" + Date.now(), { cache:"no-store" }).then(r => r.json()).then(j => { const iv = Number(j && j.iva); if(iv > 0 && iv < 50 && iv !== IVAP){ IVAP = iv; try{ localStorage.setItem("ntx-iva", String(iv)); }catch(e){} if(VISTA === "cobros") cobRender(); }
  const v = Number(j && j.descuento_bcv);
  if(v > 0 && v < 90 && v !== DBCV){ DBCV = v; try{ localStorage.setItem("ntx-dbcv", String(v)); }catch(e){} if(VISTA === "cobros") cobRender(); } }).catch(() => {});
let IVAP = 16; try{ IVAP = Number(localStorage.getItem("ntx-iva")) || 16; }catch(e){}   // IVA (%): un solo número, en config.json (iva)
const r2 = n => Math.round(n * 100) / 100;
const cbNum = v => { const x = Number(String(v == null ? "" : v).replace(",", ".")); return isFinite(x) && x > 0 ? r2(x) : 0; };
/* Montos de una nota "en sus dólares": USD en las notas USD, dólares a tasa BCV en las notas BCV. El vendedor solo ve y cobra eso;
   la conversión a dólares reales (factor BCV) la hace el sistema para administración. */
const NT = r => ({ id:r[0], num:r[1], cid:r[2], fecha:r[3], vence:r[4], total:r[5], pagado:r[6], pend:r[7], tar:r[8], desc:r[9], real:r[10], pagos:r[12] || [], fac:r[13] || null,
  sal:r[8] === "b" ? (r[11] != null ? r[11] : r2(r[10] / FBCV())) : r[10] });
const esB = n => !!n && n.tar === "b";
const cbM = (v, n) => money(v) + (esB(n) ? " BCV" : "");
/* lo que un cobro le descuenta a la nota, en dólares de la nota (los cobros antiguos no traen "bv": se deduce) */
const cbBv = (c, n) => c.bv != null && c.bv !== "" ? Number(c.bv) : esB(n) ? r2(c.ab / FBCV()) : c.ab;
/* ---------- facturas AdriMan: neto, IVA, retención y solicitud ---------- */
/* La nota facturada se cobra en NETO; el IVA lo paga el cliente aparte. n.fac = [número de factura, IVA en dólares de la nota | null]. */
const cbNeto = n => esB(n) ? (n.desc > 0 ? r2(n.total / (1 - n.desc / 100)) : n.total) : n.total;       // total de la nota en sus dólares
const cbIvaT = n => !n || !n.fac ? 0 : n.fac[1] != null ? r2(n.fac[1]) : r2(cbNeto(n) * IVAP / 100);       // IVA total de la factura
const cbIvaR = n => { const t = n && n.fac ? cbNeto(n) : 0; return t > 0 ? cbIvaT(n) / t : IVAP / 100; };  // IVA por cada dólar neto
const cbRet = n => (CB.ret && CB.ret[n.id]) || null;
const cbIvaDe = (n, neto) => { const iva = r2(neto * cbIvaR(n)), rt = (cbRet(n) || {}).rt || 0, ret = r2(iva * rt / 100); return { iva, rt, ret, paga:r2(iva - ret) }; };
const cbSolDe = n => (CB.sol || []).find(q => q.n === n.id && q.est === "pendiente") || null;
const cbNotas = () => (S.nt || []).map(NT);
const cbCliente = id => { const c = (S.clientes || []).find(x => x.id === id); return c ? c.n : "Cliente"; };
const cbLoad = () => {
  if(CB.cargado) return; CB.cargado = true;
  try{ CB.cobros = JSON.parse(localStorage.getItem(LSK) || "null"); }catch(e){ CB.cobros = null; }
  try{ CB.cola = JSON.parse(localStorage.getItem(LSQ) || "[]") || []; }catch(e){ CB.cola = []; }
  try{ const f = JSON.parse(localStorage.getItem("ntx-cobros-fx") || "null"); if(f){ CB.sol = f.sol || []; CB.ret = f.ret || {}; } }catch(e){}
};
const cbSave = () => { try{ localStorage.setItem(LSK, JSON.stringify(CB.cobros || [])); localStorage.setItem(LSQ, JSON.stringify(CB.cola || [])); localStorage.setItem("ntx-cobros-fx", JSON.stringify({ sol:CB.sol || [], ret:CB.ret || {} })); }catch(e){} };
const cbCobros = () => { cbLoad(); const ids = new Set((CB.cobros || []).map(c => c.id)); return (CB.cobros || []).concat(CB.cola.filter(c => !ids.has(c.id))); };
const pendiente = c => c.est === "cobrado" || c.est === "revisar" || c.est === "cola";
function cbVisible(n){
  let pc = 0; const tengo = new Set(n.pagos.map(p => p[0]));
  cbCobros().forEach(c => {
    if(c.n !== n.id) return;
    if(pendiente(c)) pc += cbBv(c, n);
    else if(c.est === "confirmado" && (c.pg || []).some(p => !tengo.has(p[0]))) pc += cbBv(c, n);   // confirmado, pero los datos de Holded que tiene el teléfono aún no traen ese pago
  });
  pc = r2(pc); return { pc, saldo:Math.max(0, r2(n.sal - pc)) };
}
/* Holded guarda las fechas como medianoche de España: sumando 2 h y leyendo en UTC sale el día de calendario correcto en cualquier teléfono */
const cbDia = ts => { const d = new Date((ts + 7200) * 1000); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
function cbVence(n){
  if(!n.vence) return null; const h = new Date(); h.setHours(0,0,0,0);
  return Math.round((cbDia(n.vence) - h) / 864e5);
}
const cbVTxt = d => d == null ? "" : d < 0 ? "Vencida hace " + (-d) + (d === -1 ? " día" : " días") : d === 0 ? "Vence hoy" : "Vence en " + d + (d === 1 ? " día" : " días");
const cbFecha = s => s ? cbDia(s).toLocaleDateString("es-VE", { day:"2-digit", month:"short" }) : "";
const cbRows = () => cbNotas().map(n => Object.assign({ n, d:cbVence(n) }, cbVisible(n))).filter(x => x.n.pend >= 0.01 && (x.saldo >= 0.01 || x.pc >= 0.01));
function cobBadge(){
  const b = $("cobN"); if(!b) return; cbLoad();
  const v = cbRows().filter(x => x.d != null && x.d < 0 && x.saldo >= 0.01).length;
  b.hidden = !v; b.textContent = v; cobNav(VISTA || "catalogo");
}
/* barra inferior del portal: PEDIDOS | COBRANZAS. Es el único sitio desde donde se cambia de ambiente. */
function cobNav(v){
  const on = EXT && S.rol === "vendedor", c = v === "cobros", ad = on && !!S.adm; $("nav").hidden = !on; document.body.classList.toggle("con-nav", on);
  $("navAdm").hidden = !ad; $("nav").classList.toggle("n3", ad); $("navAdm").setAttribute("aria-current", v === "admin" ? "page" : "false");
  if(v !== "catalogo") solCero();
  $("navCob").setAttribute("aria-current", c ? "page" : "false"); $("navPed").setAttribute("aria-current", c || v === "admin" ? "false" : "page");
}
const cbF0 = () => ({ ef:"", us:"", ze:"", bs:"", ta:"", rf:"", dd:"" });
const cbSt = c => c.est === "confirmado" ? `<span class="st ok">Confirmado</span>` : c.est === "revisar" ? `<span class="st low">Revisar</span>` : c.est === "rechazo" ? `<span class="st no">No registrado</span>` : c.est === "cola" ? `<span class="st no">Sin enviar</span>` : `<span class="st low">Por confirmar</span>`;
const cbHora = t => t ? new Date(t * 1000).toLocaleString("es-VE", { day:"2-digit", month:"short", hour:"numeric", minute:"2-digit" }) : "";
/* acciones de un cobro: ver recibo siempre; corregir o anular solo mientras administración no lo haya confirmado */
function cbAcc(c){
  const pe = pendiente(c), sure = CB.del === c.id, hay = cbNotas().some(n => n.id === c.n);
  return (c.rec ? `<button class="txt" data-cb="rec" data-id="${esc(c.id)}">Recibo</button>` : "") +
    (c.est === "rechazo" ? `<button class="txt" data-cb="delok" data-id="${esc(c.id)}">Quitar de la lista</button>` : !pe ? "" : sure ? `<button class="txt" data-cb="delok" data-id="${esc(c.id)}">Sí, anular</button><button class="txt" data-cb="delno" style="color:var(--mut)">No</button>`
      : (hay ? `<button class="txt" data-cb="edit" data-id="${esc(c.id)}">Corregir</button>` : "") + `<button class="txt" data-cb="delask" data-id="${esc(c.id)}">${c.est === "cola" ? "Descartar" : "Anular"}</button>`);
}

/* ---------- pantallas ---------- */
function cobRender(){
  const el = $("vCob"); if(!el) return; cbLoad();
  if(!(EXT && S.rol === "vendedor")){ el.innerHTML = `<div class="box"><p class="hint">Entra con tu código para ver tus cobranzas.</p></div>`; return; }
  if(VISTA === "admin"){ admRender(); return; }
  const av = CB.avisos.length ? CB.avisos.map((a, i) => `<div class="msg">${esc(a)} <button class="txt" data-cb="avok" data-i="${i}">Entendido</button></div>`).join("") : "";
  if(CB.ok){ el.innerHTML = av + cbOkHtml(); cbRecPinta(CB.ok.cobro); return; }
  if(CB.rec){ const c = cbCobros().find(x => x.id === CB.rec);
    if(c && c.rec){ el.innerHTML = av + `<button class="txt" data-cb="recx" style="justify-self:start">‹ Volver</button><h2 class="bs">Recibo ${esc(c.rec)}</h2>` + cbRecHtml(c); cbRecPinta(c); return; }
    CB.rec = null; }
  if(CB.fac){ el.innerHTML = av + cbFacHtml(); return; }
  if(CB.nota){ const h = cbFormHtml(); if(h){ el.innerHTML = av + h; if($("cbSum")) cbSum(); return; } }
  const ne = cbCobros().filter(pendiente).length;
  const tabs = `<div class="seg tabs" role="group" aria-label="Cobranzas">${[["pend", "Pendientes"], ["ent", "Por entregar" + (ne ? " (" + ne + ")" : "")]].map(([k, l]) => `<button data-cb="tab" data-k="${k}" aria-pressed="${CB.tab === k}">${l}</button>`).join("")}</div>`;
  el.innerHTML = tabs + av + (CB.msgOk ? `<div class="okb"><b>${esc(CB.msgOk)}</b></div>` : "") + (CB.tab === "ent" ? cbEntHtml() : cbPendHtml());
}
function cbPendHtml(){
  if(!Array.isArray(S.nt)) return `<div class="box"><p class="hint">Todavía no hay datos de cobranzas en este teléfono. Se cargan en el próximo refresco de Holded (12:40 pm y 6:40 pm).</p></div>`;
  const todas = cbRows(), venc = todas.filter(x => x.d != null && x.d < 0 && x.saldo >= 0.01);
  const lista = CB.solo ? venc : todas;
  const sum = a => r2(a.reduce((s, x) => s + x.saldo, 0)), deB = a => r2(a.filter(x => esB(x.n)).reduce((s, x) => s + x.saldo, 0));
  const pie = a => `${a.length} ${a.length === 1 ? "nota" : "notas"}${deB(a) >= 0.01 ? " · " + money(deB(a)) + " en BCV" : ""}`;
  let h = `<div class="cbs"><div><span class="lbl">Por cobrar</span><b class="bs num">${money(sum(todas))}</b><small>${pie(todas)}</small></div>
    <div class="v"><span class="lbl">Vencido</span><b class="bs num">${money(sum(venc))}</b><small>${pie(venc)}</small></div></div>
    <div class="seg" role="group" aria-label="Filtro" style="justify-self:start">${[[false, "Todas"], [true, "Solo vencidas"]].map(([k, l]) => `<button data-cb="solo" data-k="${k}" aria-pressed="${CB.solo === k}">${l}</button>`).join("")}</div>`;
  if(!lista.length) return h + `<div class="box"><p class="hint">${CB.solo ? "No tienes notas vencidas. " : "No tienes notas pendientes. "}Los datos de Holded se refrescan a las 12:40 pm y a las 6:40 pm.</p></div>`;
  const g = {}; lista.forEach(x => (g[x.n.cid] = g[x.n.cid] || []).push(x));
  const ids = Object.keys(g).sort((a, b) => (g[b].some(x => x.d != null && x.d < 0) - g[a].some(x => x.d != null && x.d < 0)) || cbCliente(a).localeCompare(cbCliente(b), "es"));
  ids.forEach(id => {
    const rows = g[id].sort((a, b) => (a.n.fecha || 0) - (b.n.fecha || 0));
    h += `<section class="cbg"><div class="cbh"><b>${esc(cbCliente(id))}</b><span class="bs num">${money(sum(rows))}</span></div>` + rows.map(x => {
      const vc = x.d != null && x.d < 0;
      return `<div class="cbw"><button class="cbr" data-cb="open" data-id="${esc(x.n.id)}"><span><span class="n bs">${esc(x.n.num)}</span> ${x.n.tar === "b" ? `<span class="tg">BCV</span>` : ""}${x.n.fac ? ` <span class="tg fa">FACTURA ${esc(x.n.fac[0])}</span>` : ""}<br><small>${esc(cbFecha(x.n.fecha))}${x.d != null ? " · " : ""}<span class="${vc ? "ven" : ""}">${esc(cbVTxt(x.d))}</span></small></span>
        <span class="r"><span class="s bs num">${money(x.saldo)}</span>${esB(x.n) || x.n.fac ? `<br><small class="tb">${[esB(x.n) ? "tasa BCV" : "", x.n.fac ? "neto" : ""].filter(Boolean).join(" · ")}</small>` : ""}${x.pc >= 0.01 ? `<br><small class="pc">Abono por confirmar ${money(x.pc)}</small>` : ""}</span></button>${cbFilaAcc(x.n, x.saldo)}</div>`;
    }).join("") + `</section>`;
  });
  return h + `<p class="hint">${CB.vivo ? "Saldos de Holded al momento" : "Saldos de Holded al " + (S.fecha ? esc(new Date(S.fecha).toLocaleString("es-VE", { day:"2-digit", month:"short", hour:"numeric", minute:"2-digit" })) : "último refresco")}${CB.sync ? " · " + esc(CB.sync) : ""}. Lo que cobres hoy aparece como «abono por confirmar» hasta que administración lo registre.</p>`;
}
function cbMetodos(c){ return [["Bs", c.bs], ["Efectivo", c.ef], ["USDT", c.us], ["Zelle", c.ze]].filter(x => x[1] > 0).map(x => x[0] + " " + money(x[1])).join(" · ") + (Number(c.dd) > 0 ? " · desc. divisas " + c.dd + " %" : ""); }
function cbEntHtml(){
  const todos = cbCobros().filter(c => c.est !== "anulado").sort((a, b) => (b.t || 0) - (a.t || 0)), pend = todos.filter(pendiente), conf = todos.filter(c => c.est === "confirmado");
  const T = k => r2(pend.reduce((s, c) => s + (c[k] || 0), 0));
  let h = `<div class="box"><span class="lbl">Efectivo que debes entregar</span><b class="bs num" style="font-size:38px;line-height:1">${money(T("ef"))}</b>
    <small class="hint">USDT ${money(T("us"))} · Zelle ${money(T("ze"))} · Bolívares ${money(T("bs"))} (en $) · ${pend.length} ${pend.length === 1 ? "cobro" : "cobros"} por confirmar</small></div>`;
  const card = c => `<article class="od"><div class="h"><b>${esc(c.cn || "Cliente")}</b>${cbSt(c)}</div>
      <div class="i num">${esc(c.rec || "Sin número")} · Nota ${esc(c.nn || "")} · ${esc(cbHora(c.t))}</div><div class="i num">${esc(cbMetodos(c))}${c.ta ? " · tasa " + c.ta : ""}${c.rf ? " · ref. " + esc(c.rf) : ""}</div>
      ${(c.est === "revisar" || c.est === "rechazo") && c.obs ? `<div class="i" style="color:var(--warn)">${esc(c.obs)}</div>` : ""}
      <div class="f"><span class="pr bs num">${money(c.nom)}</span>${cbAcc(c)}</div></article>`;
  h += pend.length ? pend.map(card).join("") : `<div class="box"><p class="hint">No tienes cobros por entregar. Cuando cobres, anótalo desde la pestaña Pendientes.</p></div>`;
  const rech = todos.filter(c => c.est === "rechazo");
  if(rech.length) h += `<h2 class="bs" style="margin-top:6px">No registrados</h2><p class="hint">Administración no aceptó estos cobros (casi siempre porque la nota ya aparece pagada en Holded). Si entregaste el recibo, avisa a administración.</p>` + rech.map(card).join("");
  if(conf.length) h += `<h2 class="bs" style="margin-top:6px">Confirmados esta semana</h2>` + conf.map(card).join("");
  return h;
}
function cbSaldoNota(){
  const n = cbNotas().find(x => x.id === CB.nota); if(!n) return null; const x = Object.assign({ n }, cbVisible(n));
  const ed = CB.edit ? cbCobros().find(c => c.id === CB.edit && c.n === n.id && pendiente(c)) : null;
  if(ed){ x.pc = Math.max(0, r2(x.pc - cbBv(ed, n))); x.saldo = Math.max(0, r2(n.sal - x.pc)); x.ed = ed; } else CB.edit = null;   // al corregir, el cobro viejo se anula: su monto vuelve a estar disponible
  return x;
}
/* pantalla de una nota: su saldo, los abonos ya anotados (con recibo, corregir y anular) y, si aún falta por cobrar, el formulario */
function cbFormHtml(){
  const x = cbSaldoNota(); if(!x){ CB.nota = null; CB.edit = null; return ""; }
  const n = x.n, bcv = esB(n), ed = x.ed;
  const F = (k, l) => `<label><span>${l}<button type="button" class="txt fill" data-cb="fill" data-k="${k}">Completar saldo</button></span><input class="fld num" id="cb_${k}" data-cb-in="${k}" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(CB.f[k])}"></label>`;
  const mios = cbCobros().filter(c => c.n === n.id && c.est !== "anulado" && !(ed && c.id === ed.id)).sort((a, b) => (b.t || 0) - (a.t || 0));
  let h = `<button class="txt" data-cb="${ed ? "editx" : "volver"}" style="justify-self:start">‹ ${ed ? "Dejar el cobro como estaba" : "Volver a pendientes"}</button><h2 class="bs">${ed ? "Corregir cobro" : "Nota " + esc(n.num)}</h2>
    <div class="box"><div class="sel"><span><b>${esc(cbCliente(n.cid))}</b><small>${esc(n.num)}${bcv ? " · BCV" : ""} · ${esc(cbVTxt(cbVence(n)) || "sin vencimiento")}</small></span><span style="flex:none;text-align:right"><small>Falta por cobrar</small><b class="bs num" style="font-size:26px">${money(x.saldo)}</b>${bcv ? `<small class="tb">tasa BCV</small>` : ""}</span></div>
      ${x.pc >= 0.01 ? `<p class="hint num">Ya anotaste ${money(x.pc)} por confirmar</p>` : ""}</div>`;
  if(!ed) h += cbFacBox(n, x);
  if(mios.length && !ed) h += `<div class="box"><span class="lbl">Abonos que anotaste</span>` + mios.map(c => `<div class="cba"><div class="h"><b class="bs num">${money(c.nom)}</b>${cbSt(c)}</div>
      <div class="i num">${esc(c.rec || "Sin número")} · ${esc(cbHora(c.t))} · ${esc(cbMetodos(c))}${Math.abs(cbBv(c, n) - c.nom) >= 0.01 ? " · abona " + cbM(cbBv(c, n), n) : ""}</div>${(c.est === "revisar" || c.est === "rechazo") && c.obs ? `<div class="i" style="color:var(--warn)">${esc(c.obs)}</div>` : ""}
      <div class="f">${cbAcc(c)}</div></div>`).join("") + `</div>`;
  if(x.saldo < 0.01 && !ed) return h + `<div class="box"><p class="hint">Esta nota ya está cobrada por completo. Sale de tu lista cuando administración registre el pago en Holded. Si te equivocaste en un monto, toca «Corregir» en el abono.</p></div>`;
  const campos = bcv
    ? F("bs", "Bolívares (dólares BCV)") + F("ef", "Efectivo $") + F("us", "USDT $") + F("ze", "Zelle $") +
      `<label id="cbDd" hidden><span>Descuento por pago en divisas</span><span class="pct"><input class="fld num" id="cb_dd" data-cb-in="dd" type="text" inputmode="decimal" autocomplete="off" placeholder="${DBCV}" value="${esc(CB.f.dd !== "" && CB.f.dd != null ? CB.f.dd : String(DBCV))}"><b>%</b></span><small class="hint">Lo normal es ${DBCV} %. Cámbialo solo si acordaste otro con el cliente.</small></label>`
    : F("ef", "Efectivo $") + F("us", "USDT $") + F("ze", "Zelle $") + F("bs", "Bolívares (monto en $)") +
      `<label id="cbTa" hidden><span>Tasa Bs por $ (la que acordaste)</span><input class="fld num" id="cb_ta" data-cb-in="ta" type="text" inputmode="decimal" autocomplete="off" placeholder="Ej. 1080" value="${esc(CB.f.ta)}"></label>`;
  return h + `<div class="box"><span class="lbl">${ed ? "Montos corregidos" : mios.length ? "Registrar otro cobro" : "Registrar cobro"}</span>
      ${ed ? `<p class="hint">Al guardar se anula el recibo ${esc(ed.rec || "anterior")} y se crea uno nuevo con estos montos. Si ya le enviaste el recibo al cliente, envíale el nuevo.</p>` : ""}
      ${bcv ? `<p class="hint">Nota en dólares a tasa BCV: anota los dólares BCV que pagó el cliente. Si paga en divisas, se aplica el descuento.</p>` : `<p class="hint">Escribe lo que el cliente te dio, en dólares, por cada forma de pago.</p>`}
      ${n.fac ? `<p class="hint">Nota facturada: anota solo el monto neto. El IVA lo paga el cliente aparte y lo ves abajo.</p>` : ""}
      <div class="cbf">${campos}
        <label><span>Referencia o comprobante (opcional)</span><input class="fld" id="cb_rf" data-cb-in="rf" type="text" autocomplete="off" maxlength="120" placeholder="Últimos dígitos, nombre del banco…" value="${esc(CB.f.rf)}"></label></div>
      <div class="cbsum" id="cbSum"></div><div class="cbe" id="cbErr"></div>
      <button class="send" id="cbGo" data-cb="guardar">GUARDAR COBRO</button></div>`;
}
/* nom = lo que entregó el cliente · bv = lo que abona a la nota (en dólares de la nota) · ab = dólares reales (lo que registrará administración en Holded)
   Nota BCV: bolívares abonan 1 a 1 en dólares BCV; las divisas abonan divisas / (1 − descuento). Reales: bolívares × factor BCV + divisas. */
function cbCalc(n, f){
  const ef = cbNum(f.ef), us = cbNum(f.us), ze = cbNum(f.ze), bs = cbNum(f.bs), div = r2(ef + us + ze), nom = r2(div + bs);
  if(!esB(n)) return { ef, us, ze, bs, div, nom, dd:0, bv:nom, ab:nom };
  const dt = String(f.dd == null ? "" : f.dd).trim(), dd = div > 0 ? (dt === "" ? DBCV : Math.max(0, Math.min(50, Number(dt.replace(",", ".")) || 0))) : 0;
  return { ef, us, ze, bs, div, nom, dd, bv:r2(bs + div / (1 - dd / 100)), ab:r2(bs * FBCV() + div) };
}
function cbSum(){
  const x = cbSaldoNota(), s = $("cbSum"); if(!x || !s) return; const n = x.n, c = cbCalc(n, CB.f), resto = r2(x.saldo - c.bv);
  const ta = $("cbTa"); if(ta) ta.hidden = !(c.bs > 0); const dl = $("cbDd"); if(dl) dl.hidden = !(c.div > 0);
  const sobra = c.bv > x.saldo + 0.5;
  s.innerHTML = esB(n)
    ? (c.bs > 0 ? `<div><span>Bolívares</span><b class="num">${cbM(c.bs, n)}</b></div>` : "") + (c.div > 0 ? `<div><span>Divisas${c.dd ? " (−" + c.dd + " %)" : ""}</span><b class="num">${money(c.div)} → ${cbM(r2(c.bv - c.bs), n)}</b></div>` : "") +
      `<div><span>Abona a la nota</span><b class="num">${cbM(c.bv, n)}</b></div><div class="big"><span>Quedaría por cobrar</span><b class="bs num">${cbM(Math.max(0, resto), n)}</b></div>`
    : `<div><span>Cobrado</span><b class="num">${money(c.nom)}</b></div><div class="big"><span>Quedaría por cobrar</span><b class="bs num">${money(Math.max(0, resto))}</b></div>`;
  if(n.fac && c.bv > 0){ const iv = cbIvaDe(n, c.bv);
    s.innerHTML = s.innerHTML.replace('<div class="big">', `<div><span>IVA ${IVAP} % aparte</span><b class="num">${cbM(iv.iva, n)}</b></div>` + (iv.rt ? `<div><span>Retención ${iv.rt} % del IVA</span><b class="num">−${cbM(iv.ret, n)}</b></div>` : "") +
      `<div><span>IVA que paga el cliente</span><b class="num">${cbM(iv.paga, n)}</b></div><div class="big">`); }
  $("cbGo").disabled = c.nom <= 0 || sobra || CB.busy; $("cbGo").textContent = CB.busy ? "GUARDANDO…" : CB.edit ? "GUARDAR CORRECCIÓN" : "GUARDAR COBRO";
  $("cbErr").textContent = sobra ? "Eso es más de lo que falta de la nota (" + cbM(x.saldo, n) + ")." : CB.err;
}
function cbOkHtml(){
  const c = CB.ok.cobro, n = cbNotas().find(x => x.id === c.n), sc = n ? cbVisible(n).saldo : 0;
  return `<div class="okb"><b>Cobro ${esc(c.rec || "")} guardado</b>${esc(c.cn || "")} · Nota ${esc(c.nn || "")}\n${money(c.nom)} cobrados${n ? " · quedan " + cbM(sc, n) + " por cobrar de la nota" : ""}</div>
    ${c.est === "cola" ? `<div class="msg">Ya puedes enviar el recibo. El cobro quedó guardado en este teléfono y se avisará a administración solo, en cuanto ${navigator.onLine === false ? "vuelva la conexión" : "responda el servidor de cobranzas"}.${CB.diag ? `<br><small style="font-weight:500">Detalle para soporte: ${esc(CB.diag)}</small>` : ""}</div>` : ""}
    ${c.rec ? cbRecHtml(c) : ""}<button class="ghost" data-cb="listo">Listo</button>`;
}
/* ¿este teléfono puede mandar la imagen directo a otra aplicación? En computadora no: ahí se manda el texto y la imagen se descarga. */
function cbPuedeImg(){
  try{ return /Android|iPhone|iPad/i.test(navigator.userAgent || "") && !!(navigator.canShare && navigator.canShare({ files:[new File([new Blob(["x"], { type:"image/png" })], "r.png", { type:"image/png" })] })); }catch(e){ return false; }
}
function cbRecHtml(c){
  const wa = "https://wa.me/?text=" + encodeURIComponent(cbReciboTxt(c)), im = cbPuedeImg();
  return `<div class="box"><span class="lbl">Recibo para el cliente</span><img class="cbimg" id="cbImg" alt="Recibo ${esc(c.rec)}">
    ${im ? `<button class="send" data-cb="share" data-id="${esc(c.id)}">ENVIAR RECIBO POR WHATSAPP</button><p class="hint">Se abre la lista de aplicaciones del teléfono: elige WhatsApp y luego al cliente. Se envía la imagen con su texto.</p>` : ""}
    <a class="${im ? "ghost" : "send"}" href="${esc(wa)}" target="_blank" rel="noopener">${im ? "Enviar solo el texto por WhatsApp" : "ENVIAR RECIBO POR WHATSAPP (TEXTO)"}</a>
    <a class="ghost" id="cbDl" download="Recibo ${esc(c.rec)}.png">Descargar la imagen del recibo</a></div>`;
}
/* la imagen se prepara al mostrar el recibo, así el botón de enviar la tiene lista al tocarlo */
function cbRecPinta(c){
  if(!c || !c.rec) return;
  const pon = b => { const u = CB.url[c.id] || (CB.url[c.id] = URL.createObjectURL(b)), i = $("cbImg"), d = $("cbDl"); if(i) i.src = u; if(d) d.href = u; };
  if(CB.img[c.id]) pon(CB.img[c.id]); else cbImg(c).then(b => { if(b){ CB.img[c.id] = b; pon(b); } });
}

/* ---------- servidor ---------- */
async function cbSrv(a, ex){
  let cod = "", d = ""; try{ cod = localStorage.getItem(LSC) || ""; d = localStorage.getItem("ntx-disp") || ""; }catch(e){}
  const q = new URLSearchParams(Object.assign({ a, cod, d }, ex || {}));
  let res; try{ res = await fetch(SCRIPT_URL + "?" + q.toString(), { cache:"no-store", redirect:"follow" }); }catch(e){ CB.diag = "sin respuesta (" + ((e && e.message) || e) + ")"; throw e; }
  const t = await res.text();
  try{ const j = JSON.parse(t); CB.diag = ""; return j; }catch(e){ CB.diag = "respuesta inesperada " + res.status + ": " + t.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160); throw e; }
}
/* El número de recibo lo pone el teléfono, para poder entregar el recibo en el momento aunque no haya conexión.
   Sigue la cuenta de lo último que conoce (lo guardado aquí y lo que devolvió el receptor). Si el receptor ya tenía ese número, asigna otro y se avisa. */
const LSN = "ntx-cobros-n";
function cbSigRec(){
  let n = 0, pre = ""; try{ n = Number(localStorage.getItem(LSN)) || 0; }catch(e){}
  cbCobros().forEach(c => { const m = /^([A-Z]+)-(\d+)$/.exec(c.rec || ""); if(m){ pre = pre || m[1]; n = Math.max(n, Number(m[2])); } });
  n += 1; try{ localStorage.setItem(LSN, String(n)); }catch(e){}
  return (pre || ((S.yo && S.yo.tag) || "x").charAt(0).toUpperCase()) + "-" + ("000" + n).slice(-4);
}
function cbCambioRec(o, c){ if(o.rec && c.rec && o.rec !== c.rec) CB.avisos.push("El recibo " + o.rec + " de " + (c.cn || "un cliente") + " quedó registrado con el número " + c.rec + ". Si ya se lo enviaste al cliente, envíale el nuevo."); }
const cbB64 = o => { const b = new TextEncoder().encode(JSON.stringify(o)); let s = ""; b.forEach(x => s += String.fromCharCode(x)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const cbUid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
function cbMerge(c){ CB.cobros = [c].concat((CB.cobros || []).filter(x => x.id !== c.id)); cbSave(); }
/* devuelve {ok, cobro} | {err} (el servidor lo rechazó) | {net:true} (sin conexión) */
async function cbEnviar(o){
  let r;
  try{ r = await cbSrv("cobro", { x:cbB64({ id:o.id, rec:o.rec || "", n:o.n, ef:o.ef, us:o.us, ze:o.ze, bs:o.bs, ab:o.ab, bv:o.bv, dd:o.dd || 0, tb:o.tb || "", ta:o.ta || 0, rf:o.rf || "", cn:o.cn }) }); }catch(e){ return { net:true }; }
  if(r && r.estado === "ok" && r.cobro) return { ok:true, cobro:r.cobro };
  if(r && r.estado === "no") return { err:"Este dispositivo ya no está autorizado. Habla con administración." };
  return { err:(r && r.msg) || "No se pudo guardar el cobro." };
}
async function cbFlush(){
  if(CB.flushing || !CB.cola.some(o => o.est === "cola")) return; CB.flushing = true;
  for(const o of CB.cola.slice()){
    if(o.est !== "cola") continue;
    const r = await cbEnviar(o); if(r.net) break;
    if(r.ok){ CB.cola = CB.cola.filter(x => x.id !== o.id); cbCambioRec(o, r.cobro); cbMerge(r.cobro); }
    else { o.est = "rechazo"; o.obs = r.err; CB.avisos.push("El cobro " + (o.rec || "") + " de " + (o.cn || "un cliente") + " (" + money(o.nom) + ") no quedó registrado en administración: " + r.err + " Sigue a la vista en «Por entregar»."); }
  }
  cbSave(); CB.flushing = false;
}
async function cbRefresca(){
  CB.sync = "";
  await cbFlush();
  try{ const ids = (S.nt || []).map(x => x[0]).slice(0, 80).join(",");
    const r = await cbSrv("cobros", ids ? { ids } : {}); if(r && r.estado === "ok" && Array.isArray(r.cobros)){ CB.cobros = r.cobros; if(Array.isArray(r.sol)) CB.sol = r.sol; if(r.ret && typeof r.ret === "object") CB.ret = r.ret; cbSave(); cbVivo(r.nt); } else if(r && r.estado === "no") CB.sync = "este dispositivo no está autorizado para cobros"; }
  catch(e){ CB.sync = "sin conexión: se muestra lo último guardado"; }
  if(Date.now() - CB.t0 > 3e5){
    CB.t0 = Date.now();
    try{ const r = await fetch("datos.json?" + Date.now(), { cache:"no-store" }); if(r.ok){ const j = await r.json(); if(j && Array.isArray(j.v) && j.v.length){ VENDS = j.v; if(window.NTX_PASE) await unlock(window.NTX_PASE); } } }catch(e){}
  }
  if(VISTA === "cobros" && !CB.nota && !CB.ok && !CB.fac && !document.activeElement.matches("input,textarea")) cobRender();
  cobBadge();
}
/* saldos al momento que devuelve el receptor: pisan los del último refresco de datos (que puede tener horas) */
function cbVivo(m){
  if(!m || !Array.isArray(S.nt)) return;
  S.nt.forEach(r => { const v = m[r[0]]; if(v === undefined) return;
    if(v === null){ if(r[7] >= 0.01){ r[6] = r[5]; r[7] = 0; r[10] = 0; r[11] = r[8] === "b" ? 0 : null; } return; }   // Holded ya no la tiene pendiente
    r[5] = v[0]; r[6] = v[1]; r[7] = v[2]; r[9] = v[3]; r[12] = v[4] || []; if(v.length > 5) r[13] = v[5] || null;
    r[10] = r[8] === "b" && !v[3] ? r2(v[2] * FBCV()) : v[2];                                     // reales (Holded aún sin el descuento: se calcula)
    r[11] = r[8] === "b" ? (v[3] > 0 ? r2(v[2] / (1 - v[3] / 100)) : v[2]) : null; });            // dólares BCV de lo que falta
  CB.vivo = Date.now();
}
function cobAbre(){ cbLoad(); CB.nota = null; CB.edit = null; CB.rec = null; CB.ok = null; CB.del = null; CB.tab = CB.tab || "pend"; cobRender(); cobBadge(); cbRefresca(); }

/* ---------- guardar ---------- */
async function cbGuardar(){
  const x = cbSaldoNota(); if(!x || CB.busy) return; const c = cbCalc(x.n, CB.f);
  if(c.nom <= 0 || c.bv > x.saldo + 0.5) return;
  CB.err = ""; CB.busy = true; cbSum();
  if(x.ed){   // corrección: primero se anula el cobro anterior; el nuevo sale con recibo nuevo
    if(x.ed.est === "cola"){ CB.cola = CB.cola.filter(k => k.id !== x.ed.id); cbSave(); }
    else {
      let r = null; try{ r = await cbSrv("anular", { r:x.ed.rec }); }catch(e){}
      if(!(r && r.estado === "ok" && Array.isArray(r.cobros))){ CB.busy = false; CB.err = (r && r.msg) || "Sin conexión: no se pudo corregir. Intenta de nuevo."; cbSum(); return; }
      CB.cobros = r.cobros; cbSave();
    }
    CB.edit = null;
  }
  const o = { id:cbUid(), n:x.n.id, nn:x.n.num, cn:cbCliente(x.n.cid), t:Math.floor(Date.now() / 1000), nom:c.nom, ab:c.ab, bv:c.bv, dd:c.dd, tb:esB(x.n) ? "b" : "", ef:c.ef, us:c.us, ze:c.ze, bs:c.bs, ta:c.bs > 0 && !esB(x.n) ? cbNum(CB.f.ta) : 0, rf:(CB.f.rf || "").trim().slice(0, 120), est:"cola", rec:cbSigRec(), fa:x.n.fac ? x.n.fac[0] : "" };
  const r = await cbEnviar(o); CB.busy = false;
  if(r.err){ CB.err = /mayor que lo que falta/.test(r.err) ? r.err + ". Holded ya tiene registrado un pago de esta nota; el saldo de esta pantalla estaba atrasado y se está actualizando." : r.err; CB.t0 = 0; cobRender(); cbRefresca(); return; }
  let cobro;
  if(r.ok){ cobro = r.cobro; cbCambioRec(o, cobro); cbMerge(cobro); } else { cobro = o; CB.cola.push(o); cbSave(); }
  CB.f = cbF0(); CB.nota = null; CB.ok = { cobro }; cobRender(); cobBadge(); window.scrollTo(0, 0);
}

/* ---------- recibo (imagen + texto) ---------- */
function cbReciboTxt(c){
  const n = cbNotas().find(x => x.id === c.n), saldo = n ? cbVisible(n).saldo : null;
  return `Recibo ${c.rec} · ${c.cn} · Nota ${c.nn} · Cobrado ${money(c.nom)}${saldo != null ? " · Saldo " + cbM(saldo, n) : ""}\nRecibo sujeto a verificación. NTX Original Parts`;
}
function cbImg(c){
  return new Promise(res => {
    const n = cbNotas().find(x => x.id === c.n), saldo = n ? cbVisible(n).saldo : null, b = esB(n) || c.tb === "b";
    const W = 900, filas = [["Cliente", c.cn || ""], ["Nota", c.nn || ""]].concat([[b ? "Bolívares (dólares BCV)" : "Bolívares (en $)", c.bs], ["Efectivo", c.ef], ["USDT", c.us], ["Zelle", c.ze]].filter(x => x[1] > 0).map(x => [x[0], money(x[1])]));
    if(Number(c.dd) > 0) filas.push(["Descuento pago en divisas", c.dd + " %"]);
    if(b && Math.abs(cbBv(c, n) - c.nom) >= 0.01) filas.push(["Abonado a la nota", money(cbBv(c, n)) + " BCV"]);
    if(c.ta) filas.push(["Tasa", String(c.ta)]); if(c.rf) filas.push(["Referencia", c.rf]);
    const fa = c.fa || (n && n.fac ? n.fac[0] : ""); if(fa){ filas.push(["Factura AdriMan", fa]); filas.push(["Importe", "neto, IVA aparte"]); }
    const H = 330 + filas.length * 62 + 250, cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
    const dibuja = logo => {
      g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.fillStyle = "#16161A"; g.fillRect(0, 0, W, 190);
      if(logo){ const h = 86, w = logo.width * h / logo.height; g.drawImage(logo, 50, 52, w, h); }
      g.fillStyle = "#fff"; g.textAlign = "right"; g.font = "800 40px Inter,Arial,sans-serif"; g.fillText("RECIBO DE COBRO", W - 50, 92); g.font = "700 34px Inter,Arial,sans-serif"; g.fillStyle = "#E3222C"; g.fillText(c.rec, W - 50, 144);
      g.textAlign = "left"; g.fillStyle = "#55575C"; g.font = "600 28px Inter,Arial,sans-serif"; g.fillText(c.t ? new Date(c.t * 1000).toLocaleString("es-VE", { day:"2-digit", month:"long", year:"numeric", hour:"numeric", minute:"2-digit" }) : "", 50, 250);
      let y = 330; g.font = "600 30px Inter,Arial,sans-serif";
      filas.forEach(f => { g.fillStyle = "#55575C"; g.textAlign = "left"; g.fillText(f[0], 50, y); g.fillStyle = "#16161A"; g.textAlign = "right"; g.font = "700 30px Inter,Arial,sans-serif"; let t = String(f[1]); while(g.measureText(t).width > W - 330 && t.length > 4) t = t.slice(0, -2); g.fillText(t === String(f[1]) ? t : t + "…", W - 50, y); g.font = "600 30px Inter,Arial,sans-serif"; g.fillStyle = "#E3E5E8"; g.fillRect(50, y + 22, W - 100, 2); y += 62; });
      y += 30; g.fillStyle = "#55575C"; g.textAlign = "left"; g.font = "700 28px Inter,Arial,sans-serif"; g.fillText("TOTAL COBRADO", 50, y); g.fillStyle = "#16161A"; g.textAlign = "right"; g.font = "800 68px Inter,Arial,sans-serif"; g.fillText(money(c.nom), W - 50, y + 4);
      if(saldo != null){ y += 70; g.fillStyle = "#55575C"; g.textAlign = "left"; g.font = "600 28px Inter,Arial,sans-serif"; g.fillText("Saldo pendiente de la nota", 50, y); g.fillStyle = "#16161A"; g.textAlign = "right"; g.font = "700 32px Inter,Arial,sans-serif"; g.fillText(b ? money(saldo) + " BCV" : money(saldo), W - 50, y); }
      g.fillStyle = "#55575C"; g.textAlign = "center"; g.font = "500 24px Inter,Arial,sans-serif"; g.fillText("Recibo sujeto a verificación por administración", W / 2, H - 56);
      cv.toBlob(b => res(b), "image/png");
    };
    const im = new Image(); im.onload = () => dibuja(im); im.onerror = () => dibuja(null); im.src = "img/logo.png";
  });
}
/* al compartir la imagen, el texto lleva solo el número de recibo y el de nota: basta para encontrarlo luego con el buscador de WhatsApp */
async function cbShare(id){
  const c = cbCobros().find(x => x.id === id); if(!c || !c.rec) return; const txt = cbReciboTxt(c);
  try{ const blob = CB.img[c.id] || await cbImg(c); CB.img[c.id] = blob; await navigator.share({ files:[new File([blob], "Recibo " + c.rec + ".png", { type:"image/png" })], text:"Recibo " + c.rec + " · Nota " + (c.nn || "") }); }
  catch(e){ if(e && e.name === "AbortError") return; CB.avisos.push("Este teléfono no dejó compartir la imagen. Usa «Enviar solo el texto por WhatsApp»."); cobRender(); }
}

/* ---------- facturas AdriMan: pantallas del vendedor ---------- */
/* debajo de cada nota de la lista: su estado de factura y el botón para pedirla */
function cbFilaAcc(n, saldo){
  const s = cbSolDe(n);
  if(n.fac){ const ip = cbIvaDe(n, saldo), rt = ip.rt;
    return `<div class="cbx"><small>IVA aparte: <b class="num">${cbM(ip.iva, n)}</b>${rt ? " · retiene " + rt + " %" : ""}</small><button class="mini" data-cb="open" data-id="${esc(n.id)}">${rt ? "Retención" : "IVA y retención"}</button></div>`; }
  if(s) return `<div class="cbx"><span class="st low">Factura solicitada</span><button class="mini" data-cb="facnew" data-id="${esc(n.id)}">Ver o cambiar</button></div>`;
  return `<div class="cbx"><small>Sin factura legal</small><button class="mini" data-cb="facnew" data-id="${esc(n.id)}">Pedir factura legal</button></div>`;
}
/* en la pantalla de la nota: pedir la factura, o (ya facturada) IVA aparte, retención y comprobante */
function cbFacBox(n, x){
  const s = cbSolDe(n);
  if(!n.fac){
    return `<div class="box"><span class="lbl">Factura legal</span>` + (s
      ? `<div class="sel"><span><b>Factura solicitada</b><small>${esc(cbHora(s.t))}${s.cm ? " · " + esc(s.cm.slice(0, 80)) + (s.cm.length > 80 ? "…" : "") : ""}</small></span></div>
        <div class="f cbfa"><button class="txt" data-cb="facnew" data-id="${esc(n.id)}">Cambiar comentarios</button><button class="txt" data-cb="faccancel" data-id="${esc(s.id)}">Cancelar solicitud</button></div>`
      : `<p class="hint">Si el cliente necesita factura con IVA, pídela aquí. Con la factura, el monto de esta nota se entiende como neto y el IVA lo paga el cliente aparte.</p><button class="ghost" data-cb="facnew" data-id="${esc(n.id)}">PEDIR FACTURA LEGAL</button>`) + `</div>`;
  }
  const rr = cbRet(n) || {}, rt = rr.rt || 0, ip = cbIvaDe(n, x.saldo), cp = rt ? rr.cp || "" : "", chip = (k, l, cur, at) => `<button data-cb="${at}" data-id="${esc(n.id)}" data-k="${k}" aria-pressed="${cur === k}">${l}</button>`;
  return `<div class="box"><span class="lbl">Factura AdriMan ${esc(n.fac[0])}</span>
    <p class="hint">Nota facturada: el monto a cobrar es el neto. El IVA lo paga el cliente aparte.</p>
    <div class="cbsum"><div><span>Neto que falta</span><b class="num">${cbM(x.saldo, n)}</b></div><div><span>IVA ${IVAP} % de lo que falta</span><b class="num">${cbM(ip.iva, n)}</b></div>` +
    (rt ? `<div><span>Retención ${rt} % del IVA</span><b class="num">−${cbM(ip.ret, n)}</b></div><div class="big"><span>IVA que paga el cliente</span><b class="bs num">${cbM(ip.paga, n)}</b></div>` : "") + `</div>
    <span class="lbl">¿El cliente retiene IVA?</span>
    <div class="seg" role="group" aria-label="Retención de IVA">${chip(0, "No retiene", rt, "ret")}${chip(75, "Retiene 75 %", rt, "ret")}${chip(100, "Retiene 100 %", rt, "ret")}</div>` +
    (rt ? `<span class="lbl">Comprobante de retención</span>
    <p class="hint">Si el cliente retiene, hay que entregar el comprobante a administración. Dime cómo lo harás:</p>
    <div class="seg" role="group" aria-label="Comprobante">${chip("adjunto", "Subir aquí", cp, "cp")}${chip("whatsapp", "Por WhatsApp", cp, "cp")}${chip("fisico", "En físico", cp, "cp")}</div>` +
      (cp === "adjunto" ? `<input type="file" id="cbFile" accept="image/*,application/pdf" hidden><button class="ghost" data-cb="subir">${rr.url ? "SUBIR OTRO ARCHIVO" : "ELEGIR FOTO O PDF"}</button>
        <p class="hint">Elige la foto o el PDF desde la galería o los archivos del teléfono (por ejemplo, lo que te mandaron por WhatsApp).</p>` : "") +
      (CB.up ? `<div class="msg">${esc(CB.up)}</div>` : "") +
      (rr.rec ? `<div class="okb"><b>Recibido en administración</b>${esc(rr.rec)}</div>` : rr.url ? `<div class="okb"><b>Comprobante subido</b>Administración lo verá en su bandeja.</div>` : cp === "whatsapp" ? `<p class="hint">Mándalo por WhatsApp a administración con el número de la nota (${esc(n.num)}) y la factura (${esc(n.fac[0])}).</p>` : cp === "fisico" ? `<p class="hint">Llévalo a administración con el número de la nota (${esc(n.num)}) y la factura (${esc(n.fac[0])}).</p>` : "") : "") + `</div>`;
}
function cbFacHtml(){
  const n = cbNotas().find(x => x.id === CB.fac); if(!n){ CB.fac = null; return ""; }
  const s = cbSolDe(n);
  return `<button class="txt" data-cb="facx" style="justify-self:start">‹ Volver</button><h2 class="bs">Factura legal</h2>
    <div class="box"><div class="sel"><span><b>${esc(cbCliente(n.cid))}</b><small>Nota ${esc(n.num)}${esB(n) ? " · BCV" : ""}</small></span><span style="flex:none;text-align:right"><small>Neto de la nota</small><b class="bs num" style="font-size:26px">${cbM(cbNeto(n), n)}</b></span></div>
      <p class="hint">La solicitud le llega a administración dentro de la app, no por correo. El monto de la nota se entiende como neto; el IVA (${IVAP} %) lo paga el cliente aparte.</p></div>
    <div class="box"><label><span class="lbl">Comentarios o instrucciones (opcional)</span>
      <textarea class="fld" id="cb_fcm" maxlength="600" placeholder="Ej.: facturar a nombre de…, el cliente retiene IVA, entregar con la mercancía…">${esc(CB.facTxt)}</textarea></label>
      <small class="hint" id="cbFcn">${CB.facTxt.length} / 600</small><div class="cbe" id="cbFerr">${esc(CB.facErr)}</div>
      <button class="send" id="cbFgo" data-cb="facsend"${CB.facBusy ? " disabled" : ""}>${CB.facBusy ? "ENVIANDO…" : s ? "ACTUALIZAR SOLICITUD" : "ENVIAR SOLICITUD"}</button></div>`;
}
async function cbFacEnviar(){
  const n = cbNotas().find(x => x.id === CB.fac); if(!n || CB.facBusy) return;
  CB.facBusy = true; CB.facErr = ""; cobRender();
  try{
    const r = await cbSrv("solfac", { x:cbB64({ n:n.id, cm:CB.facTxt.trim().slice(0, 600) }) });
    if(r && r.estado === "ok"){ CB.sol = r.sol || []; cbSave(); CB.msgOk = "Solicitud de factura enviada · nota " + n.num; CB.fac = null; CB.facTxt = ""; CB.tab = "pend"; }
    else CB.facErr = r && r.estado === "no" ? "Este dispositivo ya no está autorizado. Habla con administración." : (r && r.msg) || "No se pudo enviar la solicitud.";
  }catch(e){ CB.facErr = "Sin conexión. Cuando tengas señal, vuelve a tocar «Enviar solicitud»."; }
  CB.facBusy = false; cobRender(); window.scrollTo(0, 0);
}
async function cbFacCancelar(id){
  try{ const r = await cbSrv("solcancel", { r:id }); if(r && r.estado === "ok"){ CB.sol = r.sol || []; cbSave(); } else CB.avisos.push((r && r.msg) || "No se pudo cancelar la solicitud."); }
  catch(e){ CB.avisos.push("Sin conexión: no se pudo cancelar la solicitud. Intenta de nuevo."); }
  cobRender();
}
/* retención: se ve al instante y se manda al receptor. rt = 0 | 75 | 100 (o null si solo cambia el comprobante); cp = adjunto | whatsapp | fisico (o null) */
async function cbRetSet(nid, rt, cp){
  const n = cbNotas().find(x => x.id === nid); if(!n) return; const cur = cbRet(n) || { rt:0, cp:"", url:"", rec:"" };
  const nuevo = Object.assign({}, cur, { n:nid, nn:n.num, cn:cbCliente(n.cid), fa:n.fac ? n.fac[0] : "", rt:rt != null ? rt : cur.rt, cp:(rt === 0 ? "" : cp != null ? cp : cur.cp) || "" });
  CB.ret = Object.assign({}, CB.ret, { [nid]: nuevo }); CB.up = ""; cbSave(); cobRender();
  try{
    const r = await cbSrv("ret", { x:cbB64({ n:nid, rt:nuevo.rt, cp:nuevo.cp === "adjunto" && !nuevo.url ? "" : nuevo.cp }) });
    if(r && r.estado === "ok" && r.ret){ CB.ret = Object.assign({}, r.ret, { [nid]: Object.assign({}, r.ret[nid] || nuevo, nuevo.cp === "adjunto" && !(r.ret[nid] || {}).url ? { cp:"adjunto" } : {}) }); cbSave(); }
    else CB.avisos.push((r && r.msg) || "No se pudo guardar la retención.");
  }catch(e){ CB.avisos.push("Sin conexión: la retención quedó marcada en este teléfono pero no llegó a administración. Vuelve a marcarla cuando tengas señal."); }
  cobRender();
}
/* foto o PDF → base64. Las fotos se reducen (lado mayor 1800 px, JPEG) para que la subida sea rápida con datos móviles */
function cbArchivo(f){
  return new Promise((res, rej) => {
    if(f.size > 12e6) return rej(new Error("El archivo pesa más de 12 MB."));
    if(f.type === "application/pdf"){
      if(f.size > 6e6) return rej(new Error("El PDF pesa más de 6 MB. Mándalo por WhatsApp."));
      const fr = new FileReader(); fr.onload = () => res({ tipo:"application/pdf", b64:String(fr.result).split(",")[1] }); fr.onerror = () => rej(new Error("No se pudo leer el archivo.")); fr.readAsDataURL(f); return; }
    if(!/^image\//.test(f.type)) return rej(new Error("Sube una foto o un PDF."));
    const url = URL.createObjectURL(f), im = new Image();
    im.onload = () => { const k = Math.min(1, 1800 / Math.max(im.width, im.height)), cv = document.createElement("canvas"); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
      const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      res({ tipo:"image/jpeg", b64:cv.toDataURL("image/jpeg", .82).split(",")[1] }); };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("No se pudo abrir la imagen. Si es un formato raro, haz una captura de pantalla o mándala por WhatsApp.")); };
    im.src = url;
  });
}
async function cbSubir(f){
  const n = cbNotas().find(x => x.id === CB.nota); if(!n || !f) return; const rt = (cbRet(n) || {}).rt || 0;
  if(!rt){ CB.avisos.push("Primero marca cuánto retiene el cliente (75 % o 100 %)."); cobRender(); return; }
  CB.up = "Subiendo el comprobante…"; cobRender();
  let cod = "", d = ""; try{ cod = localStorage.getItem(LSC) || ""; d = localStorage.getItem("ntx-disp") || ""; }catch(e){}
  try{
    const a = await cbArchivo(f);
    const res = await fetch(SCRIPT_URL, { method:"POST", headers:{ "Content-Type":"text/plain;charset=utf-8" }, redirect:"follow", body:JSON.stringify({ a:"ret", cod, d, x:{ n:n.id, rt }, nombre:f.name, tipo:a.tipo, b64:a.b64 }) });
    const r = JSON.parse(await res.text());
    if(r && r.estado === "ok" && r.ret){ CB.ret = r.ret; cbSave(); CB.up = ""; }
    else { CB.up = ""; CB.avisos.push(r && r.estado === "no" ? "Este dispositivo ya no está autorizado. Habla con administración." : (r && r.msg) || "No se pudo subir el comprobante."); }
  }catch(e){ CB.up = ""; CB.avisos.push(e && e.message && !/fetch|network|load failed/i.test(e.message) ? e.message : "Sin conexión: el comprobante no se subió. Inténtalo de nuevo con señal, o mándalo por WhatsApp."); }
  cobRender();
}

/* ---------- administración (solo la ve Mango: la llave viene dentro de sus datos cifrados) ---------- */
const AD = { sol:[], ret:[], tab:"sol", err:"", msg:"", busy:false, cargado:false };
async function admSrv(a, ex){
  const res = await fetch(SCRIPT_URL + "?" + new URLSearchParams(Object.assign({ a, k:S.adm }, ex || {})).toString(), { cache:"no-store", redirect:"follow" });
  return JSON.parse(await res.text());
}
function admBadge(){ const b = $("admN"); if(!b) return; const n = AD.sol.filter(q => q.est === "pendiente").length + AD.ret.filter(r => !r.rec).length; b.hidden = !n; b.textContent = n; }
function admAplica(r){ if(r && r.estado === "ok"){ AD.sol = r.sol || []; AD.ret = r.ret || []; AD.err = ""; AD.cargado = true; return true; } AD.err = (r && r.msg) || "No se pudo leer la bandeja."; return false; }
async function admCarga(){
  if(!S.adm) return; try{ admAplica(await admSrv("adm")); }catch(e){ AD.err = "Sin conexión."; }
  admBadge(); if(VISTA === "admin" && !document.activeElement.matches("input,textarea")) admRender();
}
function admAbre(){ AD.msg = ""; admRender(); admCarga(); }
async function admAcc(ex, msg){
  if(AD.busy) return; AD.busy = true; AD.msg = "";
  try{ if(admAplica(await admSrv("admacc", ex))) AD.msg = msg || ""; }catch(e){ AD.err = "Sin conexión: no se guardó. Intenta de nuevo."; }
  AD.busy = false; admBadge(); admRender();
}
function admCopia(txt){
  const ok = () => { AD.msg = "Copiado: pégalo en el chat con Claude"; admRender(); };
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, () => admRender());
  else { const t = document.createElement("textarea"); t.value = txt; t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select(); try{ document.execCommand("copy"); ok(); }catch(e){} t.remove(); }
}
const admTxt = q => "Factura fiscal " + q.nn + "\nCliente: " + q.cn + "\nVendedor: " + q.ven + (q.cm ? "\nInstrucciones del vendedor: " + q.cm : "\nSin instrucciones adicionales del vendedor.");
function admRender(){
  const el = $("vCob"); if(!el) return;
  if(!S.adm){ el.innerHTML = `<div class="box"><p class="hint">Esta sección es solo de administración.</p></div>`; return; }
  const ps = AD.sol.filter(q => q.est === "pendiente"), hs = AD.sol.filter(q => q.est !== "pendiente"), pr = AD.ret.filter(r => !r.rec), rr = AD.ret.filter(r => r.rec);
  const tabs = `<div class="seg tabs" role="group" aria-label="Administración">${[["sol", "Facturas" + (ps.length ? " (" + ps.length + ")" : "")], ["ret", "Retenciones" + (pr.length ? " (" + pr.length + ")" : "")]].map(([k, l]) => `<button data-ad="tab" data-k="${k}" aria-pressed="${AD.tab === k}">${l}</button>`).join("")}</div>`;
  const top = (AD.err ? `<div class="msg">${esc(AD.err)}</div>` : "") + (AD.msg ? `<div class="okb"><b>${esc(AD.msg)}</b></div>` : "");
  let h = tabs + top;
  if(AD.tab === "sol"){
    h += ps.length ? ps.map(q => `<article class="od"><div class="h"><b>${esc(q.cn)}</b><span class="st low">Por emitir</span></div>
      <div class="i num">Nota ${esc(q.nn)} · ${esc(q.ven)} · ${esc(cbHora(q.t))}</div>
      <div class="i" style="color:var(--ink)">${q.cm ? esc(q.cm) : "Sin instrucciones adicionales."}</div>
      <div class="f"><button class="txt" data-ad="copia" data-id="${esc(q.id)}">Copiar para Claude</button><button class="txt" data-ad="desc" data-id="${esc(q.id)}">Descartar</button></div></article>`).join("")
      : `<div class="box"><p class="hint">${AD.cargado ? "No hay solicitudes de factura por atender." : "Cargando…"}</p></div>`;
    if(hs.length) h += `<h2 class="bs" style="margin-top:6px">Atendidas</h2>` + hs.map(q => `<article class="od"><div class="h"><b>${esc(q.cn)}</b>${q.est === "emitida" ? `<span class="st ok">Emitida${q.fa ? " · " + esc(q.fa) : ""}</span>` : `<span class="st no">${q.est === "cancelada" ? "Cancelada" : "Descartada"}</span>`}</div>
      <div class="i num">Nota ${esc(q.nn)} · ${esc(q.ven)} · ${esc(cbHora(q.t))}</div>${q.cm ? `<div class="i">${esc(q.cm)}</div>` : ""}
      ${q.est === "descartada" ? `<div class="f"><button class="txt" data-ad="reab" data-id="${esc(q.id)}">Reabrir</button></div>` : ""}</article>`).join("");
    h += `<p class="hint">Al emitir la factura Claude marca la nota en Holded y la solicitud pasa sola a «Emitida» (se revisa cada hora).</p>`;
  } else {
    const via = r => r.cp === "adjunto" ? (r.url ? `<a class="txt" href="${esc(r.url)}" target="_blank" rel="noopener">Ver comprobante</a>` : "Dijo que lo sube, aún sin archivo") : r.cp === "whatsapp" ? "Lo envía por WhatsApp" : r.cp === "fisico" ? "Lo trae en físico" : "Aún no indica cómo lo entrega";
    const card = (r, ok) => `<article class="od"><div class="h"><b>${esc(r.cn)}</b><span class="st ${ok ? "ok" : "low"}">${ok ? "Recibido" : "Retiene " + r.rt + " %"}</span></div>
      <div class="i num">Nota ${esc(r.nn)}${r.fa ? " · Factura " + esc(r.fa) : ""} · ${esc(r.ven)}</div><div class="i">${ok ? "Recibido " + esc(r.rec) + " · " : "Retención " + r.rt + " % · "}${via(r)}</div>
      <div class="f">${ok ? `<button class="txt" data-ad="norec" data-id="${esc(r.n)}">Deshacer</button>` : `<button class="txt" data-ad="rec" data-id="${esc(r.n)}">Marcar recibido</button>`}</div></article>`;
    h += pr.length ? pr.map(r => card(r, false)).join("") : `<div class="box"><p class="hint">${AD.cargado ? "No hay comprobantes de retención por recibir." : "Cargando…"}</p></div>`;
    if(rr.length) h += `<h2 class="bs" style="margin-top:6px">Recibidos</h2>` + rr.map(r => card(r, true)).join("");
  }
  el.innerHTML = h;
}
$("vCob").addEventListener("click", e => {
  const a = e.target.closest("[data-ad]"); if(!a || VISTA !== "admin") return; const k = a.dataset.ad, id = a.dataset.id;
  if(k === "tab"){ AD.tab = a.dataset.k; AD.msg = ""; admRender(); }
  else if(k === "copia"){ const q = AD.sol.find(x => x.id === id); if(q) admCopia(admTxt(q)); }
  else if(k === "desc") admAcc({ s:id, e:"descartada" }, "Solicitud descartada");
  else if(k === "reab") admAcc({ s:id, e:"pendiente" }, "Solicitud reabierta");
  else if(k === "rec") admAcc({ r:id, e:"recibido" }, "Comprobante marcado como recibido");
  else if(k === "norec") admAcc({ r:id, e:"pendiente" }, "Marcado como pendiente otra vez");
});
setTimeout(() => { if(S.adm) admCarga(); }, 3000);
setInterval(() => { if(S.adm && !document.hidden) admCarga(); }, 180000);

/* ---------- eventos ---------- */
$("vCob").addEventListener("click", async e => {
  const a = e.target.closest("[data-cb]"); if(!a) return; const k = a.dataset.cb, top = () => window.scrollTo(0, 0);
  if(k === "tab"){ CB.tab = a.dataset.k; CB.del = null; CB.msgOk = ""; cobRender(); }
  else if(k === "solo"){ CB.solo = a.dataset.k === "true"; cobRender(); }
  else if(k === "open"){ CB.msgOk = ""; CB.nota = a.dataset.id; CB.edit = null; CB.del = null; CB.f = cbF0(); CB.err = ""; cobRender(); top(); }
  else if(k === "volver"){ CB.nota = null; CB.edit = null; CB.del = null; cobRender(); }
  else if(k === "listo"){ CB.ok = null; cobRender(); top(); }
  else if(k === "guardar") cbGuardar();
  else if(k === "fill"){
    const x = cbSaldoNota(); if(!x) return; const key = a.dataset.k, f = Object.assign({}, CB.f, { [key]:"" }), otros = cbCalc(x.n, f), rest = Math.max(0, x.saldo - otros.bv);
    let v = rest;
    if(esB(x.n) && key !== "bs"){ const dt = String(CB.f.dd || "").trim(); v = rest * (1 - (dt === "" ? DBCV : Math.max(0, Math.min(50, Number(dt.replace(",", ".")) || 0))) / 100); }
    CB.f[key] = v > 0 ? String(r2(v)).replace(".", ",") : ""; $("cb_" + key).value = CB.f[key]; cbSum();
  }
  else if(k === "rec"){ CB.rec = a.dataset.id; CB.del = null; cobRender(); top(); }
  else if(k === "recx"){ CB.rec = null; cobRender(); }
  else if(k === "facnew"){ const n = cbNotas().find(x => x.id === a.dataset.id); if(!n) return; const q = cbSolDe(n); CB.fac = n.id; CB.facTxt = q ? q.cm || "" : ""; CB.facErr = ""; CB.msgOk = ""; cobRender(); top(); }
  else if(k === "facx"){ CB.fac = null; cobRender(); }
  else if(k === "facsend") cbFacEnviar();
  else if(k === "faccancel") cbFacCancelar(a.dataset.id);
  else if(k === "ret") cbRetSet(a.dataset.id, Number(a.dataset.k), null);
  else if(k === "cp") cbRetSet(a.dataset.id, null, a.dataset.k);
  else if(k === "subir"){ const f = $("cbFile"); if(f) f.click(); }
  else if(k === "share") cbShare(a.dataset.id);
  else if(k === "edit"){
    const c = cbCobros().find(x => x.id === a.dataset.id); if(!c) return; const m = v => v ? String(v).replace(".", ",") : "";
    CB.nota = c.n; CB.edit = c.id; CB.del = null; CB.err = ""; CB.f = { ef:m(c.ef), us:m(c.us), ze:m(c.ze), bs:m(c.bs), ta:m(c.ta), rf:c.rf || "", dd:Number(c.dd) > 0 ? m(c.dd) : "" }; cobRender(); top();
  }
  else if(k === "editx"){ CB.edit = null; CB.f = cbF0(); CB.err = ""; cobRender(); }
  else if(k === "avok"){ CB.avisos.splice(Number(a.dataset.i), 1); cobRender(); }
  else if(k === "delask"){ CB.del = a.dataset.id; cobRender(); }
  else if(k === "delno"){ CB.del = null; cobRender(); }
  else if(k === "delok"){
    const c = cbCobros().find(x => x.id === a.dataset.id); CB.del = null; if(!c){ cobRender(); return; }
    if(c.est === "cola" || c.est === "rechazo"){ CB.cola = CB.cola.filter(x => x.id !== c.id); cbSave(); cobRender(); cobBadge(); return; }
    try{ const r = await cbSrv("anular", { r:c.rec }); if(r && r.estado === "ok" && Array.isArray(r.cobros)){ CB.cobros = r.cobros; cbSave(); } else CB.avisos.push((r && r.msg) || "No se pudo anular el cobro."); }
    catch(err){ CB.avisos.push("Sin conexión: no se pudo anular el cobro. Intenta de nuevo."); }
    cobRender(); cobBadge();
  }
});
$("vCob").addEventListener("change", e => { if(e.target.id === "cbFile" && e.target.files && e.target.files[0]){ const f = e.target.files[0]; e.target.value = ""; cbSubir(f); } });
$("vCob").addEventListener("input", e => { if(e.target.id === "cb_fcm"){ CB.facTxt = e.target.value; CB.facErr = ""; const c = $("cbFcn"), x = $("cbFerr"); if(c) c.textContent = CB.facTxt.length + " / 600"; if(x) x.textContent = ""; return; } const k = e.target.dataset && e.target.dataset.cbIn; if(!k) return; CB.f[k] = e.target.value; CB.err = ""; cbSum(); });
/* barra inferior: cambia de ambiente. PEDIDOS vuelve a donde estabas (catálogo, pedido o mis pedidos); COBRANZAS abre siempre en la lista. */
$("nav").addEventListener("click", e => {
  const b = e.target.closest("[data-nav]"); if(!b) return;
  if(b.dataset.nav === "adm"){ if(VISTA === "admin"){ admAbre(); window.scrollTo(0, 0); } else { CB.last = VISTA === "pedido" || VISTA === "enviados" ? VISTA : CB.last; go("admin"); } return; }
  if(b.dataset.nav === "cob"){ if(VISTA === "cobros"){ cobAbre(); window.scrollTo(0, 0); } else { CB.last = VISTA === "pedido" || VISTA === "enviados" ? VISTA : ""; go("cobros"); } }
  else go((VISTA === "cobros" || VISTA === "admin") && CB.last ? CB.last : "catalogo");
});
window.addEventListener("online", () => { cbLoad(); cbFlush().then(() => { if(VISTA === "cobros") cobRender(); cobBadge(); }); });
/* cobros guardados sin conexión: se intentan enviar al abrir el portal, sin esperar a que entren a Cobros */
setTimeout(() => { cbLoad(); if(CB.cola.length) cbFlush().then(cobBadge); }, 5000);
/* iPhone: al cerrarse el teclado, la pantalla puede quedar "corrida" y las barras fijas flotan a media pantalla.
   Mientras se escribe se oculta la barra inferior; al terminar se le da un empujón mínimo al scroll para que el teléfono recoloque todo. */
{ const esCampo = el => !!(el && el.matches && el.matches("input,textarea,select"));
  const recoloca = () => { if(esCampo(document.activeElement)) return; const y = window.scrollY; window.scrollTo(window.scrollX, y + 1); window.scrollTo(window.scrollX, y); };
  document.addEventListener("focusin", e => { if(esCampo(e.target) && e.target.type !== "checkbox") document.body.classList.add("tecl"); });
  document.addEventListener("focusout", () => { setTimeout(() => { if(!esCampo(document.activeElement)){ document.body.classList.remove("tecl"); recoloca(); setTimeout(recoloca, 300); } }, 80); });
  if(window.visualViewport) window.visualViewport.addEventListener("resize", () => setTimeout(recoloca, 60)); }
/* "Puesta de sol": en el catálogo, al deslizar hacia abajo la banda de arriba y la barra de abajo se retiran poco a poco hacia sus bordes
   (acompañan al dedo, no saltan); al deslizar hacia arriba regresan igual de suave, un poco más rápido. La barra roja del pedido baja al borde y sigue visible. */
const SOL = { f:0, v:0, y:0, t:false, a:false };
/* f = destino que marca el scroll; v = lo que se ve. v persigue a f un poco en cada cuadro de pantalla (unos 60 por segundo),
   así el movimiento es una pendiente continua aunque el teléfono avise del scroll a saltos. Se mueve cada barra directamente (sin recalcular toda la página). */
function solPinta(){
  const h = document.querySelector("header.top"), n = $("nav"), b = $("bar"), v = SOL.v, nh = n.offsetHeight || 0;
  h.style.transform = v ? "translate3d(0," + (-v * h.offsetHeight).toFixed(2) + "px,0)" : ""; h.style.opacity = v ? (1 - v * .35).toFixed(3) : "";
  n.style.transform = v ? "translate3d(0," + (v * nh).toFixed(2) + "px,0)" : ""; b.style.transform = v && !n.hidden ? "translate3d(0," + (v * nh).toFixed(2) + "px,0)" : "";
}
function solAnda(){
  if(SOL.a) return; SOL.a = true; let t0 = 0;
  /* suavizado por tiempo (no por cuadro): igual de fluido en pantallas de 60 y de 120 cuadros por segundo */
  const paso = t => { const dt = t0 ? Math.min(50, t - t0) : 16; t0 = t; const d = SOL.f - SOL.v;
    if(Math.abs(d) < 0.0015){ SOL.v = SOL.f; solPinta(); SOL.a = false; return; }
    SOL.v += d * (1 - Math.exp(-dt / 230)); solPinta(); requestAnimationFrame(paso); };
  requestAnimationFrame(paso);
}
function solCero(){ SOL.f = 0; SOL.y = Math.max(0, window.scrollY); solAnda(); }
window.addEventListener("scroll", () => {
  const y = Math.max(0, window.scrollY), max = document.documentElement.scrollHeight - window.innerHeight; let d = y - SOL.y; SOL.y = y;
  if((VISTA || "catalogo") !== "catalogo" || document.body.classList.contains("tecl") || y < 12){ if(SOL.f){ SOL.f = 0; solAnda(); } return; }
  if(y > max - 2 || !d) return;                       // rebote del final de la página en iPhone
  d = Math.max(-90, Math.min(90, d));                 // un salto programado no las esconde de golpe
  const f = Math.max(0, Math.min(1, SOL.f + (d > 0 ? d / 420 : d / 200)));
  if(f !== SOL.f){ SOL.f = f; solAnda(); } }, { passive:true });
document.addEventListener("focusin", solCero);
/*FIN-COBRANZAS*/
