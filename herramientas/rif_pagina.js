/*RIF*/
/* Cliente nuevo: teléfono y foto del RIF obligatorios, salvo la casilla «El cliente ya existe» (posible error de cartera en Holded) (25 nov 2026). La foto se reduce en el teléfono y sube por POST al receptor ({a:"rif"}),
   que la guarda en Drive y la adjunta al pedido en Holded. Si no hay señal, queda en cola en el teléfono y se intenta luego. */
const LSRIF = "ntx-rif", LSRQ = "ntx-rif-cola";
let RIF = null; try{ RIF = JSON.parse(localStorage.getItem(LSRIF) || "null"); }catch(e){}
const rifGuarda = () => { try{ RIF ? localStorage.setItem(LSRIF, JSON.stringify(RIF)) : localStorage.removeItem(LSRIF); }catch(e){} };
const telOk = t => String(t || "").replace(/\D/g, "").length >= 10;
const nuevoOk = () => !S.cliente || !S.cliente.nuevo || !!S.cliente.existe || (telOk(S.cliente.tel) && !!RIF);
const rifFalta = () => (!telOk(S.cliente && S.cliente.tel) ? "Escribe el teléfono del cliente nuevo (con código de área)" : "Toma la foto del RIF del cliente nuevo") + " para poder enviar, o marca «El cliente ya existe».";
function rifHtml(){
  const c = S.cliente || {};
  const caja = `<label class="rifex"><input type="checkbox" id="cex"${c.existe ? " checked" : ""}><span>El cliente ya existe en el sistema<small>Márcalo si crees que es un error: por ejemplo, el cliente está en Holded pero sin vendedor asignado.</small></span></label>`;
  if(c.existe) return caja + `<p class="hint">Administración revisará la ficha del cliente y a qué vendedor está asignado. No hace falta teléfono ni RIF.</p>`;
  const vista = !RIF ? "" : RIF.tipo === "application/pdf" ? `<span class="rifpdf">PDF</span>` : `<img src="data:${esc(RIF.tipo)};base64,${RIF.b64}" alt="Foto del RIF">`;
  return `<input class="fld riftel" id="ctel" type="tel" inputmode="tel" autocomplete="off" placeholder="Teléfono del cliente (ej. 0414-1234567)" value="${esc(c.tel || "")}" aria-label="Teléfono del cliente nuevo">
    <input type="file" id="rifF" accept="image/*,application/pdf" hidden>
    ${RIF ? `<div class="rifv">${vista}<div><b>RIF listo</b><small>Llega adjunto al pedido en Holded.</small><button type="button" class="txt" data-act="rifsel">Cambiar foto</button></div></div>`
          : `<button type="button" class="ghost rifb" data-act="rifsel"${S.rifLee ? " disabled" : ""}>${S.rifLee ? "PREPARANDO LA FOTO…" : "FOTO DEL RIF"}</button>`}
    ${S.rifErr ? `<div class="msg">${esc(S.rifErr)}</div>` : ""}
    <p class="hint">El teléfono y la foto del RIF llegan con el pedido para que administración registre al cliente.</p>${caja}`;
}
document.addEventListener("change", e => { if(e.target.id !== "cex" || !S.cliente) return; S.cliente.existe = e.target.checked; save(); renderPed(); });
document.addEventListener("change", e => {
  if(e.target.id !== "rifF" || !e.target.files || !e.target.files[0]) return;
  const f = e.target.files[0]; e.target.value = ""; S.rifErr = ""; S.rifLee = true; renderPed();
  cbArchivo(f, 1400, .75).then(a => { RIF = { tipo:a.tipo, b64:a.b64 }; rifGuarda(); })
    .catch(err => { S.rifErr = (err && err.message) || "No se pudo leer la foto. Intenta de nuevo."; })
    .finally(() => { S.rifLee = false; renderPed(); });
});
/* al enviar: la foto pasa a la cola de subida con el id del pedido, y el pedido siguiente empieza sin foto */
function rifEncola(o){
  if(!o.cliente || !o.cliente.nuevo || o.cliente.existe || !RIF) return;
  let q = []; try{ q = JSON.parse(localStorage.getItem(LSRQ) || "[]") || []; }catch(e){}
  q = q.filter(x => x.id !== o.id).concat([{ id:o.id, cn:(o.cliente.nombreNuevo || "").trim(), tipo:RIF.tipo, b64:RIF.b64, n:0 }]);
  try{ localStorage.setItem(LSRQ, JSON.stringify(q)); }catch(e){}
  RIF = null; rifGuarda(); setTimeout(rifFlush, 1500);
}
let rifSub = false;
async function rifFlush(){
  if(rifSub || !SCRIPT_URL) return; let q = []; try{ q = JSON.parse(localStorage.getItem(LSRQ) || "[]") || []; }catch(e){}
  if(!q.length) return; rifSub = true;
  let cod = "", d = ""; try{ cod = localStorage.getItem(LSC) || ""; d = localStorage.getItem("ntx-disp") || ""; }catch(e){}
  for(const it of q.slice()){
    let r = null;
    try{ const res = await fetch(SCRIPT_URL, { method:"POST", headers:{ "Content-Type":"text/plain;charset=utf-8" }, redirect:"follow", body:JSON.stringify({ a:"rif", cod, d, x:{ id:it.id, cn:it.cn }, tipo:it.tipo, b64:it.b64 }) }); r = JSON.parse(await res.text()); }
    catch(e){ break; }                                                                // sin conexión: se intenta luego
    if((r && (r.estado === "ok" || r.estado === "no")) || ++it.n >= 8) q = q.filter(x => x.id !== it.id);
  }
  try{ localStorage.setItem(LSRQ, JSON.stringify(q)); }catch(e){}
  rifSub = false;
}
window.addEventListener("online", rifFlush);
setTimeout(rifFlush, 6000);
/*FIN-RIF*/
