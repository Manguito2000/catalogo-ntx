/*COBRANZAS*/
/* Pestaña Cobranzas del portal de ventas NTX (herramientas/COBRANZAS.md). Se inyecta en el catálogo con herramientas/aplicar_cobranzas.py.
   Datos: S.nt (notas del vendedor, vienen de datos.json) + cobros que anota el vendedor (los guarda y concilia el receptor de Apps Script). */
const CB = { tab:"pend", solo:false, nota:null, f:{ ef:"", us:"", ze:"", bs:"", ta:"", rf:"" }, err:"", busy:false, ok:null, cobros:null, cola:[], avisos:[], del:null, t0:0, img:{}, cargado:false, sync:"" };
const LSK = "ntx-cobros", LSQ = "ntx-cobros-cola", FACT = 0.85;
const r2 = n => Math.round(n * 100) / 100;
const cbNum = v => { const x = Number(String(v == null ? "" : v).replace(",", ".")); return isFinite(x) && x > 0 ? r2(x) : 0; };
const NT = r => ({ id:r[0], num:r[1], cid:r[2], fecha:r[3], vence:r[4], total:r[5], pagado:r[6], pend:r[7], tar:r[8], desc:r[9], real:r[10], pagos:r[12] || [] });
const cbNotas = () => (S.nt || []).map(NT);
const cbCliente = id => { const c = (S.clientes || []).find(x => x.id === id); return c ? c.n : "Cliente"; };
const cbLoad = () => {
  if(CB.cargado) return; CB.cargado = true;
  try{ CB.cobros = JSON.parse(localStorage.getItem(LSK) || "null"); }catch(e){ CB.cobros = null; }
  try{ CB.cola = JSON.parse(localStorage.getItem(LSQ) || "[]") || []; }catch(e){ CB.cola = []; }
};
const cbSave = () => { try{ localStorage.setItem(LSK, JSON.stringify(CB.cobros || [])); localStorage.setItem(LSQ, JSON.stringify(CB.cola || [])); }catch(e){} };
const cbCobros = () => { cbLoad(); const ids = new Set((CB.cobros || []).map(c => c.id)); return (CB.cobros || []).concat(CB.cola.filter(c => !ids.has(c.id))); };
const pendiente = c => c.est === "cobrado" || c.est === "revisar" || c.est === "cola";
function cbVisible(n){
  let pc = 0; const tengo = new Set(n.pagos.map(p => p[0]));
  cbCobros().forEach(c => {
    if(c.n !== n.id) return;
    if(pendiente(c)) pc += c.ab;
    else if(c.est === "confirmado" && (c.pg || []).some(p => !tengo.has(p[0]))) pc += c.ab;   // confirmado, pero los datos de Holded que tiene el teléfono aún no traen ese pago
  });
  pc = r2(pc); return { pc, saldo:Math.max(0, r2(n.real - pc)) };
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
  b.hidden = !v; b.textContent = v;
  const bt = $("btnCob"); if(bt) bt.hidden = !(EXT && S.rol === "vendedor" && (VISTA || "catalogo") === "catalogo");
}

/* ---------- pantallas ---------- */
function cobRender(){
  const el = $("vCob"); if(!el) return; cbLoad();
  if(!(EXT && S.rol === "vendedor")){ el.innerHTML = `<div class="box"><p class="hint">Entra con tu código para ver tus cobranzas.</p></div>`; return; }
  if(CB.ok){ el.innerHTML = cbOkHtml(); cbImgListo(CB.ok); return; }
  if(CB.nota){ el.innerHTML = cbFormHtml(); cbSum(); return; }
  const ne = cbCobros().filter(pendiente).length;
  const tabs = `<div class="seg tabs" role="group" aria-label="Cobranzas">${[["pend", "Pendientes"], ["ent", "Por entregar" + (ne ? " (" + ne + ")" : "")]].map(([k, l]) => `<button data-cb="tab" data-k="${k}" aria-pressed="${CB.tab === k}">${l}</button>`).join("")}</div>`;
  const av = CB.avisos.length ? CB.avisos.map((a, i) => `<div class="msg">${esc(a)} <button class="txt" data-cb="avok" data-i="${i}">Entendido</button></div>`).join("") : "";
  el.innerHTML = tabs + av + (CB.tab === "ent" ? cbEntHtml() : cbPendHtml());
}
function cbPendHtml(){
  if(!Array.isArray(S.nt)) return `<div class="box"><p class="hint">Todavía no hay datos de cobranzas en este teléfono. Se cargan en el próximo refresco de Holded (12:40 pm y 6:40 pm).</p></div>`;
  const todas = cbRows(), venc = todas.filter(x => x.d != null && x.d < 0 && x.saldo >= 0.01);
  const lista = CB.solo ? venc : todas;
  const sum = a => r2(a.reduce((s, x) => s + x.saldo, 0));
  let h = `<div class="cbs"><div><span class="lbl">Por cobrar</span><b class="bs num">${money(sum(todas))}</b><small>${todas.length} ${todas.length === 1 ? "nota" : "notas"}</small></div>
    <div class="v"><span class="lbl">Vencido</span><b class="bs num">${money(sum(venc))}</b><small>${venc.length} ${venc.length === 1 ? "nota" : "notas"}</small></div></div>
    <div class="seg" role="group" aria-label="Filtro" style="justify-self:start">${[[false, "Todas"], [true, "Solo vencidas"]].map(([k, l]) => `<button data-cb="solo" data-k="${k}" aria-pressed="${CB.solo === k}">${l}</button>`).join("")}</div>`;
  if(!lista.length) return h + `<div class="box"><p class="hint">${CB.solo ? "No tienes notas vencidas. " : "No tienes notas pendientes. "}Los datos de Holded se refrescan a las 12:40 pm y a las 6:40 pm.</p></div>`;
  const g = {}; lista.forEach(x => (g[x.n.cid] = g[x.n.cid] || []).push(x));
  const ids = Object.keys(g).sort((a, b) => (g[b].some(x => x.d != null && x.d < 0) - g[a].some(x => x.d != null && x.d < 0)) || cbCliente(a).localeCompare(cbCliente(b), "es"));
  ids.forEach(id => {
    const rows = g[id].sort((a, b) => (a.n.fecha || 0) - (b.n.fecha || 0));
    h += `<section class="cbg"><div class="cbh"><b>${esc(cbCliente(id))}</b><span class="bs num">${money(sum(rows))}</span></div>` + rows.map(x => {
      const vc = x.d != null && x.d < 0;
      return `<button class="cbr" data-cb="open" data-id="${esc(x.n.id)}"><span><span class="n bs">${esc(x.n.num)}</span> ${x.n.tar === "b" ? `<span class="tg">BCV</span>` : ""}<br><small>${esc(cbFecha(x.n.fecha))}${x.d != null ? " · " : ""}<span class="${vc ? "ven" : ""}">${esc(cbVTxt(x.d))}</span></small></span>
        <span class="r"><span class="s bs num">${money(x.saldo)}</span>${x.n.tar === "b" && x.saldo >= 0.01 ? `<br><small>En Bs: ${money(x.saldo / FACT)}</small>` : ""}${x.pc >= 0.01 ? `<br><small class="pc">Abono por confirmar ${money(x.pc)}</small>` : ""}</span></button>`;
    }).join("") + `</section>`;
  });
  return h + `<p class="hint">Saldos de Holded al ${S.fecha ? esc(new Date(S.fecha).toLocaleString("es-VE", { day:"2-digit", month:"short", hour:"numeric", minute:"2-digit" })) : "último refresco"}${CB.sync ? " · " + esc(CB.sync) : ""}. Lo que cobres hoy aparece como «abono por confirmar» hasta que administración lo registre.</p>`;
}
function cbMetodos(c){ return [["Efectivo", c.ef], ["USDT", c.us], ["Zelle", c.ze], ["Bs", c.bs]].filter(x => x[1] > 0).map(x => x[0] + " " + money(x[1])).join(" · "); }
function cbEntHtml(){
  const todos = cbCobros().filter(c => c.est !== "anulado").sort((a, b) => (b.t || 0) - (a.t || 0)), pend = todos.filter(pendiente), conf = todos.filter(c => c.est === "confirmado");
  const T = k => r2(pend.reduce((s, c) => s + (c[k] || 0), 0));
  let h = `<div class="box"><span class="lbl">Efectivo que debes entregar</span><b class="bs num" style="font-size:38px;line-height:1">${money(T("ef"))}</b>
    <small class="hint">USDT ${money(T("us"))} · Zelle ${money(T("ze"))} · Bolívares ${money(T("bs"))} (en $) · ${pend.length} ${pend.length === 1 ? "cobro" : "cobros"} por confirmar</small></div>`;
  const card = c => {
    const st = c.est === "confirmado" ? `<span class="st ok">Confirmado</span>` : c.est === "revisar" ? `<span class="st low">Revisar</span>` : c.est === "cola" ? `<span class="st no">Sin enviar</span>` : `<span class="st low">Por confirmar</span>`;
    const d = c.t ? new Date(c.t * 1000).toLocaleString("es-VE", { day:"2-digit", month:"short", hour:"numeric", minute:"2-digit" }) : "";
    const sure = CB.del === c.id;
    return `<article class="od"><div class="h"><b>${esc(c.cn || "Cliente")}</b>${st}</div>
      <div class="i num">${esc(c.rec || "Sin número aún")} · Nota ${esc(c.nn || "")} · ${esc(d)}</div><div class="i num">${esc(cbMetodos(c))}${c.ta ? " · tasa " + c.ta : ""}${c.rf ? " · ref. " + esc(c.rf) : ""}</div>
      ${c.est === "revisar" && c.obs ? `<div class="i" style="color:var(--warn)">${esc(c.obs)}</div>` : ""}
      <div class="f"><span class="pr bs num">${money(c.nom)}</span>${c.rec ? `<button class="txt" data-cb="rec" data-id="${esc(c.id)}">Recibo</button>` : ""}
      ${c.est === "confirmado" ? "" : sure ? `<button class="txt" data-cb="delok" data-id="${esc(c.id)}">Sí, anular</button><button class="txt" data-cb="delno" style="color:var(--mut)">No</button>` : `<button class="txt" data-cb="delask" data-id="${esc(c.id)}">${c.est === "cola" ? "Descartar" : "Anular"}</button>`}</div></article>`;
  };
  h += pend.length ? pend.map(card).join("") : `<div class="box"><p class="hint">No tienes cobros por entregar. Cuando cobres, anótalo desde la pestaña Pendientes.</p></div>`;
  if(conf.length) h += `<h2 class="bs" style="margin-top:6px">Confirmados esta semana</h2>` + conf.map(card).join("");
  return h;
}
function cbSaldoNota(){ const n = cbNotas().find(x => x.id === CB.nota); return n ? Object.assign({ n }, cbVisible(n)) : null; }
function cbFormHtml(){
  const x = cbSaldoNota(); if(!x){ CB.nota = null; return ""; }
  const bcv = x.n.tar === "b", F = (k, l, extra) => `<label><span>${l}<button type="button" class="txt fill" data-cb="fill" data-k="${k}">Completar saldo</button></span><input class="fld num" id="cb_${k}" data-cb-in="${k}" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(CB.f[k])}"></label>`;
  return `<button class="txt" data-cb="volver" style="justify-self:start">‹ Volver a pendientes</button><h2 class="bs">Registrar cobro</h2>
    <div class="box"><div class="sel"><span><b>${esc(cbCliente(x.n.cid))}</b><small>${esc(x.n.num)}${bcv ? " · BCV" : ""} · ${esc(cbVTxt(cbVence(x.n)) || "sin vencimiento")}</small></span><b class="bs num" style="font-size:26px">${money(x.saldo)}</b></div>
      ${bcv ? `<p class="hint">Nota BCV: lo que el cliente paga en bolívares abona el 85 % (cada $100 cobrados en Bs abonan $85). En efectivo, USDT o Zelle abona 1 a 1. Escribe siempre lo que el cliente te dio, en dólares.</p>` : `<p class="hint">Escribe lo que el cliente te dio, en dólares, por cada forma de pago.</p>`}
      <div class="cbf">${F("ef", "Efectivo $")}${F("us", "USDT $")}${F("ze", "Zelle $")}${F("bs", bcv ? "Bolívares (monto en $)" : "Bolívares (monto en $)")}
        <label id="cbTa" hidden><span>Tasa Bs por $ (la que acordaste)</span><input class="fld num" id="cb_ta" data-cb-in="ta" type="text" inputmode="decimal" autocomplete="off" placeholder="Ej. 1080" value="${esc(CB.f.ta)}"></label>
        <label><span>Referencia o comprobante (opcional)</span><input class="fld" id="cb_rf" data-cb-in="rf" type="text" autocomplete="off" maxlength="120" placeholder="Últimos dígitos, nombre del banco…" value="${esc(CB.f.rf)}"></label></div>
      <div class="cbsum" id="cbSum"></div><div class="cbe" id="cbErr"></div>
      <button class="send" id="cbGo" data-cb="guardar">GUARDAR COBRO</button></div>`;
}
function cbCalc(n, f){
  const ef = cbNum(f.ef), us = cbNum(f.us), ze = cbNum(f.ze), bs = cbNum(f.bs), nom = r2(ef + us + ze + bs), ab = r2(ef + us + ze + bs * (n.tar === "b" ? FACT : 1));
  return { ef, us, ze, bs, nom, ab };
}
function cbSum(){
  const x = cbSaldoNota(), s = $("cbSum"); if(!x || !s) return;
  const c = cbCalc(x.n, CB.f), resto = r2(x.saldo - c.ab), ta = $("cbTa"); if(ta) ta.hidden = !(c.bs > 0 && x.n.tar !== "b");
  const sobra = c.ab > x.saldo + 0.5;
  s.innerHTML = `<div><span>Cobrado</span><b class="num">${money(c.nom)}</b></div><div><span>Abona a la nota</span><b class="num">${money(c.ab)}</b></div><div class="big"><span>Quedaría por cobrar</span><b class="bs num">${money(Math.max(0, resto))}</b></div>`;
  $("cbGo").disabled = c.nom <= 0 || sobra || CB.busy; $("cbGo").textContent = CB.busy ? "GUARDANDO…" : "GUARDAR COBRO";
  $("cbErr").textContent = sobra ? "Eso es más de lo que falta de la nota (" + money(x.saldo) + ")." : CB.err;
}
function cbOkHtml(){
  const c = CB.ok.cobro, n = cbNotas().find(x => x.id === c.n), sc = n ? cbVisible(n).saldo : 0;
  return `<div class="okb"><b>${c.rec ? "Cobro " + esc(c.rec) + " guardado" : "Cobro guardado en este teléfono"}</b>${esc(c.cn || "")} · Nota ${esc(c.nn || "")}\n${money(c.nom)} cobrados${n ? " · quedan " + money(sc) + " por cobrar de la nota" : ""}${c.est === "cola" ? "\nSin conexión: se enviará solo cuando vuelva el internet. El número de recibo llega entonces." : ""}</div>
    ${c.rec ? `<button class="send" data-cb="rec" data-id="${esc(c.id)}">ENVIAR RECIBO AL CLIENTE</button>` : ""}<button class="ghost" data-cb="listo">Listo</button>`;
}

/* ---------- servidor ---------- */
async function cbSrv(a, ex){
  let cod = "", d = ""; try{ cod = localStorage.getItem(LSC) || ""; d = localStorage.getItem("ntx-disp") || ""; }catch(e){}
  const q = new URLSearchParams(Object.assign({ a, cod, d }, ex || {}));
  const r = await fetch(SCRIPT_URL + "?" + q.toString(), { cache:"no-store", redirect:"follow" });
  return await r.json();
}
const cbB64 = o => { const b = new TextEncoder().encode(JSON.stringify(o)); let s = ""; b.forEach(x => s += String.fromCharCode(x)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const cbUid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
function cbMerge(c){ CB.cobros = [c].concat((CB.cobros || []).filter(x => x.id !== c.id)); cbSave(); }
/* devuelve {ok, cobro} | {err} (el servidor lo rechazó) | {net:true} (sin conexión) */
async function cbEnviar(o){
  let r;
  try{ r = await cbSrv("cobro", { c:cbB64({ id:o.id, n:o.n, ef:o.ef, us:o.us, ze:o.ze, bs:o.bs, ab:o.ab, ta:o.ta || 0, rf:o.rf || "", cn:o.cn }) }); }catch(e){ return { net:true }; }
  if(r && r.estado === "ok" && r.cobro) return { ok:true, cobro:r.cobro };
  if(r && r.estado === "no") return { err:"Este dispositivo ya no está autorizado. Habla con administración." };
  return { err:(r && r.msg) || "No se pudo guardar el cobro." };
}
async function cbFlush(){
  if(CB.flushing || !CB.cola.length) return; CB.flushing = true;
  for(const o of CB.cola.slice()){
    const r = await cbEnviar(o); if(r.net) break;
    CB.cola = CB.cola.filter(x => x.id !== o.id);
    if(r.ok) cbMerge(r.cobro); else CB.avisos.push("El cobro de " + (o.cn || "un cliente") + " (" + money(o.nom) + ") no se pudo registrar: " + r.err);
  }
  cbSave(); CB.flushing = false;
}
async function cbRefresca(){
  CB.sync = "";
  await cbFlush();
  try{ const r = await cbSrv("cobros"); if(r && r.estado === "ok" && Array.isArray(r.cobros)){ CB.cobros = r.cobros; cbSave(); } else if(r && r.estado === "no") CB.sync = "este dispositivo no está autorizado para cobros"; }
  catch(e){ CB.sync = "sin conexión: se muestra lo último guardado"; }
  if(Date.now() - CB.t0 > 3e5){
    CB.t0 = Date.now();
    try{ const r = await fetch("datos.json?" + Date.now(), { cache:"no-store" }); if(r.ok){ const j = await r.json(); if(j && Array.isArray(j.v) && j.v.length){ VENDS = j.v; if(window.NTX_PASE) await unlock(window.NTX_PASE); } } }catch(e){}
  }
  if(VISTA === "cobros" && !CB.nota && !CB.ok && !document.activeElement.matches("input")) cobRender();
  cobBadge();
}
function cobAbre(){ cbLoad(); CB.nota = null; CB.ok = null; CB.del = null; CB.tab = CB.tab || "pend"; cobRender(); cobBadge(); cbRefresca(); }

/* ---------- guardar ---------- */
async function cbGuardar(){
  const x = cbSaldoNota(); if(!x || CB.busy) return; const c = cbCalc(x.n, CB.f);
  if(c.nom <= 0 || c.ab > x.saldo + 0.5) return;
  CB.err = ""; CB.busy = true; cbSum();
  const o = { id:cbUid(), n:x.n.id, nn:x.n.num, cn:cbCliente(x.n.cid), t:Math.floor(Date.now() / 1000), nom:c.nom, ab:c.ab, ef:c.ef, us:c.us, ze:c.ze, bs:c.bs, ta:c.bs > 0 && x.n.tar !== "b" ? cbNum(CB.f.ta) : 0, rf:(CB.f.rf || "").trim().slice(0, 120), est:"cola" };
  const r = await cbEnviar(o); CB.busy = false;
  if(r.err){ CB.err = r.err; cbSum(); return; }
  let cobro;
  if(r.ok){ cobro = r.cobro; cbMerge(cobro); } else { cobro = o; CB.cola.push(o); cbSave(); }
  CB.f = { ef:"", us:"", ze:"", bs:"", ta:"", rf:"" }; CB.nota = null; CB.ok = { cobro }; cobRender(); cobBadge(); window.scrollTo(0, 0);
}

/* ---------- recibo (imagen + texto) ---------- */
function cbReciboTxt(c){
  const n = cbNotas().find(x => x.id === c.n); let saldo = n ? cbVisible(n).saldo : null; if(saldo != null && n.tar === "b") saldo = saldo / FACT;
  return `Recibo ${c.rec} · ${c.cn} · Nota ${c.nn} · Cobrado ${money(c.nom)}${saldo != null ? " · Saldo " + money(saldo) : ""}\nRecibo sujeto a verificación. NTX Original Parts`;
}
function cbImg(c){
  return new Promise(res => {
    const n = cbNotas().find(x => x.id === c.n); let saldo = n ? cbVisible(n).saldo : null; if(saldo != null && n.tar === "b") saldo = saldo / FACT;
    const W = 900, filas = [["Cliente", c.cn || ""], ["Nota", c.nn || ""]].concat([["Efectivo", c.ef], ["USDT", c.us], ["Zelle", c.ze], ["Bolívares (en $)", c.bs]].filter(x => x[1] > 0).map(x => [x[0], money(x[1])]));
    if(c.ta) filas.push(["Tasa", String(c.ta)]); if(c.rf) filas.push(["Referencia", c.rf]);
    const H = 330 + filas.length * 62 + 250, cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
    const dibuja = logo => {
      g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.fillStyle = "#16161A"; g.fillRect(0, 0, W, 190);
      if(logo){ const h = 86, w = logo.width * h / logo.height; g.drawImage(logo, 50, 52, w, h); }
      g.fillStyle = "#fff"; g.textAlign = "right"; g.font = "800 40px Inter,Arial,sans-serif"; g.fillText("RECIBO DE COBRO", W - 50, 92); g.font = "700 34px Inter,Arial,sans-serif"; g.fillStyle = "#E3222C"; g.fillText(c.rec, W - 50, 144);
      g.textAlign = "left"; g.fillStyle = "#55575C"; g.font = "600 28px Inter,Arial,sans-serif"; g.fillText(c.t ? new Date(c.t * 1000).toLocaleString("es-VE", { day:"2-digit", month:"long", year:"numeric", hour:"numeric", minute:"2-digit" }) : "", 50, 250);
      let y = 330; g.font = "600 30px Inter,Arial,sans-serif";
      filas.forEach(f => { g.fillStyle = "#55575C"; g.textAlign = "left"; g.fillText(f[0], 50, y); g.fillStyle = "#16161A"; g.textAlign = "right"; g.font = "700 30px Inter,Arial,sans-serif"; let t = String(f[1]); while(g.measureText(t).width > W - 330 && t.length > 4) t = t.slice(0, -2); g.fillText(t === String(f[1]) ? t : t + "…", W - 50, y); g.font = "600 30px Inter,Arial,sans-serif"; g.fillStyle = "#E3E5E8"; g.fillRect(50, y + 22, W - 100, 2); y += 62; });
      y += 30; g.fillStyle = "#55575C"; g.textAlign = "left"; g.font = "700 28px Inter,Arial,sans-serif"; g.fillText("TOTAL COBRADO", 50, y); g.fillStyle = "#16161A"; g.textAlign = "right"; g.font = "800 68px Inter,Arial,sans-serif"; g.fillText(money(c.nom), W - 50, y + 4);
      if(saldo != null){ y += 70; g.fillStyle = "#55575C"; g.textAlign = "left"; g.font = "600 28px Inter,Arial,sans-serif"; g.fillText("Saldo pendiente de la nota", 50, y); g.fillStyle = "#16161A"; g.textAlign = "right"; g.font = "700 32px Inter,Arial,sans-serif"; g.fillText(money(saldo), W - 50, y); }
      g.fillStyle = "#55575C"; g.textAlign = "center"; g.font = "500 24px Inter,Arial,sans-serif"; g.fillText("Recibo sujeto a verificación por administración", W / 2, H - 56);
      cv.toBlob(b => res(b), "image/png");
    };
    const im = new Image(); im.onload = () => dibuja(im); im.onerror = () => dibuja(null); im.src = "img/logo.png";
  });
}
function cbImgListo(o){ const c = o.cobro; if(c.rec && !CB.img[c.id]) cbImg(c).then(b => { CB.img[c.id] = b; }); }
async function cbRecibo(id){
  const c = cbCobros().find(x => x.id === id); if(!c || !c.rec) return; const txt = cbReciboTxt(c);
  try{
    const blob = CB.img[c.id] || await cbImg(c); CB.img[c.id] = blob; const file = new File([blob], "Recibo " + c.rec + ".png", { type:"image/png" });
    if(navigator.canShare && navigator.canShare({ files:[file] })){ await navigator.share({ files:[file], text:txt }); return; }
  }catch(e){ if(e && e.name === "AbortError") return; }
  window.open("https://wa.me/?text=" + encodeURIComponent(txt), "_blank");
}

/* ---------- eventos ---------- */
$("vCob").addEventListener("click", async e => {
  const a = e.target.closest("[data-cb]"); if(!a) return; const k = a.dataset.cb;
  if(k === "tab"){ CB.tab = a.dataset.k; CB.del = null; cobRender(); }
  else if(k === "solo"){ CB.solo = a.dataset.k === "true"; cobRender(); }
  else if(k === "open"){ CB.nota = a.dataset.id; CB.f = { ef:"", us:"", ze:"", bs:"", ta:"", rf:"" }; CB.err = ""; cobRender(); window.scrollTo(0, 0); }
  else if(k === "volver"){ CB.nota = null; cobRender(); }
  else if(k === "listo"){ CB.ok = null; cobRender(); }
  else if(k === "guardar") cbGuardar();
  else if(k === "fill"){
    const x = cbSaldoNota(); if(!x) return; const f = Object.assign({}, CB.f, { [a.dataset.k]:"" }), otros = cbCalc(x.n, f), rest = Math.max(0, x.saldo - otros.ab);
    const v = a.dataset.k === "bs" && x.n.tar === "b" ? rest / FACT : rest; CB.f[a.dataset.k] = v > 0 ? String(r2(v)).replace(".", ",") : ""; $("cb_" + a.dataset.k).value = CB.f[a.dataset.k]; cbSum();
  }
  else if(k === "rec") cbRecibo(a.dataset.id);
  else if(k === "avok"){ CB.avisos.splice(Number(a.dataset.i), 1); cobRender(); }
  else if(k === "delask"){ CB.del = a.dataset.id; cobRender(); }
  else if(k === "delno"){ CB.del = null; cobRender(); }
  else if(k === "delok"){
    const c = cbCobros().find(x => x.id === a.dataset.id); CB.del = null; if(!c){ cobRender(); return; }
    if(c.est === "cola"){ CB.cola = CB.cola.filter(x => x.id !== c.id); cbSave(); cobRender(); cobBadge(); return; }
    try{ const r = await cbSrv("anular", { r:c.rec }); if(r && r.estado === "ok" && Array.isArray(r.cobros)){ CB.cobros = r.cobros; cbSave(); } else CB.avisos.push((r && r.msg) || "No se pudo anular el cobro."); }
    catch(err){ CB.avisos.push("Sin conexión: no se pudo anular el cobro. Intenta de nuevo."); }
    cobRender(); cobBadge();
  }
});
$("vCob").addEventListener("input", e => { const k = e.target.dataset && e.target.dataset.cbIn; if(!k) return; CB.f[k] = e.target.value; CB.err = ""; cbSum(); });
$("btnCob").addEventListener("click", () => go("cobros"));
window.addEventListener("online", () => { cbLoad(); cbFlush().then(() => { if(VISTA === "cobros") cobRender(); cobBadge(); }); });
/* cobros guardados sin conexión: se intentan enviar al abrir el portal, sin esperar a que entren a Cobros */
setTimeout(() => { cbLoad(); if(CB.cola.length) cbFlush().then(cobBadge); }, 5000);
/*FIN-COBRANZAS*/
