/*COBRANZAS*/
/* Pestaña Cobranzas del portal de ventas NTX (herramientas/COBRANZAS.md). Se inyecta en el catálogo con herramientas/aplicar_cobranzas.py.
   Datos: S.nt (notas del vendedor, vienen de datos.json) + cobros que anota el vendedor (los guarda y concilia el receptor de Apps Script). */
const CB = { tab:"pend", solo:false, nota:null, edit:null, rec:null, last:"", url:{}, f:{ ef:"", us:"", ze:"", bs:"", ta:"", rf:"" }, err:"", busy:false, ok:null, cobros:null, cola:[], avisos:[], del:null, t0:0, img:{}, cargado:false, sync:"" };
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
  b.hidden = !v; b.textContent = v; cobNav(VISTA || "catalogo");
}
/* barra inferior del portal: PEDIDOS | COBRANZAS. Es el único sitio desde donde se cambia de ambiente. */
function cobNav(v){
  const on = EXT && S.rol === "vendedor", c = v === "cobros"; $("nav").hidden = !on; document.body.classList.toggle("con-nav", on);
  if(v !== "catalogo") solCero();
  $("navCob").setAttribute("aria-current", c ? "page" : "false"); $("navPed").setAttribute("aria-current", c ? "false" : "page");
}
const cbF0 = () => ({ ef:"", us:"", ze:"", bs:"", ta:"", rf:"" });
const cbSt = c => c.est === "confirmado" ? `<span class="st ok">Confirmado</span>` : c.est === "revisar" ? `<span class="st low">Revisar</span>` : c.est === "cola" ? `<span class="st no">Sin enviar</span>` : `<span class="st low">Por confirmar</span>`;
const cbHora = t => t ? new Date(t * 1000).toLocaleString("es-VE", { day:"2-digit", month:"short", hour:"numeric", minute:"2-digit" }) : "";
/* acciones de un cobro: ver recibo siempre; corregir o anular solo mientras administración no lo haya confirmado */
function cbAcc(c){
  const pe = pendiente(c), sure = CB.del === c.id, hay = cbNotas().some(n => n.id === c.n);
  return (c.rec ? `<button class="txt" data-cb="rec" data-id="${esc(c.id)}">Recibo</button>` : "") +
    (!pe ? "" : sure ? `<button class="txt" data-cb="delok" data-id="${esc(c.id)}">Sí, anular</button><button class="txt" data-cb="delno" style="color:var(--mut)">No</button>`
      : (hay ? `<button class="txt" data-cb="edit" data-id="${esc(c.id)}">Corregir</button>` : "") + `<button class="txt" data-cb="delask" data-id="${esc(c.id)}">${c.est === "cola" ? "Descartar" : "Anular"}</button>`);
}

/* ---------- pantallas ---------- */
function cobRender(){
  const el = $("vCob"); if(!el) return; cbLoad();
  if(!(EXT && S.rol === "vendedor")){ el.innerHTML = `<div class="box"><p class="hint">Entra con tu código para ver tus cobranzas.</p></div>`; return; }
  const av = CB.avisos.length ? CB.avisos.map((a, i) => `<div class="msg">${esc(a)} <button class="txt" data-cb="avok" data-i="${i}">Entendido</button></div>`).join("") : "";
  if(CB.ok){ el.innerHTML = av + cbOkHtml(); cbRecPinta(CB.ok.cobro); return; }
  if(CB.rec){ const c = cbCobros().find(x => x.id === CB.rec);
    if(c && c.rec){ el.innerHTML = av + `<button class="txt" data-cb="recx" style="justify-self:start">‹ Volver</button><h2 class="bs">Recibo ${esc(c.rec)}</h2>` + cbRecHtml(c); cbRecPinta(c); return; }
    CB.rec = null; }
  if(CB.nota){ const h = cbFormHtml(); if(h){ el.innerHTML = av + h; if($("cbSum")) cbSum(); return; } }
  const ne = cbCobros().filter(pendiente).length;
  const tabs = `<div class="seg tabs" role="group" aria-label="Cobranzas">${[["pend", "Pendientes"], ["ent", "Por entregar" + (ne ? " (" + ne + ")" : "")]].map(([k, l]) => `<button data-cb="tab" data-k="${k}" aria-pressed="${CB.tab === k}">${l}</button>`).join("")}</div>`;
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
  const card = c => `<article class="od"><div class="h"><b>${esc(c.cn || "Cliente")}</b>${cbSt(c)}</div>
      <div class="i num">${esc(c.rec || "Sin número")} · Nota ${esc(c.nn || "")} · ${esc(cbHora(c.t))}</div><div class="i num">${esc(cbMetodos(c))}${c.ta ? " · tasa " + c.ta : ""}${c.rf ? " · ref. " + esc(c.rf) : ""}</div>
      ${c.est === "revisar" && c.obs ? `<div class="i" style="color:var(--warn)">${esc(c.obs)}</div>` : ""}
      <div class="f"><span class="pr bs num">${money(c.nom)}</span>${cbAcc(c)}</div></article>`;
  h += pend.length ? pend.map(card).join("") : `<div class="box"><p class="hint">No tienes cobros por entregar. Cuando cobres, anótalo desde la pestaña Pendientes.</p></div>`;
  if(conf.length) h += `<h2 class="bs" style="margin-top:6px">Confirmados esta semana</h2>` + conf.map(card).join("");
  return h;
}
function cbSaldoNota(){
  const n = cbNotas().find(x => x.id === CB.nota); if(!n) return null; const x = Object.assign({ n }, cbVisible(n));
  const ed = CB.edit ? cbCobros().find(c => c.id === CB.edit && c.n === n.id && pendiente(c)) : null;
  if(ed){ x.pc = Math.max(0, r2(x.pc - ed.ab)); x.saldo = Math.max(0, r2(n.real - x.pc)); x.ed = ed; } else CB.edit = null;   // al corregir, el cobro viejo se anula: su monto vuelve a estar disponible
  return x;
}
/* pantalla de una nota: su saldo, los abonos ya anotados (con recibo, corregir y anular) y, si aún falta por cobrar, el formulario */
function cbFormHtml(){
  const x = cbSaldoNota(); if(!x){ CB.nota = null; CB.edit = null; return ""; }
  const bcv = x.n.tar === "b", ed = x.ed, F = (k, l) => `<label><span>${l}<button type="button" class="txt fill" data-cb="fill" data-k="${k}">Completar saldo</button></span><input class="fld num" id="cb_${k}" data-cb-in="${k}" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(CB.f[k])}"></label>`;
  const mios = cbCobros().filter(c => c.n === x.n.id && c.est !== "anulado" && !(ed && c.id === ed.id)).sort((a, b) => (b.t || 0) - (a.t || 0));
  let h = `<button class="txt" data-cb="${ed ? "editx" : "volver"}" style="justify-self:start">‹ ${ed ? "Dejar el cobro como estaba" : "Volver a pendientes"}</button><h2 class="bs">${ed ? "Corregir cobro" : "Nota " + esc(x.n.num)}</h2>
    <div class="box"><div class="sel"><span><b>${esc(cbCliente(x.n.cid))}</b><small>${esc(x.n.num)}${bcv ? " · BCV" : ""} · ${esc(cbVTxt(cbVence(x.n)) || "sin vencimiento")}</small></span><span style="flex:none;text-align:right"><small>Falta por cobrar</small><b class="bs num" style="font-size:26px">${money(x.saldo)}</b></span></div>
      ${x.pc >= 0.01 ? `<p class="hint num">En Holded faltan ${money(x.n.real)} · ya anotaste ${money(x.pc)} por confirmar</p>` : ""}</div>`;
  if(mios.length && !ed) h += `<div class="box"><span class="lbl">Abonos que anotaste</span>` + mios.map(c => `<div class="cba"><div class="h"><b class="bs num">${money(c.nom)}</b>${cbSt(c)}</div>
      <div class="i num">${esc(c.rec || "Sin número")} · ${esc(cbHora(c.t))} · ${esc(cbMetodos(c))}${c.ab !== c.nom ? " · abona " + money(c.ab) : ""}</div>${c.est === "revisar" && c.obs ? `<div class="i" style="color:var(--warn)">${esc(c.obs)}</div>` : ""}
      <div class="f">${cbAcc(c)}</div></div>`).join("") + `</div>`;
  if(x.saldo < 0.01 && !ed) return h + `<div class="box"><p class="hint">Esta nota ya está cobrada por completo. Sale de tu lista cuando administración registre el pago en Holded. Si te equivocaste en un monto, toca «Corregir» en el abono.</p></div>`;
  return h + `<div class="box"><span class="lbl">${ed ? "Montos corregidos" : mios.length ? "Registrar otro cobro" : "Registrar cobro"}</span>
      ${ed ? `<p class="hint">Al guardar se anula el recibo ${esc(ed.rec || "anterior")} y se crea uno nuevo con estos montos. Si ya le enviaste el recibo al cliente, envíale el nuevo.</p>` : ""}
      ${bcv ? `<p class="hint">Nota BCV: lo que el cliente paga en bolívares abona el 85 % (cada $100 cobrados en Bs abonan $85). En efectivo, USDT o Zelle abona 1 a 1. Escribe siempre lo que el cliente te dio, en dólares.</p>` : `<p class="hint">Escribe lo que el cliente te dio, en dólares, por cada forma de pago.</p>`}
      <div class="cbf">${F("ef", "Efectivo $")}${F("us", "USDT $")}${F("ze", "Zelle $")}${F("bs", "Bolívares (monto en $)")}
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
  $("cbGo").disabled = c.nom <= 0 || sobra || CB.busy; $("cbGo").textContent = CB.busy ? "GUARDANDO…" : CB.edit ? "GUARDAR CORRECCIÓN" : "GUARDAR COBRO";
  $("cbErr").textContent = sobra ? "Eso es más de lo que falta de la nota (" + money(x.saldo) + ")." : CB.err;
}
function cbOkHtml(){
  const c = CB.ok.cobro, n = cbNotas().find(x => x.id === c.n), sc = n ? cbVisible(n).saldo : 0;
  return `<div class="okb"><b>Cobro ${esc(c.rec || "")} guardado</b>${esc(c.cn || "")} · Nota ${esc(c.nn || "")}\n${money(c.nom)} cobrados${n ? " · quedan " + money(sc) + " por cobrar de la nota" : ""}</div>
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
  try{ r = await cbSrv("cobro", { c:cbB64({ id:o.id, rec:o.rec || "", n:o.n, ef:o.ef, us:o.us, ze:o.ze, bs:o.bs, ab:o.ab, ta:o.ta || 0, rf:o.rf || "", cn:o.cn }) }); }catch(e){ return { net:true }; }
  if(r && r.estado === "ok" && r.cobro) return { ok:true, cobro:r.cobro };
  if(r && r.estado === "no") return { err:"Este dispositivo ya no está autorizado. Habla con administración." };
  return { err:(r && r.msg) || "No se pudo guardar el cobro." };
}
async function cbFlush(){
  if(CB.flushing || !CB.cola.length) return; CB.flushing = true;
  for(const o of CB.cola.slice()){
    const r = await cbEnviar(o); if(r.net) break;
    CB.cola = CB.cola.filter(x => x.id !== o.id);
    if(r.ok){ cbCambioRec(o, r.cobro); cbMerge(r.cobro); } else CB.avisos.push("El cobro de " + (o.cn || "un cliente") + " (" + money(o.nom) + ") no se pudo registrar: " + r.err);
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
function cobAbre(){ cbLoad(); CB.nota = null; CB.edit = null; CB.rec = null; CB.ok = null; CB.del = null; CB.tab = CB.tab || "pend"; cobRender(); cobBadge(); cbRefresca(); }

/* ---------- guardar ---------- */
async function cbGuardar(){
  const x = cbSaldoNota(); if(!x || CB.busy) return; const c = cbCalc(x.n, CB.f);
  if(c.nom <= 0 || c.ab > x.saldo + 0.5) return;
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
  const o = { id:cbUid(), n:x.n.id, nn:x.n.num, cn:cbCliente(x.n.cid), t:Math.floor(Date.now() / 1000), nom:c.nom, ab:c.ab, ef:c.ef, us:c.us, ze:c.ze, bs:c.bs, ta:c.bs > 0 && x.n.tar !== "b" ? cbNum(CB.f.ta) : 0, rf:(CB.f.rf || "").trim().slice(0, 120), est:"cola", rec:cbSigRec() };
  const r = await cbEnviar(o); CB.busy = false;
  if(r.err){ CB.err = r.err; cobRender(); return; }
  let cobro;
  if(r.ok){ cobro = r.cobro; cbCambioRec(o, cobro); cbMerge(cobro); } else { cobro = o; CB.cola.push(o); cbSave(); }
  CB.f = cbF0(); CB.nota = null; CB.ok = { cobro }; cobRender(); cobBadge(); window.scrollTo(0, 0);
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
/* al compartir la imagen, el texto lleva solo el número de recibo y el de nota: basta para encontrarlo luego con el buscador de WhatsApp */
async function cbShare(id){
  const c = cbCobros().find(x => x.id === id); if(!c || !c.rec) return; const txt = cbReciboTxt(c);
  try{ const blob = CB.img[c.id] || await cbImg(c); CB.img[c.id] = blob; await navigator.share({ files:[new File([blob], "Recibo " + c.rec + ".png", { type:"image/png" })], text:"Recibo " + c.rec + " · Nota " + (c.nn || "") }); } }
  catch(e){ if(e && e.name === "AbortError") return; CB.avisos.push("Este teléfono no dejó compartir la imagen. Usa «Enviar solo el texto por WhatsApp»."); cobRender(); }
}

/* ---------- eventos ---------- */
$("vCob").addEventListener("click", async e => {
  const a = e.target.closest("[data-cb]"); if(!a) return; const k = a.dataset.cb, top = () => window.scrollTo(0, 0);
  if(k === "tab"){ CB.tab = a.dataset.k; CB.del = null; cobRender(); }
  else if(k === "solo"){ CB.solo = a.dataset.k === "true"; cobRender(); }
  else if(k === "open"){ CB.nota = a.dataset.id; CB.edit = null; CB.del = null; CB.f = cbF0(); CB.err = ""; cobRender(); top(); }
  else if(k === "volver"){ CB.nota = null; CB.edit = null; CB.del = null; cobRender(); }
  else if(k === "listo"){ CB.ok = null; cobRender(); top(); }
  else if(k === "guardar") cbGuardar();
  else if(k === "fill"){
    const x = cbSaldoNota(); if(!x) return; const f = Object.assign({}, CB.f, { [a.dataset.k]:"" }), otros = cbCalc(x.n, f), rest = Math.max(0, x.saldo - otros.ab);
    const v = a.dataset.k === "bs" && x.n.tar === "b" ? rest / FACT : rest; CB.f[a.dataset.k] = v > 0 ? String(r2(v)).replace(".", ",") : ""; $("cb_" + a.dataset.k).value = CB.f[a.dataset.k]; cbSum();
  }
  else if(k === "rec"){ CB.rec = a.dataset.id; CB.del = null; cobRender(); top(); }
  else if(k === "recx"){ CB.rec = null; cobRender(); }
  else if(k === "share") cbShare(a.dataset.id);
  else if(k === "edit"){
    const c = cbCobros().find(x => x.id === a.dataset.id); if(!c) return; const m = v => v ? String(v).replace(".", ",") : "";
    CB.nota = c.n; CB.edit = c.id; CB.del = null; CB.err = ""; CB.f = { ef:m(c.ef), us:m(c.us), ze:m(c.ze), bs:m(c.bs), ta:m(c.ta), rf:c.rf || "" }; cobRender(); top();
  }
  else if(k === "editx"){ CB.edit = null; CB.f = cbF0(); CB.err = ""; cobRender(); }
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
/* barra inferior: cambia de ambiente. PEDIDOS vuelve a donde estabas (catálogo, pedido o mis pedidos); COBRANZAS abre siempre en la lista. */
$("nav").addEventListener("click", e => {
  const b = e.target.closest("[data-nav]"); if(!b) return;
  if(b.dataset.nav === "cob"){ if(VISTA === "cobros"){ cobAbre(); window.scrollTo(0, 0); } else { CB.last = VISTA === "pedido" || VISTA === "enviados" ? VISTA : ""; go("cobros"); } }
  else go(VISTA === "cobros" && CB.last ? CB.last : "catalogo");
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
