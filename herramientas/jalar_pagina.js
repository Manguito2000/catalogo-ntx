/*JALAR*/
/* Jalar hacia abajo para actualizar (portal de ventas NTX). Solo con la página en el tope y sin nada a medio escribir:
   catálogo, cobranzas y pedidos enviados. No recarga la página (eso pediría el código otra vez): vuelve a leer datos.json,
   re-abre los datos del vendedor y sincroniza cobros; lo que el vendedor tiene en pantalla o sin enviar queda como está. */
const PTR = { x0:0, y0:0, dy:0, on:false, busy:false, el:null, tm:0 };
function ptrEl(){
  if(!PTR.el){ const e = document.createElement("div"); e.id = "ptr"; e.setAttribute("aria-hidden", "true"); e.innerHTML = '<span class="ptrI"></span><span class="ptrT"></span>'; document.body.appendChild(e); PTR.el = e; }
  return PTR.el;
}
function ptrPinta(dy, txt, gira, suave){
  const e = ptrEl(); e.style.transition = suave ? "transform .22s ease, opacity .22s ease" : "none";
  e.style.transform = "translate(-50%," + (dy - 70) + "px)"; e.style.opacity = dy > 6 ? Math.min(1, dy / 40) : 0;
  e.classList.toggle("gira", !!gira); e.querySelector(".ptrT").textContent = txt || "";
  e.querySelector(".ptrI").style.transform = gira ? "" : "rotate(" + Math.round(dy * 5) + "deg)";
}
function ptrPuede(t){
  if(PTR.busy || window.scrollY > 0 || document.body.classList.contains("tecl")) return false;
  if(!$("zoom").hidden || (VISTA !== "catalogo" && VISTA !== "cobros" && VISTA !== "enviados" && VISTA !== "admin")) return false;
  if(VISTA === "cobros" && (CB.nota || CB.ok || CB.fac || CB.edit)) return false;
  if(t && t.closest && t.closest("input,textarea,select")) return false;
  if(document.activeElement && document.activeElement.matches && document.activeElement.matches("input,textarea,select")) return false;
  return true;
}
async function ptrRefresca(){
  PTR.busy = true; ptrPinta(56, "Actualizando…", true, true);
  const t0 = Date.now(); let ok = true;
  try{ save(); }catch(e){}
  try{
    const r = await fetch("datos.json?" + Date.now(), { cache:"no-store" }); if(!r.ok) throw new Error("datos");
    const j = await r.json();
    if(j && Array.isArray(j.v) && j.v.length){ VENDS = j.v; if(window.NTX_PASE) await unlock(window.NTX_PASE); }
  }catch(e){ ok = false; }
  try{ CB.t0 = Date.now(); if(typeof cbRefresca === "function") await cbRefresca(); }catch(e){}
  try{ if(typeof admCarga === "function" && S.adm){ await admCarga(true); if(VISTA === "admin" && (AD.err || AD.errB)) ok = false; } }catch(e){}   // administración: bandeja y facturas al día
  if(ok && typeof CB !== "undefined" && /sin conexión/.test(CB.sync || "")) ok = false;
  const resto = 700 - (Date.now() - t0); if(resto > 0) await new Promise(r => setTimeout(r, resto));
  ptrPinta(56, ok ? "Actualizado" : "Sin conexión", false, true);
  await new Promise(r => setTimeout(r, 650));
  ptrPinta(0, "", false, true); PTR.busy = false;
}
document.addEventListener("touchstart", e => {
  PTR.on = false; PTR.dy = 0;
  if(e.touches.length !== 1 || !ptrPuede(e.target)) return;
  PTR.x0 = e.touches[0].clientX; PTR.y0 = e.touches[0].clientY; PTR.on = "espera";
}, { passive:true });
document.addEventListener("touchmove", e => {
  if(!PTR.on) return;
  const t = e.touches[0], dx = t.clientX - PTR.x0, dy = t.clientY - PTR.y0;
  if(PTR.on === "espera"){
    if(Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    if(dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > 0){ PTR.on = false; return; }   // hacia arriba, de lado o ya con scroll: es otra cosa
    PTR.on = "jala";
  }
  if(dy <= 0){ PTR.on = false; ptrPinta(0, "", false, true); return; }
  if(e.cancelable) e.preventDefault();
  PTR.dy = Math.min(90, dy * 0.5);
  ptrPinta(PTR.dy, PTR.dy >= 56 ? "Suelta para actualizar" : "Jala para actualizar", false, false);
}, { passive:false });
const ptrFin = () => {
  const jalando = PTR.on === "jala"; PTR.on = false;
  if(!jalando) return;
  if(PTR.dy >= 56) ptrRefresca(); else ptrPinta(0, "", false, true);
};
document.addEventListener("touchend", ptrFin, { passive:true });
document.addEventListener("touchcancel", () => { if(PTR.on === "jala") ptrPinta(0, "", false, true); PTR.on = false; }, { passive:true });
/*FIN-JALAR*/
