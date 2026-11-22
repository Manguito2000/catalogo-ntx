/*COBRANZAS*/
/* Pestaña Cobranzas del portal de ventas NTX (herramientas/COBRANZAS.md). Se inyecta en el catálogo con herramientas/aplicar_cobranzas.py.
   Datos: S.nt (notas del vendedor, vienen de datos.json) + cobros que anota el vendedor (los guarda y concilia el receptor de Apps Script). */
const CB = { tab:"pend", solo:false, nota:null, edit:null, rec:null, last:"", url:{}, f:{ ef:"", us:"", ze:"", mp:"", bs:"", bsb:"", tb:"", ta:"", fp:"", rf:"", dd:"" }, err:"", busy:false, ok:null, cobros:null, cola:[], avisos:[], del:null, t0:0, img:{}, cargado:false, sync:"", sol:[], ret:{}, fac:null, facTxt:"", facErr:"", facBusy:false, msgOk:"", up:"", caps:[], capCola:[], tasas:[], mpOn:false, bsOn:false };
const LSK = "ntx-cobros", LSQ = "ntx-cobros-cola", CAPLS = "ntx-cap-cola";
/* Descuento BCV (%): sale de config.json del repositorio (un solo número para todo el sistema). Mientras carga, el último conocido o 15. */
let DBCV = 15; try{ DBCV = Number(localStorage.getItem("ntx-dbcv")) || 15; }catch(e){}
const FBCV = () => 1 - DBCV / 100;          // dólares reales por cada dólar BCV
fetch("config.json?" + Date.now(), { cache:"no-store" }).then(r => r.json()).then(j => { const iv = Number(j && j.iva); if(iv > 0 && iv < 50 && iv !== IVAP){ IVAP = iv; try{ localStorage.setItem("ntx-iva", String(iv)); }catch(e){} if(VISTA === "cobros") cobRender(); }
  const v = Number(j && j.descuento_bcv);
  if(v > 0 && v < 90 && v !== DBCV){ DBCV = v; try{ localStorage.setItem("ntx-dbcv", String(v)); }catch(e){} if(VISTA === "cobros") cobRender(); } }).catch(() => {});
let IVAP = 16; try{ IVAP = Number(localStorage.getItem("ntx-iva")) || 16; }catch(e){}   // IVA (%): un solo número, en config.json (iva)
const r2 = n => Math.round(n * 100) / 100;
const cbNum = v => { const t = String(v == null ? "" : v).trim(), x = /\d[.,]\d{3}[.,]\d/.test(t) || (/,/.test(t) && /\./.test(t)) ? Number(t.replace(/[.,](?=\d{3}(?:[.,]|$))/g, "").replace(",", ".")) : Number(t.replace(",", ".")); return isFinite(x) && x > 0 ? r2(x) : 0; };
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
const cbNotas = () => { const L = (S.nt || []).map(NT); if(CB.adNota && VISTA === "admin" && !L.some(n => n.id === CB.adNota[0])) L.push(NT(CB.adNota)); return L; };   // + la nota que cobra administración
const cbCliente = id => { const c = (S.clientes || []).find(x => x.id === id); return c ? c.n : (CB.adCli && CB.adCli[id]) || "Cliente"; };
/* IVA ya cobrado de una nota facturada (cobros no anulados) y lo que falta: el IVA no va a Holded, solo se lleva aquí */
const cbIvaRec = n => CB.adX && n && n.id === CB.adX.id && VISTA === "admin" ? r2(CB.adX.ivr || 0) : r2(cbCobros().filter(c => c.n === n.id && c.est !== "anulado" && c.est !== "rechazo").reduce((s, c) => s + (Number(c.iv) || 0), 0));
const cbIvaPend = n => !n || !n.fac ? 0 : Math.max(0, r2(cbIvaT(n) - cbIvaRec(n)));
/* IVA de una nota facturada. El neto se cubre primero; lo que entra después (en bolívares) es IVA. Mientras el IVA no esté resuelto
   (completo, o lo recibido + la retención marcada = IVA de la factura) la nota sigue abierta para más pagos, aunque Holded ya tenga el neto. */
const cbIvaTol = n => Math.max(0.5, r2(cbIvaT(n) * 0.03));
function cbIvaFalta(n){
  if(!n || !n.fac) return 0; const t = cbIvaT(n), rt = (cbRet(n) || {}).rt || 0;
  return Math.max(0, r2(t - cbIvaRec(n) - t * rt / 100));
}
/* ¿qué pasó con el IVA tras este cobro? Solo se concluye cuando lo recibido cuadra con un caso claro; si no, el IVA queda "parcial" y la nota abierta.
   Devuelve { est: completo | r75 | sinIva | parcial, rt: 0 | 75 | null, txt } o null mientras el neto no esté completo. */
function cbIvaDetecta(n, saldoAntes, c){
  if(!n || !n.fac) return null;
  const queda = Math.max(0, r2(saldoAntes - c.bv)); if(queda >= 0.01) return null;          // el neto aún no está completo: todo lo que entra es neto
  const esper = cbIvaT(n), rec = r2(cbIvaRec(n) + (c.iv || 0)), tol = cbIvaTol(n);
  if(esper < 0.5) return null;
  if(rec >= esper - tol) return { est:"completo", rt:0, txt:"Entró el IVA completo." };
  if(Math.abs(rec - esper * 0.25) <= tol) return { est:"r75", rt:75, txt:"Entró el 25 % del IVA (" + cbM(rec, n) + "): el cliente retuvo el 75 %. Falta el comprobante de retención. Si en realidad va a pagar el resto del IVA, cámbialo a «No retiene» y anótalo cuando llegue." };
  if(rec < 0.01) return { est:"sinIva", rt:null, txt:"El neto está completo y no entró IVA. Si el cliente retuvo el 100 %, márcalo en la nota; si va a pagar el IVA aparte, la nota sigue abierta para anotarlo." };
  return { est:"parcial", rt:null, txt:"Van " + cbM(rec, n) + " de IVA de " + cbM(esper, n) + ". Faltan " + cbM(r2(esper - rec), n) + (rec < esper * 0.25 - tol ? ", o " + cbM(r2(esper * 0.25 - rec), n) + " si el cliente retiene el 75 %" : "") + ". La nota sigue abierta para el próximo pago." };
}
/* tasa BCV (Bs por dólar) vigente en una fecha aaaa-mm-dd: la última publicada con fecha valor igual o anterior. CB.tasas = [[fecha, tasa]] del receptor */
function cbTasaDe(f){
  const t = (CB.tasas || []).filter(x => x && x[0] && (!f || x[0] <= f)).sort((a, b) => a[0] < b[0] ? 1 : -1)[0];
  return t ? Number(t[1]) || 0 : 0;
}
const cbHoy = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const cbCom = (v, dec) => { if(!(v > 0)) return ""; let s = Number(v).toFixed(dec == null ? 2 : dec); if(dec > 2) s = s.replace(/0+$/, "").replace(/\.$/, ""); return s.replace(".", ","); };
/*LECTOR*/
/* ---------- lector de capturas de pago ----------
   El teléfono lee la captura con el OCR de ocr/ (Tesseract.js) y lxLee() interpreta el texto: método, monto, fecha, hora, referencia
   y a cuál cuenta de la empresa se pagó. Las cuentas (CB_CTAS: id, nombre, met, claves) no están en el repositorio: las inyecta
   aplicar_cobranzas.py desde los datos privados al armar el portal, que va cifrado. met: ze Zelle · us USDT/USDC · bs bolívares · mp Mercantil Panamá */
const CB_CTAS = /*CTAS*/[]/*FIN-CTAS*/;
const LX_MES = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, set:9, oct:10, nov:11, dic:12, jan:1, apr:4, aug:8, dec:12 };
const lxSin = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
/* "64.413,10" · "1,095.59" · "445.84" · "7373,00": los dos últimos dígitos tras el último punto o coma son los céntimos */
function lxNum(s){
  s = String(s).replace(/\s/g, ""); const m = /[.,](\d{2})$/.exec(s);
  return m ? Number(s.slice(0, -3).replace(/[.,]/g, "") + "." + m[1]) || 0 : Number(s.replace(/[.,]/g, "")) || 0;
}
const lxIso = (y, m, d) => { y = +y; m = +m; d = +d; if(y < 100) y += 2000; return y >= 2020 && y <= 2035 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0") : ""; };
/* fecha del pago. dd/mm/aaaa es lo normal en Venezuela; si el día y el mes pueden cruzarse, gana la más cercana a la fecha de la imagen (ref, aaaa-mm-dd) */
function lxFecha(t, ref){
  const p = lxSin(t).replace(/\s+/g, " "), c = []; let m;
  const r1 = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4}|\d{2})\b/g;
  while((m = r1.exec(p))){ const a = lxIso(m[3], m[2], m[1]), b = lxIso(m[3], m[1], m[2]); if(a) c.push(a); if(b && b !== a) c.push(b); }
  const r2 = /\b([a-z]{3})[a-z]*\.? (\d{1,2}),? (20\d\d)\b/gi;
  while((m = r2.exec(p))){ const k = LX_MES[m[1].toLowerCase()]; if(k){ const a = lxIso(m[3], k, m[2]); if(a) c.push(a); } }
  const r3 = /\b(\d{1,2}) (?:de )?([a-z]{3})[a-z]*\.?,? (?:de )?(20\d\d)\b/gi;
  while((m = r3.exec(p))){ const k = LX_MES[m[2].toLowerCase()]; if(k){ const a = lxIso(m[3], k, m[1]); if(a) c.push(a); } }
  if(!c.length) return "";
  if(!ref) return c[0];
  const dif = f => Math.abs(new Date(f + "T12:00:00") - new Date(ref + "T12:00:00"));
  return c.slice().sort((a, b) => dif(a) - dif(b))[0];
}
/* monto: se prefiere el que viene después de "monto", "cantidad", "pagado con"…; si no, el mayor de la moneda del pago */
function lxMonto(t, bs){
  const re = bs ? /(?:Bs\.?S?\.?|VES)\s*([\d.,]*\d[.,]\d{2})(?!\d)|([\d.,]*\d[.,]\d{2})\s*(?:Bs|VES)\b/gi
                : /(?:US\$|\$|USD)\s?([\d.,]*\d[.,]\d{2})(?!\d)|([\d.,]*\d[.,]\d{2})\s*(?:USD[TC]?|US\$)\b/gi;
  const c = []; let m;
  while((m = re.exec(t))){ const v = lxNum(m[1] || m[2]); if(v > 0 && v < 1e9) c.push({ v, et:/(monto|cantidad|pagado con|total|importe|transferir)[^\d$]{0,40}$/i.test(t.slice(Math.max(0, m.index - 45), m.index)) }); }
  if(!c.length) return 0;
  const e = c.find(x => x.et); return e ? e.v : Math.max.apply(null, c.map(x => x.v));
}
function lxRef(t){
  const p = t.replace(/\s+/g, " "); let m;
  if((m = /n[uú]mero de ([a-z0-9]{6,}) confirmaci/i.exec(p))) return m[1];
  if((m = /confirmaci[oó]n:? ([a-z0-9]*[a-z][a-z0-9]*)\b/.exec(p)) && m[1].length >= 6) return m[1];   // Zelle: letras minúsculas (y números)
  if((m = /comprobante(?: n(?:ro|°|º|o)\.?)?:? ?([A-Z0-9]{6,})/i.exec(p))) return m[1];
  if((m = /(?:n[uú]mero de referencia|referencia|ref\.|n[uú]mero de operaci[oó]n|operaci[oó]n|[i1l]d de orden|n[uú]mero de orden)\s*:?\s*(\d{6,})/i.exec(p))) return m[1];
  return "";
}
function lxDestino(t){
  const p = t.replace(/\s+/g, " "); let m;
  if((m = /(?:celular de )?destino:? (04\d{2}-?\d{7})/i.exec(p))) return m[1];
  if((m = /alias:? ?(\S+)/i.exec(p))) return "Binance " + m[1];
  if((m = /nombre del beneficiario:? ([A-Za-zÁÉÍÓÚÑáéíóúñ .]{4,40}?)(?= [A-Z][a-z]+:| Concepto| Procesado|$)/.exec(p))) return m[1].trim();
  if((m = /beneficiario:? ([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .]{3,40}?)(?= [A-Z][a-z]|$)/.exec(p))) return m[1].trim();
  if((m = /([a-z0-9._]+ ?[@e]gmail\.? ?com)/i.exec(p))) return m[1].replace(/ /g, "");
  if((m = /tel[eé]fono:? (04\d{9})/i.exec(p))) return m[1];
  return "";
}
/* textos: lo que dio cada pasada del OCR; fechaImg: día de la imagen (aaaa-mm-dd), para escoger la fecha y como respaldo */
function lxLee(textos, fechaImg){
  const t = (Array.isArray(textos) ? textos : [textos]).join("\n"), llano = lxSin(t).toLowerCase().replace(/[^a-z0-9]/g, "");
  const cta = CB_CTAS.find(c => (c.claves || []).some(k => k && llano.indexOf(String(k).toLowerCase()) >= 0)) || null;
  let met = cta && cta.met ? cta.met : "";
  if(!met){
    if(/zelle|recibi[oó] tu dinero|su pago fue enviado|inscrito como|registrado como/i.test(t)) met = "ze";
    else if(/\bUSD[TC]\b|cuenta spot|id de orden|binance|cuenta flexible/i.test(t)) met = "us";
    else if(/transferencia a terceros|mercantil bank/i.test(t) && /\bUSD\b|\$/.test(t)) met = "mp";
    else if(/\bBs\b|pago ?m[oó]vil|pagom[oó]vil|bol[ií]vares|\bVES\b/i.test(t)) met = "bs";
  }
  const f = lxFecha(t, fechaImg), h = /\b(\d{1,2}:\d{2}(?::\d{2})?\s?[ap]\.?\s?m\.?)/i.exec(t);
  return { met, mon:met === "bs" ? "Bs" : met ? "USD" : "", monto:met ? lxMonto(t, met === "bs") : 0, fecha:f || fechaImg || "", fechaDe:f ? "captura" : fechaImg ? "imagen" : "",
    hora:h ? h[1].replace(/\s/g, "").toUpperCase() : "", ref:lxRef(t), ct:cta ? cta.id : "", dest:cta ? cta.nombre : lxDestino(t) };
}
const lxCompleto = r => !!(r.met && r.monto > 0 && r.ref && r.fechaDe === "captura");
/*FIN-LECTOR*/
/* ---------- captura del pago: se lee en el teléfono (ocr/) y se guarda con el cobro ---------- */
const OCR = { p:null, w:null, primera:false };
const ocrUrl = f => new URL("ocr/" + f, location.href).href;
/* el lector se baja solo la primera vez que se usa (unos 6 MB); después queda en el teléfono */
function ocrListo(){
  if(OCR.p) return OCR.p;
  OCR.primera = !window.Tesseract;
  OCR.p = new Promise((res, rej) => { if(window.Tesseract) return res(); const s = document.createElement("script"); s.src = ocrUrl("tesseract.min.js"); s.onload = res; s.onerror = () => rej(new Error("no cargó")); document.head.appendChild(s); })
    .then(() => Tesseract.createWorker("spa", 1, { workerPath:ocrUrl("worker.min.js"), corePath:ocrUrl(""), langPath:ocrUrl("").replace(/\/$/, ""), workerBlobURL:false }))
    .then(w => (OCR.w = w));
  OCR.p.catch(() => { OCR.p = null; });
  return OCR.p;
}
const ocrImg = f => new Promise((res, rej) => { const u = URL.createObjectURL(f), im = new Image(); im.onload = () => res(im); im.onerror = () => { URL.revokeObjectURL(u); rej(new Error("imagen")); }; im.src = u; });
/* lienzo para leer: tal cual, o "preparado" (gris, invertido si la pantalla era oscura, contraste estirado y agrandado si es pequeño) */
function ocrLienzo(im, prep){
  let k = Math.min(1, 2000 / Math.max(im.width, im.height)); if(prep && im.width * k < 700) k *= 2;
  const cv = document.createElement("canvas"); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
  const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height);
  if(!prep) return cv;
  const d = g.getImageData(0, 0, cv.width, cv.height), a = d.data, W = cv.width, H = cv.height, hist = new Array(256).fill(0);
  let sum = 0, n = 0;
  for(let i = 0; i < a.length; i += 4){ const y = Math.round(a[i] * .299 + a[i + 1] * .587 + a[i + 2] * .114); a[i] = y; const p = i / 4, x = p % W, z = (p / W) | 0;
    if(x > W / 4 && x < 3 * W / 4 && z > H / 4 && z < 3 * H / 4){ sum += y; n++; } }
  const inv = n && sum / n < 110;
  for(let i = 0; i < a.length; i += 4){ const y = inv ? 255 - a[i] : a[i]; a[i] = y; hist[y]++; }
  const tot = a.length / 4; let lo = 0, hi = 255, acc = 0;
  for(; lo < 255 && (acc += hist[lo]) < tot * .01; lo++); acc = 0; for(; hi > 0 && (acc += hist[hi]) < tot * .01; hi--);
  const span = Math.max(1, hi - lo);
  for(let i = 0; i < a.length; i += 4){ const y = Math.max(0, Math.min(255, Math.round((a[i] - lo) * 255 / span))); a[i] = a[i + 1] = a[i + 2] = y; }
  g.putImageData(d, 0, 0); return cv;
}
/* hasta tres lecturas: la captura tal cual; si falta algo, preparada; y si aún falta, buscando texto suelto (los montos grandes) */
async function ocrLee(f, fechaImg){
  const w = await ocrListo(), im = await ocrImg(f), textos = []; let r = null;
  for(const [prep, psm] of [[false, "3"], [true, "3"], [true, "11"]]){
    await w.setParameters({ tessedit_pageseg_mode:psm });
    textos.push((await w.recognize(ocrLienzo(im, prep))).data.text);
    r = lxLee(textos, fechaImg); if(lxCompleto(r)) break;
  }
  URL.revokeObjectURL(im.src); return r;
}
const cbRefN = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
/* lo que el vendedor debe revisar después de leer la captura */
function cbCapAvisos(r, n){
  const av = [];
  if(!r.met) av.push("No reconocí la forma de pago. Llena los montos a mano.");
  else if(!(r.monto > 0)) av.push("No encontré el monto en la captura. Escríbelo a mano.");
  if(r.met && r.met !== "ef" && !r.ct) av.push("No reconozco la cuenta a la que se pagó" + (r.dest ? " (" + r.dest + ")" : "") + ". Revisa que sea de la empresa.");
  const ct = CB_CTAS.find(c => c.id === r.ct);
  if(ct && ct.solo_factura && !n.fac) av.push("Ese pago entró a " + ct.nombre + ", que es para notas con factura. Esta nota no tiene factura.");
  if(ct && ct.sin_factura && n.fac) av.push("Esta nota tiene factura: el pago debía ir a la cuenta de AdriMan, no a " + ct.nombre + ".");
  if(r.fechaDe === "imagen") av.push("La captura no trae fecha: puse la del día en que llegó la imagen. Revísala.");
  const rf = cbRefN(r.ref);
  const igual = cbCobros().find(c => c.est !== "anulado" && c.est !== "rechazo" && ((rf.length >= 6 && String(c.rf || "").split("·").some(x => cbRefN(x) === rf)) ||
    (r.monto > 0 && c.fp && c.fp === r.fecha && Math.abs((Number(c[r.met === "bs" ? "bsb" : r.met]) || 0) - r.monto) < 0.01)));
  if(igual) av.push("Parece el mismo pago del recibo " + (igual.rec || "anterior") + (igual.nn ? " (nota " + igual.nn + ")" : "") + ". Si es un pago repartido en dos notas, está bien.");
  return av;
}
/* Varias capturas por cobro (p. ej. un Zelle y un pago móvil, o dos Zelle). Cada forma de pago que traen las capturas se llena con la SUMA de sus montos;
   el efectivo y lo que no tenga captura no se toca. Al quitar una captura, se recalcula. La fecha del pago es la de la captura en bolívares (fija la tasa)
   o la más reciente; las referencias se juntan con « · ». */
function cbCapRecalc(n){
  const L = (CB.caps || []).filter(c => c.lec), S = { ze:0, us:0, mp:0, bsb:0 }, set = new Set();
  L.forEach(c => { const r = c.lec, k = r.met === "bs" ? "bsb" : r.met; if(r.monto > 0 && k in S){ S[k] += r.monto; set.add(k); } });
  (CB.capSet || []).forEach(k => { if(!set.has(k)){ CB.f[k] = ""; if(k === "bsb") CB.f.bs = ""; } });
  set.forEach(k => { CB.f[k] = cbCom(r2(S[k])); });
  if(set.has("mp")) CB.mpOn = true; if(set.has("bsb")) CB.bsOn = true;
  CB.capSet = Array.from(set);
  const fb = L.find(c => c.lec.met === "bs" && c.lec.fecha), fs = L.map(c => c.lec.fecha).filter(Boolean).sort();
  if(fb) CB.f.fp = fb.lec.fecha; else if(fs.length) CB.f.fp = fs[fs.length - 1];
  if(set.has("bsb") && esB(n) && !CB.tbMan){ const t = cbTasaDe(CB.f.fp); if(t) CB.f.tb = cbCom(t, 4); }
  if(set.has("bsb")) cbBsCalc(n);
  const refs = Array.from(new Set(L.map(c => c.lec.ref).filter(Boolean)));
  if(refs.length) CB.f.rf = refs.join(" · "); else if(CB.capRf && CB.f.rf === CB.capRf) CB.f.rf = "";
  CB.capRf = refs.length ? CB.f.rf : "";
  L.forEach((c, i) => { c.av = cbCapAvisos(c.lec, n); const rf = cbRefN(c.lec.ref);
    if(rf.length >= 6 && L.slice(0, i).some(o => cbRefN(o.lec.ref) === rf)) c.av.push("Esta captura parece la misma que otra que ya adjuntaste."); });
}
const cbCapLeyendo = () => (CB.caps || []).some(c => c.est === "leyendo");
const CAPMAX = 4;
/* bolívares: monto en Bs ÷ tasa (BCV en notas BCV, la acordada en notas USD) = dólares de la nota */
function cbBsCalc(n){
  const bsb = cbNum(CB.f.bsb), t = cbNum(esB(n) ? CB.f.tb : CB.f.ta);
  if(bsb > 0 && t > 0) CB.f.bs = cbCom(r2(bsb / t));
}
async function cbCapElegida(files){
  const n = cbNotas().find(x => x.id === CB.nota); if(!n || !files || !files.length) return;
  CB.caps = CB.caps || [];
  const nuevas = Array.from(files).slice(0, Math.max(0, CAPMAX - CB.caps.length)).map((f, i) => ({ f, url:URL.createObjectURL(f), est:"leyendo", primera:!window.Tesseract && i === 0, lec:null, av:[] }));
  if(!nuevas.length) return; CB.caps = CB.caps.concat(nuevas); cobRender();
  for(const cap of nuevas){                                                        // una tras otra: el lector es uno solo
    if(CB.caps.indexOf(cap) < 0) continue;
    const d = cap.f.lastModified ? new Date(cap.f.lastModified) : new Date(), fi = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    try{ const r = await Promise.race([ocrLee(cap.f, fi), new Promise((_, rej) => setTimeout(() => rej(new Error("tiempo")), 60000))]); cap.lec = r; cap.est = "listo"; }
    catch(e){ cap.est = "error"; }
    if(CB.caps.indexOf(cap) < 0 || CB.nota !== n.id) continue;
    cbCapRecalc(n); if((VISTA === "cobros" || VISTA === "admin") && CB.nota === n.id) cobRender();
  }
}
function cbCapQuita(i){
  const n = cbNotas().find(x => x.id === CB.nota), c = (CB.caps || [])[i]; if(!c) return;
  if(c.url) URL.revokeObjectURL(c.url); CB.caps.splice(i, 1); if(n) cbCapRecalc(n); cobRender();
}
const cbCapLimpia = () => { (CB.caps || []).forEach(c => { if(c.url) URL.revokeObjectURL(c.url); }); CB.caps = []; CB.capSet = []; CB.capRf = ""; };
function cbCapHtml(){
  const L = CB.caps || [], M = { ze:"Zelle", us:"USDT / USDC", bs:"Bolívares", mp:"Mercantil Panamá" };
  const item = (c, i) => { let st = "";
    if(c.est === "leyendo") st = `<p class="hint"><b>${c.primera ? "Preparando el lector (solo la primera vez, puede tardar)…" : "Leyendo la captura…"}</b></p>`;
    else if(c.est === "error") st = `<div class="msg">No pude leer esta captura. Llena su monto a mano; la captura igual se guarda con el cobro.</div>`;
    else if(c.lec){ const r = c.lec;
      st = `<div class="cblx"><b>${esc(M[r.met] || "No reconocí la forma de pago")}${r.monto > 0 ? " · " + (r.mon === "Bs" ? "Bs " + r.monto.toLocaleString("es-VE", { minimumFractionDigits:2, maximumFractionDigits:2 }) : money(r.monto)) : ""}</b>
        <small>${[r.fecha ? cbFecha2(r.fecha) : "", r.ref ? "ref. " + esc(r.ref) : "", r.dest ? "a " + esc(r.dest) : ""].filter(Boolean).join(" · ")}</small></div>` + c.av.map(a => `<div class="msg">${esc(a)}</div>`).join(""); }
    return `<div class="cbcap"><img class="cbth" src="${esc(c.url)}" alt="Captura del pago ${i + 1}"><div class="cbcapt">${st}<button type="button" class="txt" data-cb="capdel" data-i="${i}" style="justify-self:start">Quitar esta captura</button></div></div>`; };
  return `<div class="cbcaps">${L.map(item).join("")}${L.some(c => c.lec) ? `<p class="hint">Revisa los montos antes de guardar.</p>` : ""}
    <input type="file" id="cbCapF" accept="image/*" multiple hidden>${L.length < CAPMAX ? `<button type="button" class="ghost" data-cb="capsel">${L.length ? "+ ADJUNTAR OTRA CAPTURA" : "ADJUNTAR CAPTURAS DEL PAGO"}</button>` : ""}</div>`;
}
const cbFecha2 = f => { const d = new Date(f + "T12:00:00"); return isNaN(d) ? f : d.toLocaleDateString("es-VE", { day:"numeric", month:"short", year:"numeric" }); };
/* la captura se sube a administración después de guardar el cobro (cola en el teléfono: si no hay señal, se intenta luego) */
async function cbCapGuarda(id, rec, f, i){
  i = i || 0;
  try{ const a = await cbArchivo(f, 1400, .75); CB.capCola = (CB.capCola || []).filter(x => !(x.id === id && (x.i || 0) === i)).concat([{ id, i, rec, tipo:a.tipo, b64:a.b64, n:0 }]); cbSave(); }catch(e){}
  CB.capNueva = true; cbCapFlush();
}
async function cbCapFlush(){
  if(CB.capSub || !(CB.capCola || []).length) return; CB.capSub = true; CB.capNueva = false;
  let cod = "", d = ""; try{ cod = localStorage.getItem(LSC) || ""; d = localStorage.getItem("ntx-disp") || ""; }catch(e){}
  for(const it of CB.capCola.slice()){
    if(CB.cola.some(o => o.id === it.id && o.est === "cola")) continue;           // el cobro aún no llegó al receptor
    let r = null;
    try{ const res = await fetch(SCRIPT_URL, { method:"POST", headers:{ "Content-Type":"text/plain;charset=utf-8" }, redirect:"follow", body:JSON.stringify({ a:"cap", cod, d, k:S.adm || "", x:{ id:it.id, i:it.i || 0 }, tipo:it.tipo, b64:it.b64 }) }); r = JSON.parse(await res.text()); }
    catch(e){ break; }                                                              // sin conexión: se intenta luego
    const fuera = () => { CB.capCola = CB.capCola.filter(x => !(x.id === it.id && (x.i || 0) === (it.i || 0))); };
    if(r && r.estado === "ok"){ fuera(); const c = (CB.cobros || []).find(x => x.id === it.id); if(c) c.cap = Math.max(Number(c.cap) || 0, (it.i || 0) + 1); }
    else if(++it.n >= 6 || (r && r.estado === "no")) fuera();                         // el receptor no la acepta: no se insiste para siempre
  }
  cbSave(); CB.capSub = false;
  if(CB.capNueva){ CB.capNueva = false; setTimeout(cbCapFlush, 300); }   // llegó otra captura mientras se subía la anterior
}
const cbLoad = () => {
  if(CB.cargado) return; CB.cargado = true;
  try{ CB.cobros = JSON.parse(localStorage.getItem(LSK) || "null"); }catch(e){ CB.cobros = null; }
  try{ CB.cola = JSON.parse(localStorage.getItem(LSQ) || "[]") || []; }catch(e){ CB.cola = []; }
  try{ const f = JSON.parse(localStorage.getItem("ntx-cobros-fx") || "null"); if(f){ CB.sol = f.sol || []; CB.ret = f.ret || {}; } }catch(e){}
  try{ CB.capCola = JSON.parse(localStorage.getItem(CAPLS) || "[]") || []; }catch(e){ CB.capCola = []; }
  try{ CB.tasas = JSON.parse(localStorage.getItem("ntx-tasas") || "[]") || []; }catch(e){ CB.tasas = []; }
};
const cbSave = () => { try{ localStorage.setItem(LSK, JSON.stringify(CB.cobros || [])); localStorage.setItem(LSQ, JSON.stringify(CB.cola || [])); localStorage.setItem("ntx-cobros-fx", JSON.stringify({ sol:CB.sol || [], ret:CB.ret || {} })); localStorage.setItem("ntx-tasas", JSON.stringify(CB.tasas || [])); }catch(e){}
  try{ localStorage.setItem(CAPLS, JSON.stringify(CB.capCola || [])); }catch(e){} };   // las capturas van aparte: si no caben, se quedan en memoria hasta subir
const cbCobros = () => { cbLoad(); const ids = new Set((CB.cobros || []).map(c => c.id)); return (CB.cobros || []).concat(CB.cola.filter(c => !ids.has(c.id))); };
const pendiente = c => c.est === "cobrado" || c.est === "revisar" || c.est === "cola";
function cbVisible(n){
  let pc = 0; const tengo = new Set(n.pagos.map(p => p[0]));
  cbCobros().forEach(c => {
    if(c.n !== n.id) return;
    if(pendiente(c)) pc += cbBv(c, n);
    else if(c.est === "confirmado" && (c.pg || []).some(p => !tengo.has(p[0]))) pc += cbBv(c, n);   // confirmado, pero los datos de Holded que tiene el teléfono aún no traen ese pago
  });
  if(CB.adX && n.id === CB.adX.id && VISTA === "admin") (CB.adX.pc || []).forEach(p => { if(!cbCobros().some(c => c.id === p[0])) pc += Number(p[4]) || 0; });   // cobros de los vendedores aún sin registrar
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
const cbRows = () => cbNotas().map(n => { const x = Object.assign({ n, d:cbVence(n) }, cbVisible(n)); x.ivaF = n.fac && x.saldo < 0.01 ? cbIvaFalta(n) : 0; return x; })
  .filter(x => (x.n.pend >= 0.01 && (x.saldo >= 0.01 || x.pc >= 0.01)) || x.ivaF >= cbIvaTol(x.n));
function cobBadge(){
  const b = $("cobN"); if(!b) return; cbLoad();
  const v = cbRows().filter(x => x.d != null && x.d < 0 && x.saldo >= 0.01).length;
  b.hidden = !v; b.textContent = v; cobNav(VISTA || "catalogo");
  try{ if(S.adm && Date.now() - AD.t > 90000) admCarga(); }catch(e){}   // administración: la bandeja se carga apenas abre sesión
}
/* barra inferior del portal: PEDIDOS | COBRANZAS. Es el único sitio desde donde se cambia de ambiente. */
function cobNav(v){
  const on = EXT && S.rol === "vendedor", c = v === "cobros", ad = on && !!S.adm; $("nav").hidden = !on; document.body.classList.toggle("con-nav", on);
  $("navAdm").hidden = !ad; $("nav").classList.toggle("n3", ad); $("navAdm").setAttribute("aria-current", v === "admin" ? "page" : "false");
  if(v !== "catalogo") solCero();
  if(v !== "admin" && CB.adNota){ admNotaCierra(); if(CB.ok && CB.ok.cobro && CB.ok.cobro.ad) CB.ok = null; }   // al salir de ADMIN se suelta el cobro de administración
  if(v !== "admin"){ try{ admToast(""); }catch(e){} }
  $("navCob").setAttribute("aria-current", c ? "page" : "false"); $("navPed").setAttribute("aria-current", c || v === "admin" ? "false" : "page");
}
const cbF0 = () => ({ ef:"", us:"", ze:"", mp:"", bs:"", bsb:"", tb:"", ta:"", fp:"", rf:"", dd:"" });
const cbSt = c => c.est === "confirmado" ? `<span class="st ok">Confirmado</span>` : c.est === "revisar" ? `<span class="st low">Revisar</span>` : c.est === "rechazo" ? `<span class="st no">No registrado</span>` : c.est === "cola" ? `<span class="st no">Sin enviar</span>` : `<span class="st low">Por confirmar</span>`;
const cbHora = t => t ? new Date(t * 1000).toLocaleString("es-VE", { day:"2-digit", month:"short", hour:"numeric", minute:"2-digit" }) : "";
/* acciones de un cobro: ver recibo siempre; corregir o anular solo mientras administración no lo haya confirmado */
function cbAcc(c){
  if(c.ad) return c.rec ? `<button class="txt" data-cb="rec" data-id="${esc(c.id)}">Recibo</button>` : "";   // lo registró administración
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
  if(CB.rec){ const c = rcTodos().find(x => x.id === CB.rec);
    if(c && c.rec){ el.innerHTML = av + `<button class="txt" data-cb="recx" style="justify-self:start">‹ Volver</button><h2 class="bs">Recibo ${esc(c.rec)}</h2>` + cbRecHtml(c); cbRecPinta(c); return; }
    CB.rec = null; }
  if(CB.fac){ el.innerHTML = av + cbFacHtml(); return; }
  if(CB.nota){ const h = cbFormHtml(); if(h){ el.innerHTML = av + h; if($("cbSum")) cbSum(); return; } }
  if(CB.tab === "rc" && CB.rc.ficha){ const f = rcFichas().find(x => x.id === CB.rc.ficha); if(f){ el.innerHTML = av + rcDetalleHtml(f); return; } CB.rc.ficha = null; }
  const ne = cbCobros().filter(pendiente).length;
  const tabs = `<div class="seg tabs" role="group" aria-label="Cobranzas">${[["pend", "Pendientes"], ["ent", "Por entregar" + (ne ? " (" + ne + ")" : "")], ["rc", "Recibos"]].map(([k, l]) => `<button data-cb="tab" data-k="${k}" aria-pressed="${CB.tab === k}">${l}</button>`).join("")}</div>`;
  el.innerHTML = tabs + av + (CB.msgOk ? `<div class="okb"><b>${esc(CB.msgOk)}</b></div>` : "") + (CB.tab === "rc" ? rcHtml() : CB.tab === "ent" ? cbEntHtml() : cbPendHtml());
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
        <span class="r"><span class="s bs num">${money(x.saldo)}</span>${esB(x.n) || x.n.fac ? `<br><small class="tb">${[esB(x.n) ? "tasa BCV" : "", x.n.fac ? "neto" : ""].filter(Boolean).join(" · ")}</small>` : ""}${x.pc >= 0.01 ? `<br><small class="pc">Abono por confirmar ${money(x.pc)}</small>` : ""}${x.ivaF >= 0.01 ? `<br><small class="pc">Falta IVA ${cbM(x.ivaF, x.n)}</small>` : ""}</span></button>${cbFilaAcc(x.n, x.saldo)}</div>`;
    }).join("") + `</section>`;
  });
  return h + `<p class="hint">${CB.vivo ? "Saldos de Holded al momento" : "Saldos de Holded al " + (S.fecha ? esc(new Date(S.fecha).toLocaleString("es-VE", { day:"2-digit", month:"short", hour:"numeric", minute:"2-digit" })) : "último refresco")}${CB.sync ? " · " + esc(CB.sync) : ""}. Lo que cobres hoy aparece como «abono por confirmar» hasta que administración lo registre.</p>`;
}
function cbMetodos(c){ return [["Bs", c.bs], ["Efectivo", c.ef], ["USDT", c.us], ["Zelle", c.ze], ["Mercantil Panamá", c.mp]].filter(x => x[1] > 0).map(x => x[0] + " " + money(x[1])).join(" · ") + (Number(c.iv) > 0 ? " · IVA " + money(c.iv) : "") + (Number(c.dd) > 0 ? " · desc. divisas " + c.dd + " %" : "") + (c.cap ? " · captura" : ""); }
function cbEntHtml(){
  const todos = cbCobros().filter(c => c.est !== "anulado" && !c.ad).sort((a, b) => (b.t || 0) - (a.t || 0)), pend = todos.filter(pendiente), conf = todos.filter(c => c.est === "confirmado" && (c.tsc || c.t || 0) >= Date.now() / 1000 - 7 * 86400);
  const T = k => r2(pend.reduce((s, c) => s + (c[k] || 0), 0));
  let h = `<div class="box"><span class="lbl">Efectivo que debes entregar</span><b class="bs num" style="font-size:38px;line-height:1">${money(T("ef"))}</b>
    <small class="hint">USDT ${money(T("us"))} · Zelle ${money(T("ze"))}${T("mp") > 0 ? " · Mercantil Panamá " + money(T("mp")) : ""} · Bolívares ${money(T("bs"))} (en $) · ${pend.length} ${pend.length === 1 ? "cobro" : "cobros"} por confirmar</small></div>`;
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
  const n = x.n, bcv = esB(n), ed = x.ed, c0 = cbCalc(n, CB.f, x.saldo);
  const F = (k, l) => `<label><span>${l}<button type="button" class="txt fill" data-cb="fill" data-k="${k}">Completar saldo</button></span><input class="fld num" id="cb_${k}" data-cb-in="${k}" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(CB.f[k])}"></label>`;
  const mios = cbCobros().filter(c => c.n === n.id && c.est !== "anulado" && !(ed && c.id === ed.id)).sort((a, b) => (b.t || 0) - (a.t || 0));
  const adm = !!(CB.adNota && CB.adNota[0] === n.id && VISTA === "admin");
  let h = `<button class="txt" data-cb="${ed ? "editx" : "volver"}" style="justify-self:start">‹ ${ed ? "Dejar el cobro como estaba" : adm ? "Volver a cobros" : "Volver a pendientes"}</button><h2 class="bs">${ed ? "Corregir cobro" : "Nota " + esc(n.num)}</h2>
    <div class="box"><div class="sel"><span><b>${esc(cbCliente(n.cid))}</b><small>${esc(n.num)}${bcv ? " · BCV" : ""} · ${esc(cbVTxt(cbVence(n)) || "sin vencimiento")}</small></span><span style="flex:none;text-align:right"><small>Falta por cobrar</small><b class="bs num" style="font-size:26px">${money(x.saldo)}</b>${bcv ? `<small class="tb">tasa BCV</small>` : ""}</span></div>
      ${x.pc >= 0.01 ? `<p class="hint num">Ya anotaste ${money(x.pc)} por confirmar</p>` : ""}</div>`;
  if(adm){ const pc = (CB.adX && CB.adX.pc) || [];
    h += `<div class="box"><span class="lbl">Cobro de administración</span><p class="hint">El recibo sale con la serie A- y queda en la carpeta de ${esc(admVenTxt((CB.adX || {}).ven || ""))}. Al guardar se registra en Holded de una vez.</p>` +
      (pc.length ? `<div class="msg">${pc.map(p => esc(p[2]) + " tiene por registrar el recibo " + esc(p[1]) + " (" + money(p[3]) + ")").join("<br>")}. Ya se descontó de lo que falta.</div>` : "") + `</div>`; }
  else if(!ed) h += cbFacBox(n, x);
  if(mios.length && !ed) h += `<div class="box"><span class="lbl">Abonos que anotaste</span>` + mios.map(c => `<div class="cba"><div class="h"><b class="bs num">${money(c.nom)}</b>${cbSt(c)}</div>
      <div class="i num">${esc(c.rec || "Sin número")} · ${esc(cbHora(c.t))} · ${esc(cbMetodos(c))}${Math.abs(cbBv(c, n) - c.nom) >= 0.01 ? " · abona " + cbM(cbBv(c, n), n) : ""}</div>${(c.est === "revisar" || c.est === "rechazo") && c.obs ? `<div class="i" style="color:var(--warn)">${esc(c.obs)}</div>` : ""}
      <div class="f">${cbAcc(c)}</div></div>`).join("") + `</div>`;
  const soloIva = x.saldo < 0.01 && !!n.fac && cbIvaPend(n) >= 0.5;
  if(x.saldo < 0.01 && !ed && !soloIva) return h + `<div class="box"><p class="hint">Esta nota ya está cobrada por completo. Sale de tu lista cuando administración registre el pago en Holded. Si te equivocaste en un monto, toca «Corregir» en el abono.</p></div>`;
  if(!CB.f.fp) CB.f.fp = cbHoy();
  if(bcv && !CB.f.tb){ const t = cbTasaDe(CB.f.fp); if(t) CB.f.tb = cbCom(t, 4); }
  /* bolívares. Nota BCV: «Bolívares tasa BCV (monto en $)»; debajo, si se tiene el monto en Bs, la tasa BCV de la fecha del pago se pone sola.
     Nota en dólares: el desplegable «Nota en USD / pago en Bs» pide el monto en Bs y la tasa acordada (obligatoria); los dólares salen solos. */
  const tBcvHoy = !bcv ? cbTasaDe(CB.f.fp) : 0;
  const bsRow = bcv
    ? `<div class="cbbs" id="cbBsRow"><small class="hint w2"><b>¿Tienes el monto en Bs?</b> Escríbelo aquí y la app saca los dólares BCV.</small>
      <label><span>Monto en Bs</span><input class="fld num" id="cb_bsb" data-cb-in="bsb" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(CB.f.bsb)}"></label>
      <label><span>Tasa BCV</span><input class="fld num" id="cb_tb" data-cb-in="tb" type="text" inputmode="decimal" autocomplete="off" placeholder="Bs por $" value="${esc(CB.f.tb)}"></label>
      <label class="w2"><span>Fecha del pago</span><input class="fld" id="cb_fp" data-cb-in="fp" type="date" value="${esc(CB.f.fp)}"></label>
      <small class="hint w2">${CB.tasas.length ? "La tasa BCV de la fecha del pago se pone sola; cámbiala solo si el cliente usó otra." : "Escribe la tasa BCV del día del pago."}</small></div>`
    : c0.bs > 0 || cbNum(CB.f.bsb) > 0 || CB.bsOn
    ? `<div class="cbbs cbusd" id="cbBsRow"><div class="w2 cbbsh"><b>Nota en USD / pago en Bs</b><button type="button" class="txt" data-cb="bsoff">Quitar</button></div>
      <label><span>Monto en Bs</span><input class="fld num" id="cb_bsb" data-cb-in="bsb" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(CB.f.bsb)}"></label>
      <label><span>Tasa acordada</span><input class="fld num" id="cb_ta" data-cb-in="ta" type="text" inputmode="decimal" autocomplete="off" placeholder="Bs por $" value="${esc(CB.f.ta)}"></label>
      <small class="hint w2"><b>La tasa es obligatoria:</b> la que acordaste con el cliente.${tBcvHoy ? ` <button type="button" class="txt" data-cb="tabcv">Usar la tasa BCV (${esc(cbCom(tBcvHoy, 2))})</button>` : ""}</small>
      <label><span>Equivale en $</span><input class="fld num" id="cb_bs" data-cb-in="bs" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(CB.f.bs)}"></label>
      <label><span>Fecha del pago</span><input class="fld" id="cb_fp" data-cb-in="fp" type="date" value="${esc(CB.f.fp)}"></label></div>`
    : `<button type="button" class="txt" data-cb="bson" style="justify-self:start">+ Nota en USD / pago en Bs</button>`;
  const mpF = CB.mpOn || cbNum(CB.f.mp) > 0 ? F("mp", "Transferencia $ Mercantil Panamá") : `<button type="button" class="txt" data-cb="mpon" style="justify-self:start">+ Transferencia $ Mercantil Panamá</button>`;
  const campos = bcv
    ? F("bs", "Bolívares tasa BCV (monto en $)") + bsRow + F("ef", "Efectivo $") + F("us", "USDT / USDC $") + F("ze", "Zelle $") + mpF +
      `<label id="cbDd" hidden><span>Descuento por pago en divisas</span><span class="pct"><input class="fld num" id="cb_dd" data-cb-in="dd" type="text" inputmode="decimal" autocomplete="off" placeholder="${DBCV}" value="${esc(CB.f.dd !== "" && CB.f.dd != null ? CB.f.dd : String(DBCV))}"><b>%</b></span><small class="hint">Lo normal es ${DBCV} %. Cámbialo solo si acordaste otro con el cliente.</small></label>`
    : F("ef", "Efectivo $") + F("us", "USDT / USDC $") + F("ze", "Zelle $") + mpF + bsRow;
  return h + `<div class="box"><span class="lbl">${ed ? "Montos corregidos" : mios.length ? "Registrar otro cobro" : "Registrar cobro"}</span>
      ${ed ? `<p class="hint">Al guardar se anula el recibo ${esc(ed.rec || "anterior")} y se crea uno nuevo con estos montos. Si ya le enviaste el recibo al cliente, envíale el nuevo.</p>` : ""}
      ${ed ? "" : `<p class="hint cbins"><b>Adjunta las capturas de los pagos</b> (Zelle, Binance, pago móvil, transferencia): la app llena los montos. Lo que no tenga captura, como el efectivo, escríbelo tú${bcv ? " en dólares BCV. Si paga en divisas, se aplica el descuento" : " en dólares"}.</p>`}
      ${ed && bcv ? `<p class="hint">Nota a tasa BCV: los montos van en dólares BCV.</p>` : ""}
      ${n.fac ? `<p class="hint">${soloIva ? "El neto ya está cobrado. Si el cliente pagó el IVA aparte, anótalo aquí en bolívares." : "Nota facturada: si el pago trae el IVA, anota todo lo que entró; la app separa el neto del IVA."}</p>` : ""}
      ${ed ? "" : cbCapHtml()}
      <div class="cbf">${campos}
        <label><span>Referencia o comprobante (opcional)</span><input class="fld" id="cb_rf" data-cb-in="rf" type="text" autocomplete="off" maxlength="120" placeholder="Últimos dígitos, nombre del banco…" value="${esc(CB.f.rf)}"></label></div>
      <div class="cbsum" id="cbSum"></div><div class="cbe" id="cbErr"></div>
      <button class="send" id="cbGo" data-cb="guardar">GUARDAR COBRO</button></div>`;
}
/* nom = lo que entregó el cliente · bv = lo que abona a la nota (en dólares de la nota) · ab = dólares reales (lo que registrará administración en Holded)
   Nota BCV: bolívares abonan 1 a 1 en dólares BCV; las divisas abonan divisas / (1 − descuento). Reales: bolívares × factor BCV + divisas.
   Nota facturada (siempre BCV): si con el saldo dado entra más que el neto, el excedente en bolívares es IVA (iv): no abona a la nota ni va a Holded. */
function cbCalc(n, f, saldo){
  const ef = cbNum(f.ef), us = cbNum(f.us), ze = cbNum(f.ze), mp = cbNum(f.mp), bs = cbNum(f.bs), div = r2(ef + us + ze + mp), nom = r2(div + bs);
  if(!esB(n)) return { ef, us, ze, mp, bs, div, nom, dd:0, bv:nom, ab:nom, iv:0 };
  const dt = String(f.dd == null ? "" : f.dd).trim(), dd = div > 0 ? (dt === "" ? DBCV : Math.max(0, Math.min(50, Number(dt.replace(",", ".")) || 0))) : 0;
  const bruto = r2(bs + div / (1 - dd / 100)), iv = n.fac && saldo != null ? r2(Math.min(bs, Math.max(0, bruto - saldo))) : 0;
  return { ef, us, ze, mp, bs, div, nom, dd, iv, bv:r2(bruto - iv), ab:r2((bs - iv) * FBCV() + div) };
}
function cbSum(){
  const x = cbSaldoNota(), s = $("cbSum"); if(!x || !s) return; const n = x.n, c = cbCalc(n, CB.f, x.saldo), resto = r2(x.saldo - c.bv);
  const br = $("cbBsRow"); if(br && !esB(n)) br.hidden = !(c.bs > 0 || cbNum(CB.f.bsb) > 0 || CB.bsOn); const dl = $("cbDd"); if(dl) dl.hidden = !(c.div > 0);
  const sobra = c.bv > x.saldo + 0.5 || c.iv > cbIvaPend(n) + 0.5, sinTasa = !esB(n) && (c.bs > 0 || cbNum(CB.f.bsb) > 0) && !(cbNum(CB.f.ta) > 0), sinTasaB = esB(n) && cbNum(CB.f.bsb) > 0 && !(cbNum(CB.f.tb) > 0);
  s.innerHTML = esB(n)
    ? (c.bs > 0 ? `<div><span>Bolívares</span><b class="num">${cbM(c.bs, n)}</b></div>` : "") + (c.div > 0 ? `<div><span>Divisas${c.dd ? " (−" + c.dd + " %)" : ""}</span><b class="num">${money(c.div)} → ${cbM(r2(c.bv - c.bs), n)}</b></div>` : "") +
      `<div><span>Abona a la nota</span><b class="num">${cbM(c.bv, n)}</b></div><div class="big"><span>Quedaría por cobrar</span><b class="bs num">${cbM(Math.max(0, resto), n)}</b></div>`
    : `<div><span>Cobrado</span><b class="num">${money(c.nom)}</b></div><div class="big"><span>Quedaría por cobrar</span><b class="bs num">${money(Math.max(0, resto))}</b></div>`;
  if(n.fac && c.iv > 0){ const det = cbIvaDetecta(n, x.saldo, c);
    s.innerHTML = s.innerHTML.replace('<div class="big">', `<div><span>IVA recibido (no va a Holded)</span><b class="num">${cbM(c.iv, n)}</b></div>` + (det ? `<div><span>${det.est === "r75" ? "Retención detectada" : "IVA"}</span><b class="num">${det.est === "r75" ? "75 %" : det.est === "completo" ? "completo" : det.est === "sinIva" ? "no entró" : "parcial"}</b></div>` : "") + `<div class="big">`); }
  else if(n.fac && c.bv > 0){ const iv = cbIvaDe(n, c.bv);
    s.innerHTML = s.innerHTML.replace('<div class="big">', `<div><span>IVA ${IVAP} % aparte</span><b class="num">${cbM(iv.iva, n)}</b></div>` + (iv.rt ? `<div><span>Retención ${iv.rt} % del IVA</span><b class="num">−${cbM(iv.ret, n)}</b></div>` : "") +
      `<div><span>IVA que paga el cliente</span><b class="num">${cbM(iv.paga, n)}</b></div><div class="big">`); }
  $("cbGo").disabled = c.nom <= 0 || sobra || sinTasa || sinTasaB || CB.busy || cbCapLeyendo(); $("cbGo").textContent = CB.busy ? "GUARDANDO…" : cbCapLeyendo() ? "LEYENDO LAS CAPTURAS…" : CB.edit ? "GUARDAR CORRECCIÓN" : "GUARDAR COBRO";
  $("cbErr").textContent = sobra ? (n.fac ? "Eso es más que el neto (" + cbM(x.saldo, n) + ") y el IVA (" + cbM(cbIvaPend(n), n) + ") que faltan." : "Eso es más de lo que falta de la nota (" + cbM(x.saldo, n) + ").") : sinTasa ? "Escribe la tasa acordada con el cliente: es obligatoria cuando una nota en USD se paga en bolívares." : sinTasaB ? "Escribe la tasa BCV del día del pago para pasar los bolívares a dólares BCV." : CB.err;
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
function cbSigRec(ad){
  if(ad){ let n = 0; try{ n = Number(localStorage.getItem(LSN + "-a")) || 0; }catch(e){}
    [].concat(cbCobros(), (AD.cb && AD.cb.d && AD.cb.d.cob) || []).forEach(c => { const m = /^A-(\d+)$/.exec(c.rec || ""); if(m) n = Math.max(n, Number(m[1])); });
    n += 1; try{ localStorage.setItem(LSN + "-a", String(n)); }catch(e){} return "A-" + ("000" + n).slice(-4); }
  let n = 0, pre = ""; try{ n = Number(localStorage.getItem(LSN)) || 0; }catch(e){}
  cbCobros().filter(c => !c.ad).forEach(c => { const m = /^([A-Z]+)-(\d+)$/.exec(c.rec || ""); if(m){ pre = pre || m[1]; n = Math.max(n, Number(m[2])); } });
  n += 1; try{ localStorage.setItem(LSN, String(n)); }catch(e){}
  const t = String((S.yo && S.yo.tag) || "x").toUpperCase();
  return (pre || (t.charAt(0) === "A" ? t.charAt(0) + t.charAt(t.length - 1) : t.charAt(0))) + "-" + ("000" + n).slice(-4);
}
function cbCambioRec(o, c){ if(o.rec && c.rec && o.rec !== c.rec) CB.avisos.push("El recibo " + o.rec + " de " + (c.cn || "un cliente") + " quedó registrado con el número " + c.rec + ". Si ya se lo enviaste al cliente, envíale el nuevo."); }
const cbB64 = o => { const b = new TextEncoder().encode(JSON.stringify(o)); let s = ""; b.forEach(x => s += String.fromCharCode(x)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const cbUid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
function cbMerge(c){ CB.cobros = [c].concat((CB.cobros || []).filter(x => x.id !== c.id)); cbSave(); }
/* devuelve {ok, cobro} | {err} (el servidor lo rechazó) | {net:true} (sin conexión) */
async function cbEnviar(o){
  let r;
  try{ r = await cbSrv("cobro", { x:cbB64({ id:o.id, rec:o.rec || "", n:o.n, ef:o.ef, us:o.us, ze:o.ze, mp:o.mp || 0, bs:o.bs, iv:o.iv || 0, ab:o.ab, bv:o.bv, dd:o.dd || 0, tb:o.tb || "", ta:o.ta || 0,
    bsb:o.bsb || 0, tbc:o.tbc || 0, fp:o.fp || "", ct:o.ct || "", cd:o.cd || "", lx:o.lx || "", rf:o.rf || "", cn:o.cn }), ...(o.ad ? { k:S.adm } : {}) }); }catch(e){ return { net:true }; }
  if(r && r.estado === "ok" && r.cobro){ if(r.aviso) CB.avisos.push(r.aviso); return { ok:true, cobro:Object.assign(r.cobro, o.ad ? { ad:1 } : {}), reg:r.reg }; }
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
  try{ const hace = Date.now() / 1000 - 30 * 86400, ids = (S.nt || []).filter(r => r[7] >= 0.01 || r[13] || (r[12] || []).some(p => p[2] >= hace)).map(x => x[0]).slice(-90).join(",");
    const r = await cbSrv("cobros", ids ? { ids } : {}); if(r && r.estado === "ok" && Array.isArray(r.cobros)){ CB.cobros = r.cobros; if(Array.isArray(r.sol)) CB.sol = r.sol; if(r.ret && typeof r.ret === "object") CB.ret = r.ret; if(Array.isArray(r.tasas) && r.tasas.length) CB.tasas = r.tasas; cbSave(); cbVivo(r.nt); } else if(r && r.estado === "no") CB.sync = "este dispositivo no está autorizado para cobros"; }
  catch(e){ CB.sync = "sin conexión: se muestra lo último guardado"; }
  cbCapFlush();
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
function cobAbre(){ cbLoad(); CB.nota = null; CB.edit = null; CB.rec = null; CB.ok = null; CB.del = null; CB.tab = CB.tab || "pend"; CB.rc.ficha = null; cobRender(); cobBadge(); cbRefresca(); if(CB.tab === "rc") rcCarga(true); }

/* ---------- guardar ---------- */
async function cbGuardar(){
  const x = cbSaldoNota(); if(!x || CB.busy) return; const c = cbCalc(x.n, CB.f, x.saldo);
  if(c.nom <= 0 || c.bv > x.saldo + 0.5 || c.iv > cbIvaPend(x.n) + 0.5 || (!esB(x.n) && c.bs > 0 && !(cbNum(CB.f.ta) > 0))) return;
  const det = cbIvaDetecta(x.n, x.saldo, c), caps = (CB.caps || []).slice(), lecs = caps.filter(k => k.lec).map(k => k.lec);   // se calcula antes de guardar: después el cobro ya cuenta en el IVA recibido
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
  const o = { id:cbUid(), n:x.n.id, nn:x.n.num, cn:cbCliente(x.n.cid), t:Math.floor(Date.now() / 1000), nom:c.nom, ab:c.ab, bv:c.bv, iv:c.iv, dd:c.dd, tb:esB(x.n) ? "b" : "", ef:c.ef, us:c.us, ze:c.ze, mp:c.mp, bs:c.bs,
    ta:c.bs > 0 && !esB(x.n) ? cbNum(CB.f.ta) : 0, bsb:c.bs > 0 ? cbNum(CB.f.bsb) : 0, tbc:c.bs > 0 && esB(x.n) && cbNum(CB.f.bsb) > 0 ? Number(String(CB.f.tb || "").replace(",", ".")) || 0 : 0,
    fp:/^\d{4}-\d{2}-\d{2}$/.test(CB.f.fp || "") ? CB.f.fp : "", ct:lecs.filter(l => l.met && l.met !== "ef").map(l => l.ct || "?").join(","), cd:lecs.filter(l => l.met && l.met !== "ef" && !l.ct).map(l => l.dest || "").filter(Boolean).join(" · ").slice(0, 120),
    lx:lecs.map(l => [l.met, l.mon, l.monto, l.fecha + (l.fechaDe === "imagen" ? "(img)" : ""), l.hora, l.ref].join(" ")).join(" | ").slice(0, 300),
    rf:(CB.f.rf || "").trim().slice(0, 120), est:"cola", rec:"", fa:x.n.fac ? x.n.fac[0] : "", cap:caps.length };
  if(S.adm && CB.adNota && CB.adNota[0] === x.n.id && VISTA === "admin") o.ad = 1;
  o.rec = cbSigRec(!!o.ad);
  const r = await cbEnviar(o); CB.busy = false;
  if(r.err){ CB.err = /mayor que lo que falta/.test(r.err) ? r.err + ". Holded ya tiene registrado un pago de esta nota; el saldo de esta pantalla estaba atrasado y se está actualizando." : r.err; CB.t0 = 0; cobRender(); cbRefresca(); return; }
  let cobro, reg = null;
  if(r.ok){ cobro = r.cobro; reg = r.reg || null; cbCambioRec(o, cobro); cbMerge(cobro); } else { cobro = o; CB.cola.push(o); cbSave(); }
  caps.forEach((k, i) => { if(k.f) cbCapGuarda(o.id, cobro.rec, k.f, i); });                // las capturas se suben aparte, sin hacer esperar el recibo
  if(det){ CB.avisos.push("Nota " + x.n.num + ": " + det.txt);                                 // IVA: completo, retención 75/100 o incompleto
    if((det.est === "completo" || det.est === "r75") && det.rt !== ((cbRet(x.n) || {}).rt || 0)) cbRetSet(x.n.id, det.rt, null); }
  cbCapLimpia();
  CB.f = cbF0(); CB.mpOn = false; CB.bsOn = false; CB.tbMan = false; CB.nota = null; CB.ok = { cobro, reg }; cobRender(); cobBadge(); window.scrollTo(0, 0);
}

/* ---------- recibo (imagen + texto) ---------- */
function cbReciboTxt(c){
  const n = cbNotas().find(x => x.id === c.n), saldo = n ? cbVisible(n).saldo : null;
  return `Recibo ${c.rec} · ${c.cn} · Nota ${c.nn} · Cobrado ${money(c.nom)}${saldo != null ? " · Saldo " + cbM(saldo, n) : ""}\nRecibo sujeto a verificación. NTX Original Parts`;
}
function cbImg(c){
  return new Promise(res => {
    const n = cbNotas().find(x => x.id === c.n), saldo = n ? cbVisible(n).saldo : null, b = esB(n) || c.tb === "b";
    const W = 900, filas = [["Cliente", c.cn || ""], ["Nota", c.nn || ""]].concat([[b ? "Bolívares (dólares BCV)" : "Bolívares (en $)", c.bs], ["Efectivo", c.ef], ["USDT / USDC", c.us], ["Zelle", c.ze], ["Transferencia Mercantil Panamá", c.mp]].filter(x => x[1] > 0).map(x => [x[0], money(x[1])]));
    if(Number(c.bsb) > 0) filas.push(["Pagado en bolívares", "Bs " + cbCom(c.bsb) + (Number(c.tbc || c.ta) > 0 ? " a " + cbCom(Number(c.tbc || c.ta), 4) : "")]);
    if(Number(c.iv) > 0) filas.push(["IVA incluido en el pago", money(c.iv) + (b ? " BCV" : "")]);
    if(Number(c.dd) > 0) filas.push(["Descuento pago en divisas", c.dd + " %"]);
    if(b && Math.abs(cbBv(c, n) - c.nom) >= 0.01) filas.push(["Abonado a la nota", money(cbBv(c, n)) + " BCV"]);
    if(c.ta && !(Number(c.bsb) > 0)) filas.push(["Tasa", String(c.ta)]); if(c.rf) filas.push(["Referencia", c.rf]);
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
  const c = cbCobros().find(x => x.id === id) || (CB.ok && CB.ok.cobro && CB.ok.cobro.id === id ? CB.ok.cobro : null); if(!c || !c.rec) return; const txt = cbReciboTxt(c);
  try{ const blob = CB.img[c.id] || await cbImg(c); CB.img[c.id] = blob; await navigator.share({ files:[new File([blob], "Recibo " + c.rec + ".png", { type:"image/png" })], text:"Recibo " + c.rec + " · Nota " + (c.nn || "") }); }
  catch(e){ if(e && e.name === "AbortError") return; CB.avisos.push("Este teléfono no dejó compartir la imagen. Usa «Enviar solo el texto por WhatsApp»."); cobRender(); }
}

/* ---------- facturas AdriMan: pantallas del vendedor ---------- */
/* debajo de cada nota de la lista: su estado de factura y el botón para pedirla */
function cbFilaAcc(n, saldo){
  const s = cbSolDe(n);
  if(n.fac){ const ip = cbIvaDe(n, saldo), rt = ip.rt, f = saldo < 0.01 ? cbIvaFalta(n) : 0;
    if(saldo < 0.01) return `<div class="cbx"><small>Neto cobrado · ${f >= 0.01 ? "falta IVA <b class=\"num\">" + cbM(f, n) + "</b>" : "IVA resuelto"}${rt ? " · retiene " + rt + " %" : ""}</small><button class="mini" data-cb="open" data-id="${esc(n.id)}">${f >= 0.01 ? "Anotar IVA" : "Ver"}</button></div>`;
    return `<div class="cbx"><small>IVA aparte: <b class="num">${cbM(ip.iva, n)}</b>${rt ? " · retiene " + rt + " %" : ""}</small><button class="mini" data-cb="open" data-id="${esc(n.id)}">${rt ? "Retención" : "IVA y retención"}</button></div>`; }
  if(s) return `<div class="cbx"><span class="st low">Factura solicitada</span><button class="mini" data-cb="facnew" data-id="${esc(n.id)}">Ver o cambiar</button></div>`;
  if(!esB(n)) return "";   // la factura legal solo se pide para notas emitidas en BCV
  return `<div class="cbx"><small>Sin factura legal</small><button class="mini" data-cb="facnew" data-id="${esc(n.id)}">Solicitar factura</button></div>`;
}
/* en la pantalla de la nota: pedir la factura, o (ya facturada) IVA aparte, retención y comprobante */
function cbFacBox(n, x){
  const s = cbSolDe(n);
  if(!n.fac){
    if(!s && !esB(n)) return "";   // la factura legal solo se pide para notas emitidas en BCV
    return `<div class="box"><span class="lbl">Factura legal</span>` + (s
      ? `<div class="sel"><span><b>Factura solicitada</b><small>${esc(cbHora(s.t))}${s.cm ? " · " + esc(s.cm.slice(0, 80)) + (s.cm.length > 80 ? "…" : "") : ""}</small></span></div>
        <div class="f cbfa"><button class="txt" data-cb="facnew" data-id="${esc(n.id)}">Cambiar comentarios</button><button class="txt" data-cb="faccancel" data-id="${esc(s.id)}">Cancelar solicitud</button></div>`
      : `<p class="hint">Si el cliente necesita factura con IVA, solicítala aquí. Con la factura, el monto de esta nota se entiende como neto y el IVA lo paga el cliente aparte.</p><button class="ghost" data-cb="facnew" data-id="${esc(n.id)}">SOLICITAR FACTURA</button>`) + `</div>`;
  }
  const rr = cbRet(n) || {}, rt = rr.rt || 0, ip = cbIvaDe(n, x.saldo), cp = rt ? rr.cp || "" : "", chip = (k, l, cur, at) => `<button data-cb="${at}" data-id="${esc(n.id)}" data-k="${k}" aria-pressed="${cur === k}">${l}</button>`;
  return `<div class="box"><span class="lbl">Factura AdriMan ${esc(n.fac[0])}</span>
    <p class="hint">Nota facturada: el monto a cobrar es el neto. El IVA lo paga el cliente aparte.</p>
    <div class="cbsum"><div><span>Neto que falta</span><b class="num">${cbM(x.saldo, n)}</b></div>${x.saldo >= 0.01 ? `<div><span>IVA ${IVAP} % de lo que falta</span><b class="num">${cbM(ip.iva, n)}</b></div>` : ""}` +
    (cbIvaRec(n) >= 0.01 || x.saldo < 0.01 ? `<div><span>IVA de la factura</span><b class="num">${cbM(cbIvaT(n), n)}</b></div><div><span>IVA ya recibido</span><b class="num">${cbM(cbIvaRec(n), n)}</b></div><div><span>IVA que falta${rt ? " (con la retención)" : ""}</span><b class="num">${cbM(cbIvaFalta(n), n)}</b></div>` : "") +
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
function cbArchivo(f, max, q){
  return new Promise((res, rej) => {
    if(f.size > 12e6) return rej(new Error("El archivo pesa más de 12 MB."));
    if(f.type === "application/pdf"){
      if(f.size > 6e6) return rej(new Error("El PDF pesa más de 6 MB. Mándalo por WhatsApp."));
      const fr = new FileReader(); fr.onload = () => res({ tipo:"application/pdf", b64:String(fr.result).split(",")[1] }); fr.onerror = () => rej(new Error("No se pudo leer el archivo.")); fr.readAsDataURL(f); return; }
    if(!/^image\//.test(f.type)) return rej(new Error("Sube una foto o un PDF."));
    const url = URL.createObjectURL(f), im = new Image();
    im.onload = () => { const k = Math.min(1, (max || 1800) / Math.max(im.width, im.height)), cv = document.createElement("canvas"); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
      const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      res({ tipo:"image/jpeg", b64:cv.toDataURL("image/jpeg", q || .82).split(",")[1] }); };
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

/* ---------- administración (solo la ve Mango: la llave viene dentro de sus datos cifrados) ----------
   Tres pestañas: Pedidos · Presupuestos · Facturas (con Retenciones como filtro). Datos: a=bandeja (pedidos, presupuestos, cola, revisar, hechos)
   y a=adm (solicitudes de factura y retenciones). Contrato en herramientas/PEDIDOS.md. Nada recarga la página: todo se pinta sobre vCob. */
const AD = { sol:[], ret:[], ped:[], pre:[], cola:[], rev:[], hechos:[], cfg:{ hechosDias:7, presVence:15 }, ahora:0, recv:0,
  tab:"ped", sub:"sol", ven:"", err:"", errB:"", busy:false, cargado:false, cargB:false, t:0, gen:0, abre:{}, fold:{}, tt:0 };
async function admSrv(a, ex){
  const res = await fetch(SCRIPT_URL + "?" + new URLSearchParams(Object.assign({ a, k:S.adm }, ex || {})).toString(), { cache:"no-store", redirect:"follow" });
  return JSON.parse(await res.text());
}
const admNorm = s => String(s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const admEsYo = s => { const n = admNorm(s); return !n || n === "rm" || n.indexOf("mango") === 0; };
const admVenOk = s => !AD.ven ? true : AD.ven === "__yo" ? admEsYo(s) : admNorm(s) === admNorm(AD.ven);
const admVenTxt = s => admEsYo(s) ? "Mango" : s;
function admBadge(){
  const b = $("admN"); if(!b) return;
  const stock = AD.hechos.filter(h => !h.ok && !h.visto && /STOCK:/.test(String(h.avisos || ""))).length;
  const n = AD.ped.length + AD.rev.length + AD.sol.filter(q => q.est === "pendiente").length + AD.ret.filter(r => !r.rec).length + stock + (AD.cb ? admCobN() : 0);
  b.hidden = !n; b.textContent = n;
}
function admAplica(r){ if(r && r.estado === "ok"){ AD.sol = r.sol || []; AD.ret = r.ret || []; AD.err = ""; AD.cargado = true; return true; } AD.err = (r && r.msg) || "No se pudo leer la bandeja de facturas."; return false; }
function admAplicaB(r){
  if(r && r.estado === "ok"){
    AD.ped = r.ped || []; AD.pre = r.pre || []; AD.cola = r.cola || []; AD.rev = r.rev || []; AD.hechos = r.hechos || []; AD.cfg = r.cfg || AD.cfg;
    AD.ahora = r.ahora || Math.floor(Date.now() / 1000); AD.recv = Date.now(); AD.errB = ""; AD.cargB = true; return true;
  }
  AD.errB = (r && r.estado === "no") ? "Esta llave de administración ya no es válida." : (r && r.msg) || "No se pudo leer la bandeja de pedidos."; return false;
}
const admEscribiendo = () => !!(document.activeElement && document.activeElement.matches && document.activeElement.matches("input,textarea"));
async function admCarga(forzar){
  if(!S.adm) return; AD.t = Date.now(); const g = AD.gen;
  await Promise.all([
    (async () => { try{ admAplica(await admSrv("adm")); }catch(e){ AD.err = "Sin conexión."; } })(),
    (async () => { try{ const r = await admSrv("bandeja", forzar ? { f:1 } : null); if(g === AD.gen) admAplicaB(r); }catch(e){ AD.errB = "Sin conexión."; } })(),
    admCobCarga(forzar)
  ]);
  admBadge(); if(VISTA === "admin" && !admEscribiendo()) admRender();
}
function admAbre(){ admRender(); admCarga(); }
async function admAcc(ex, msg){
  if(AD.busy) return; AD.busy = true;
  try{ if(admAplica(await admSrv("admacc", ex))) admToast(msg || ""); }catch(e){ AD.err = "Sin conexión: no se guardó. Intenta de nuevo."; }
  AD.busy = false; admBadge(); admRender();
}
/* cambios de la bandeja (ocultar, mostrar, revisado): se ven al instante y el servidor confirma después */
async function admBac(ex, msg, local, undo){
  AD.gen++; if(local) local(); admBadge(); admRender(); admToast(msg, undo);
  try{ const r = await admSrv("bacc", ex); if(!admAplicaB(r)){ await admCarga(true); return; } }
  catch(e){ AD.errB = "Sin conexión: el cambio no se guardó."; admCarga(true); return; }
  admBadge(); admRender();
}
function admToast(txt, undo){
  let t = $("admToast");
  if(!t){ t = document.createElement("div"); t.id = "admToast"; t.setAttribute("role", "status");
    t.addEventListener("click", e => { const b = e.target.closest("[data-undo]"); if(!b) return; const id = b.dataset.undo, fn = AD.undoFn; AD.undoFn = null; admToast("");
      if(id === "fn"){ if(fn) fn(); return; } admBac({ h:id, e:"mostrar" }, "Devuelto a la bandeja"); });
    document.body.appendChild(t); }
  clearTimeout(AD.tt); if(!txt){ t.className = ""; return; }
  AD.undoFn = typeof undo === "function" ? undo : null;
  t.innerHTML = `<span>${esc(txt)}</span>` + (undo ? `<button data-undo="${typeof undo === "function" ? "fn" : esc(undo)}">Deshacer</button>` : ""); t.className = "on";
  AD.tt = setTimeout(() => { t.className = ""; }, undo ? 6000 : 2600);
}
function admCopia(txt){
  const ok = () => admToast("Copiado: pégalo en el chat con Claude");
  const viejo = () => { const t = document.createElement("textarea"); t.value = txt; t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select(); try{ document.execCommand("copy"); ok(); }catch(e){} t.remove(); };
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, viejo); else viejo();
}
const admTxt = q => "Factura fiscal " + q.nn + "\nCliente: " + q.cn + "\nVendedor: " + q.ven + (q.cm ? "\nInstrucciones del vendedor: " + q.cm : "\nSin instrucciones adicionales del vendedor.");
const ADM_VEND = ["Elías", "Gabriel", "Natasha", "Nersi", "Randy"];
const ADM_SVG = {
  ok:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  pr:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4L2.8 20h18.4L12 4z"/><path d="M12 10v4.5M12 17.4v.1"/></svg>',
  cv:'<svg class="cv" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'
};
const admAnt = d => d <= 0 ? "hoy" : d === 1 ? "ayer" : "hace " + d + " días";
const admAgCl = d => d > 2 ? "ag2" : d >= 1 ? "ag1" : "";
const admAhora = () => (AD.ahora || Math.floor(Date.now() / 1000)) + Math.floor((Date.now() - (AD.recv || Date.now())) / 1000);
function admHace(ts){
  const m = Math.max(0, Math.round((admAhora() - ts) / 60));
  return m < 1 ? "ahora mismo" : m < 60 ? "hace " + m + " min" : m < 1440 ? "hace " + Math.round(m / 60) + " h" : "hace " + Math.round(m / 1440) + " d";
}
function admVends(){
  const vistos = {}, extra = [];
  [].concat(AD.ped, AD.pre, AD.cola, AD.rev, AD.hechos).forEach(x => { const n = admNorm(x.vend); if(n && !admEsYo(x.vend) && !vistos[n]){ vistos[n] = 1; extra.push(x.vend); } });
  const base = ADM_VEND.slice(); extra.forEach(n => { if(!base.some(b => admNorm(b) === admNorm(n))) base.push(n); }); return base;
}
function admChips(){
  const L = [["", "Todos"]].concat(admVends().map(n => [n, n]), [["__yo", "Yo"]]);
  return `<div class="achips" role="group" aria-label="Vendedor">${L.map(([k, l]) => `<button class="achip" data-ad="ven" data-k="${esc(k)}" aria-pressed="${AD.ven === k}">${esc(l)}</button>`).join("")}</div>`;
}
const admCli = v => v.nuevo ? "Cliente nuevo" + (v.nombreNuevo ? ": " + v.nombreNuevo : v.cliente && !/^\s*cliente nuevo\s*$/i.test(String(v.cliente)) ? ": " + v.cliente : "") : (v.cliente || "Sin cliente");
function admCard(v, conAnt){
  const ab = !!AD.abre[v.id], nl = (v.lineas || []).length, cl = conAnt ? admAgCl(v.dias) : "";
  const cred = v.contado ? "Contado" : v.vence > 0 ? v.vence + " días" : "Sin crédito";
  const tar = v.tarifa === "bcv" ? "BCV" : v.tarifa === "usd" ? "USD" : "";
  const lin = ab ? `<div class="aol">` + (v.lineas || []).map(l => { const u = Number(l[1]) || 0, p = Number(l[2]) || 0, d = Number(l[3]) || 0;
      return `<div><b>${esc(l[0])}</b><span class="num">${u} × ${money(p)}${d ? " −" + d + " %" : ""}</span><span class="num">${money(u * p * (1 - d / 100))}</span></div>`; }).join("") + `</div>` : "";
  return `<article class="od ao ${cl}"><button class="aoh" data-ad="abre" data-id="${esc(v.id)}" aria-expanded="${ab}">
      <span class="ah1"><b class="aoc">${esc(admCli(v))}</b><b class="bs num aot">${money(v.total)}</b></span>
      <span class="aom"><span class="num">${esc(v.num)}</span> · ${esc(admVenTxt(v.vend))}${v.fecha ? " · " + esc(cbFecha(v.fecha)) : ""} · <span class="agx">${admAnt(v.dias)}</span></span>
      <span class="aoch">${tar ? `<span class="tg">${tar}</span>` : ""}<span class="tg ne">${esc(cred)}</span><span class="tg ne">${nl} ${nl === 1 ? "línea" : "líneas"}</span>${ADM_SVG.cv}</span>
      ${v.nota ? `<span class="aon">📝 ${esc(v.nota)}</span>` : ""}</button>${lin}
    <div class="f"><button class="txt" data-ad="cop" data-num="${esc(v.num)}">Copiar para Claude</button><button class="txt" data-ad="ocu" data-id="${esc(v.id)}">Ocultar</button></div></article>`;
}
/* franjas: azul = ya salió del teléfono y va camino a Holded · ámbar = no se creó, hay que mirarlo */
function admFranjas(tipo){
  const es = x => (x.tipo === "presupuesto") === (tipo === "presupuesto") && admVenOk(x.vend);
  const cola = AD.cola.filter(es), rev = AD.rev.filter(es); let h = "";
  const bas = x => `<b>${esc(x.cliente || "Sin cliente")}</b> · ${esc(admVenTxt(x.vend))} · ${esc(x.tipo === "presupuesto" ? "Presupuesto" : "Pedido")}`;
  if(cola.length) h += `<section class="astr az"><h3>En camino a Holded (${cola.length})</h3>` + cola.map(x => `<div class="ar"><div>${bas(x)}</div><small>Recibido ${esc(admHace(x.recibido))}${x.lineas ? " · " + esc(x.lineas) : ""}</small>${x.nota ? `<small>📝 ${esc(x.nota)}</small>` : ""}</div>`).join("") + `</section>`;
  if(rev.length) h += `<section class="astr am"><h3>Revisar (${rev.length})</h3>` + rev.map(x => `<div class="ar"><div>${bas(x)}</div><div class="mot">${esc(x.obs || "No se pudo crear en Holded")}</div><small>Recibido ${esc(admHace(x.recibido))}${x.lineas ? " · " + esc(x.lineas) : ""}</small>${x.nota ? `<small>📝 ${esc(x.nota)}</small>` : ""}
      <div class="f"><button class="txt" data-ad="ocu" data-id="${esc(x.id)}">Descartar</button></div></div>`).join("") + `</section>`;
  return h;
}
/* qué le falta a una nota hecha: envío, vencimiento, descuento, nota del vendedor y avisos. El descuento global se espera una hora (Mango imprime y luego lo aplica). */
function admProbs(h){
  const p = [], t = s => String(s == null ? "" : s).trim(); let espera = false;
  const envio = t(h.envio); if(envio && !/^(ok|n\/a|enviado solo)/i.test(envio)) p.push({ k:"Envío", t:envio, c:/no se pudo/i.test(envio) ? "rojo" : "" });
  const venc = t(h.venc); if(venc && !/^(ok|corregido|pagada)/i.test(venc)) p.push({ k:"Vencimiento", t:venc, c:"" });
  const desc = t(h.desc);
  if(/^falta/i.test(desc)){ if(admAhora() - (h.primera || 0) > 3600) p.push({ k:"Descuento", t:desc, c:"" }); else espera = true; }
  const nv = t(h.notaV); if(/^(falta|leer)/i.test(nv)) p.push({ k:"Nota del vendedor", t:nv, c:"" });
  t(h.avisos).split(" · ").map(t).filter(Boolean).forEach(a => p.push({ k:"", t:a, c:/^STOCK:/i.test(a) ? "rojo" : "" }));
  return { p, espera };
}
function admHechos(tipo){
  const hs = AD.hechos.filter(h => (h.tipo === "presupuesto") === (tipo === "presupuesto") && admVenOk(h.vend)), ab = !!AD.fold["h" + tipo], n = hs.length;
  let h = `<button class="afold" data-ad="fold" data-k="h${tipo}" aria-expanded="${ab}"><span>Hechos · últimos ${AD.cfg.hechosDias || 7} días (${n})</span>${ADM_SVG.cv}</button>`;
  if(!ab) return h;
  if(!n) return h + `<div class="box"><p class="hint">Nada en los últimos ${AD.cfg.hechosDias || 7} días.</p></div>`;
  return h + `<div class="ahg">` + hs.map(x => {
    const pr = admProbs(x), ok = !!x.ok || !!x.visto || !pr.p.length;
    return `<div class="ahh ${ok ? "ok" : "pr"}"><div class="ahl"><span class="ahi">${ok ? ADM_SVG.ok : ADM_SVG.pr}</span>
      <span class="ahx"><span class="num">${esc(x.origen || "")} → ${esc(x.nota || "")}</span> · <span class="num">${money(x.total)}</span> · ${esc(cbFecha(x.fecha))}<small>${esc(x.cliente || "")} · ${esc(admVenTxt(x.vend))}${x.visto && !x.ok ? " · revisado" : ""}</small></span></div>
      ${!ok ? `<ul class="ahp">${pr.p.map(q => `<li class="${q.c}">${q.k ? "<b>" + esc(q.k) + ":</b> " : ""}${esc(q.t)}</li>`).join("")}</ul>` : pr.espera ? `<ul class="ahp"><li class="esp">Descuento: aún dentro de la hora para aplicarlo.</li></ul>` : ""}
      ${!ok ? `<div class="f"><button class="txt" data-ad="rev" data-n="${esc(x.notaId)}">Revisado</button></div>` : x.visto && !x.ok ? `<div class="f"><button class="txt" data-ad="norev" data-n="${esc(x.notaId)}">Reabrir</button></div>` : ""}</div>`;
  }).join("") + `</div>`;
}
function admPedidos(tipo){
  const es = tipo === "presupuesto", lista = (es ? AD.pre : AD.ped).filter(v => admVenOk(v.vend)), vig = es ? lista.filter(v => !v.vencido) : lista, venc = es ? lista.filter(v => v.vencido) : [];
  let h = admFranjas(tipo);
  if(vig.length) h += vig.map(v => admCard(v, !es)).join("");
  else if(!h && !venc.length) h += `<div class="box"><p class="hint">${AD.cargB ? (es ? "No hay presupuestos abiertos." : "No hay pedidos por convertir en nota.") : "Cargando…"}</p></div>`;
  if(venc.length){ const ab = !!AD.fold.venc;
    h += `<button class="afold" data-ad="fold" data-k="venc" aria-expanded="${ab}"><span>Vencidos (${venc.length}) · ${AD.cfg.presVence || 15} días o más</span>${ADM_SVG.cv}</button>` + (ab ? venc.map(v => admCard(v, false)).join("") : ""); }
  return h + admHechos(tipo);
}
function admFacturas(){
  const ps = AD.sol.filter(q => q.est === "pendiente" && admVenOk(q.ven)), hs = AD.sol.filter(q => q.est !== "pendiente" && admVenOk(q.ven));
  const pr = AD.ret.filter(r => !r.rec && admVenOk(r.ven)), rr = AD.ret.filter(r => r.rec && admVenOk(r.ven));
  let h = `<div class="achips" role="group" aria-label="Filtro de facturas">${[["sol", "Solicitudes" + (ps.length ? " (" + ps.length + ")" : "")], ["ret", "Retenciones" + (pr.length ? " (" + pr.length + ")" : "")]].map(([k, l]) => `<button class="achip" data-ad="sub" data-k="${k}" aria-pressed="${AD.sub === k}">${l}</button>`).join("")}</div>`;
  if(AD.sub === "sol"){
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
  return h;
}
function admRender(){
  const el = $("vCob"); if(!el) return;
  if(!S.adm){ el.innerHTML = `<div class="box"><p class="hint">Esta sección es solo de administración.</p></div>`; return; }
  if(AD.tab === "cob" && admCobForm(el)) return;                                         // cobro de administración: formulario o recibo
  const nC = AD.cb ? admCobN() : 0;
  const nP = AD.ped.filter(v => admVenOk(v.vend)).length, nQ = AD.pre.filter(v => !v.vencido && admVenOk(v.vend)).length;
  const nF = AD.sol.filter(q => q.est === "pendiente" && admVenOk(q.ven)).length + AD.ret.filter(r => !r.rec && admVenOk(r.ven)).length;
  const tabs = `<div class="seg fl tabs" role="group" aria-label="Administración">${[["ped", "Pedidos" + (nP ? " (" + nP + ")" : "")], ["pre", "Presupuestos" + (nQ ? " (" + nQ + ")" : "")], ["fac", "Facturas" + (nF ? " (" + nF + ")" : "")], ["cob", "Cobros" + (nC ? " (" + nC + ")" : "")]].map(([k, l]) => `<button data-ad="tab" data-k="${k}" aria-pressed="${AD.tab === k}">${l}</button>`).join("")}</div>`;
  const err = AD.tab === "cob" ? "" : (AD.tab === "fac" ? AD.err : AD.errB) || ""; let h = tabs + admChips() + (err ? `<div class="msg">${esc(err)}</div>` : "");
  h += AD.tab === "fac" ? admFacturas() : AD.tab === "cob" ? admCobros() : admPedidos(AD.tab === "pre" ? "presupuesto" : "pedido");
  h += `<p class="hint">${AD.recv ? "Actualizado " + esc(new Date(AD.recv).toLocaleTimeString("es-VE", { hour:"numeric", minute:"2-digit" })) + " · " : ""}Se actualiza sola cada 3 minutos; jala hacia abajo para actualizar ahora.</p>`;
  el.innerHTML = h;
}
$("vCob").addEventListener("click", e => {
  const a = e.target.closest("[data-ad]"); if(!a || VISTA !== "admin") return; const k = a.dataset.ad, id = a.dataset.id;
  if(k === "tab"){ AD.tab = a.dataset.k; if(AD.tab === "cob") admCobCarga(); admRender(); window.scrollTo(0, 0); }
  else if(k === "sub"){ AD.sub = a.dataset.k; admRender(); }
  else if(k === "ven"){ AD.ven = a.dataset.k; admRender(); }
  else if(k === "abre"){ AD.abre[id] = !AD.abre[id]; admRender(); }
  else if(k === "fold"){ AD.fold[a.dataset.k] = !AD.fold[a.dataset.k]; admRender(); }
  else if(k === "cop") admCopia("convierte " + a.dataset.num + " en nota");
  else if(k === "ocu") admBac({ h:id, e:"ocultar" }, "Quitado de la bandeja", () => { ["ped", "pre", "cola", "rev"].forEach(c => { AD[c] = AD[c].filter(x => x.id !== id); }); }, id);
  else if(k === "rev") admBac({ n:a.dataset.n, e:"revisado" }, "Marcado como revisado", () => { AD.hechos.forEach(x => { if(x.notaId === a.dataset.n) x.visto = Math.floor(Date.now() / 1000); }); });
  else if(k === "norev") admBac({ n:a.dataset.n, e:"pendiente" }, "Vuelve a quedar pendiente", () => { AD.hechos.forEach(x => { if(x.notaId === a.dataset.n) x.visto = ""; }); });
  else if(k === "copia"){ const q = AD.sol.find(x => x.id === id); if(q) admCopia(admTxt(q)); }
  else if(k === "desc") admAcc({ s:id, e:"descartada" }, "Solicitud descartada");
  else if(k === "reab") admAcc({ s:id, e:"pendiente" }, "Solicitud reabierta");
  else if(k === "rec") admAcc({ r:id, e:"recibido" }, "Comprobante marcado como recibido");
  else if(k === "norec") admAcc({ r:id, e:"pendiente" }, "Marcado como pendiente otra vez");
});
setTimeout(() => { if(S.adm) admCarga(); }, 3000);
setInterval(() => { if(S.adm && !document.hidden) admCarga(); }, 180000);
document.addEventListener("visibilitychange", () => { if(!document.hidden && S.adm && Date.now() - AD.t > 60000) admCarga(); });

/* ---------- Mis recibos: archivo de 3 meses (estilo Wallet) y ficha de la nota ----------
   Fuentes: los cobros del vendedor (el receptor los da por 90 días: a=recibos) + los pagos que administración registró en Holded sin que el
   vendedor hubiera anotado un cobro (vienen en S.nt, con la cuenta en que quedó cada pago). Un pago de Holded que ningún cobro reclama es «registrado por administración».
   Colores: azul = por confirmar · verde = confirmado · rojo = con diferencia (monto distinto, cuenta distinta, cobro no registrado). */
CB.rc = { q:"", f:"todos", open:null, ficha:null, hist:null, cargando:false, err:"", cap:{}, avBusy:"" };
const RCLS = "ntx-recibos";
try{ CB.rc.hist = JSON.parse(localStorage.getItem(RCLS) || "null"); }catch(e){}
const rcGuarda = () => { try{ localStorage.setItem(RCLS, JSON.stringify(CB.rc.hist || [])); }catch(e){} };
const RC_ET = { dif:"CON DIFERENCIA", pc:"POR CONFIRMAR", ok:"CONFIRMADO" };
const RC_MET = { "CAJA CHICA":"Efectivo", "USDT":"USDT", "NUEVO ZELLE":"Zelle", "MERCANTIL PANAMÁ":"Transferencia $ Mercantil Panamá", "Caja para Operaciones en Tránsito":"Bolívares", "Bolivares Cuenta Juridica":"Bolívares (cuenta jurídica)" };
const RC_ICO = { ok:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  dif:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  pend:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>` };
const rcTodos = () => { const m = new Map(); (CB.rc.hist || []).forEach(c => m.set(c.id, c)); cbCobros().forEach(c => m.set(c.id, c));
  return Array.from(m.values()).filter(c => c.est !== "anulado" && !(S.adm && c.ad && !(S.nt || []).some(r => r[0] === c.n))); };   // en el teléfono de Mango, los cobros A- de clientes de otros vendedores no son «suyos»
const rcDia = ts => ts ? new Date(ts * 1000).toLocaleDateString("es-VE", { day:"numeric", month:"short" }).replace(".", "") : "";
const rcDiaH = ts => ts ? cbDia(ts).toLocaleDateString("es-VE", { day:"numeric", month:"short" }).replace(".", "") : "";
const rcBs = v => "Bs " + Number(v).toLocaleString("es-VE", { minimumFractionDigits:2, maximumFractionDigits:2 });
const rcPendCap = id => (CB.capCola || []).find(x => x.id === id);
const rcPendCaps = id => (CB.capCola || []).filter(x => x.id === id).sort((a, b) => (a.i || 0) - (b.i || 0));
/* visor de capturas: pide la primera (dice cuántas hay) y luego las demás */
async function capVisor(pide, locales){
  const ov = document.createElement("div"); ov.id = "rcOv"; ov.innerHTML = `<button class="rcx" aria-label="Cerrar">Cerrar</button><div class="rcim"><p>Cargando la captura…</p></div>`; document.body.appendChild(ov);
  const cierra = () => ov.remove(); ov.querySelector(".rcx").addEventListener("click", cierra); ov.addEventListener("click", e => { if(e.target === ov || e.target.classList.contains("rcim")) cierra(); });
  const box = ov.querySelector(".rcim"), imgs = [];
  const pinta = msg => { if(!document.body.contains(ov)) return; box.innerHTML = imgs.map((u, i) => `<img alt="Captura del pago ${i + 1}" src="${u}">`).join("") + (msg ? `<p>${esc(msg)}</p>` : ""); };
  (locales || []).forEach(x => imgs.push("data:" + x.tipo + ";base64," + x.b64));
  if(!pide){ pinta(imgs.length ? "" : "No hay captura."); return; }
  try{ const r0 = await pide(0);
    if(!(r0 && r0.estado === "ok" && r0.b64)){ pinta(imgs.length ? "" : (r0 && r0.msg) || "No se pudo cargar la captura."); return; }
    imgs.unshift("data:" + r0.tipo + ";base64," + r0.b64); pinta(Number(r0.n) > 1 ? "Cargando las demás…" : "");
    for(let i = 1; i < Math.min(Number(r0.n) || 1, CAPMAX); i++){ const r = await pide(i); if(r && r.estado === "ok" && r.b64) imgs.splice(i, 0, "data:" + r.tipo + ";base64," + r.b64); pinta(i < (Number(r0.n) || 1) - 1 ? "Cargando las demás…" : ""); } }
  catch(e){ pinta(imgs.length ? "" : "Sin conexión: no se pudo cargar la captura. Intenta de nuevo."); }
}
const rcTieneCap = c => !!(c && (Number(c.cap) > 0 || rcPendCap(c.id)));
/* cuántas veces se puede ver la lista antes de pedir de nuevo al servidor */
async function rcCarga(forzar){
  if(CB.rc.cargando || (!forzar && CB.rc.t && Date.now() - CB.rc.t < 45000)) return; CB.rc.cargando = true;
  try{ const r = await cbSrv("recibos");
    if(r && r.estado === "ok" && Array.isArray(r.cobros)){ CB.rc.hist = r.cobros; CB.rc.err = ""; CB.rc.t = Date.now(); rcGuarda(); }
    else if(r && r.estado === "no") CB.rc.err = "Este dispositivo no está autorizado para cobros."; }
  catch(e){ CB.rc.err = "Sin conexión: se muestra lo último guardado."; }
  CB.rc.cargando = false;
  if(VISTA === "cobros" && CB.tab === "rc" && !CB.nota && !CB.ok && !CB.fac && !CB.rec && !(document.activeElement && document.activeElement.matches("input,textarea"))) cobRender();
}
function rcMet(c){
  const p = []; [["Efectivo", c.ef], ["USDT", c.us], ["Zelle", c.ze], ["Mercantil Panamá", c.mp]].forEach(x => { if(x[1] > 0) p.push(x[0]); });
  if(c.bs > 0) p.push(Number(c.bsb) > 0 ? rcBs(c.bsb) + (Number(c.tbc || c.ta) > 0 ? " a " + cbCom(Number(c.tbc || c.ta), 2) : "") : "Bolívares");
  if(Number(c.iv) > 0) p.push("incluye IVA " + money(c.iv));
  return p.join(" + ") + (c.rf ? " · ref. " + c.rf : "");
}
/* estado de un recibo: s = ok | dif | pend, adm = lo que dice administración */
function rcEst(c){
  if(c.ad && c.est !== "confirmado") return { s:"pend", adm:"Administración lo está registrando en Holded" };
  if(c.est === "confirmado" && c.ad && !c.dif) return { s:"ok", adm:"Registrado por administración" + (c.cr && c.cr !== "sin pago en Holded" ? " · Holded: " + c.cr : "") };
  if(c.est === "confirmado") return c.dif ? { s:"dif", adm:c.dif } : { s:"ok", adm:c.cr && c.cr !== "sin pago en Holded" ? "Holded: " + c.cr : c.cr === "sin pago en Holded" ? "Era solo IVA: no se registra en Holded" : "Registrado en Holded" };
  if(c.est === "revisar") return { s:"dif", adm:c.obs || "Administración está revisando este cobro" };
  if(c.est === "rechazo") return { s:"dif", adm:"No registrado: " + (c.obs || "administración no lo aceptó") };
  if(c.est === "cola") return { s:"pend", adm:"Sin enviar: se enviará cuando haya conexión" };
  const soloEf = c.ef > 0 && !(c.us > 0 || c.ze > 0 || c.mp > 0 || c.bs > 0);
  return { s:"pend", adm:soloEf ? "Efectivo por entregar en oficina" : "Esperando que administración lo registre" };
}
function rcRecCobro(c){ const e = rcEst(c); return { c, id:c.id, rec:c.rec || "Sin número", t:c.t || 0, dia:rcDia(c.t), met:rcMet(c), m:money(c.nom), mv:c.nom, s:e.s, adm:e.adm }; }
function rcRecAdm(p, n){
  const cta = p[3] || "", arch = !!p[4], m = money(p[1]), eq = esB(n) ? " · ≈ " + money(r2(p[1] / FBCV())) + " BCV" : "";
  return { p, n, id:"a" + p[0], rec:"", t:p[2], dia:rcDiaH(p[2]), met:(RC_MET[cta] || cta || "Pago") + eq, m, mv:p[1], s:arch ? "dif" : "ok", adm:arch ? "Holded lo registró en una cuenta archivada: " + cta : "Holded: " + m + (cta ? " en " + cta : "") };
}
function rcFichas(){
  const ahora = Math.floor(Date.now() / 1000), corte = ahora - 90 * 86400, nts = cbNotas(), todos = rcTodos(), g = {}, mapa = {};
  nts.forEach(n => { mapa[n.id] = n; });
  const reclamado = new Set(); todos.forEach(c => (c.pg || []).forEach(p => reclamado.add(p[0])));
  const F = (id, num, cn, n) => g[id] || (g[id] = { id, ne:num || "", cli:cn || "Cliente", n:n || null, recs:[] });
  todos.forEach(c => { if(!((c.t || 0) >= corte || pendiente(c))) return; const n = mapa[c.n]; F(c.n, n ? n.num : c.nn, n ? cbCliente(n.cid) : c.cn, n).recs.push(rcRecCobro(c)); });
  nts.forEach(n => {
    const pend = todos.filter(c => c.n === n.id && pendiente(c)), t0 = pend.length ? Math.min.apply(null, pend.map(c => c.t || ahora)) : 0;
    (n.pagos || []).forEach(p => {
      if(!p || reclamado.has(p[0]) || !(p[2] >= corte) || !(p[1] > 0.004)) return;
      if(t0 && p[2] >= t0 - 2 * 86400) return;                                  // casi seguro es el cobro pendiente, que Holded aún no confirma por su cuenta
      F(n.id, n.num, cbCliente(n.cid), n).recs.push(rcRecAdm(p, n));
    });
  });
  const L = Object.keys(g).map(k => g[k]);
  L.forEach(f => {
    f.recs.sort((a, b) => a.t - b.t); f.t = Math.max.apply(null, f.recs.map(r => r.t || 0));
    const c0 = (f.recs.find(r => r.c) || {}).c || {};
    f.bcv = f.n ? esB(f.n) : c0.tb === "b"; f.fac = f.n && f.n.fac ? f.n.fac[0] : (c0.fa || "");
    f.monto = money(r2(f.recs.reduce((s, r) => s + (r.mv || 0), 0)));
    f.sub = f.recs.length + (f.recs.length === 1 ? " recibo" : " recibos") + " · " + (f.bcv ? "BCV" : "nota USD") + (f.fac ? " · Fac. " + f.fac : "");
    const dif = f.recs.find(r => r.s === "dif"), pend = f.recs.filter(r => r.s === "pend"), n = f.n, rr = n ? cbRet(n) || {} : {};
    const ivaF = n && n.fac && cbVisible(n).saldo < 0.01 ? cbIvaFalta(n) : 0, sinComp = n && n.fac && rr.rt > 0 && !(rr.cp && (rr.cp !== "adjunto" || rr.url));
    if(dif){ f.est = "dif"; f.nota = !dif.c ? "Holded lo registró en una cuenta archivada" : dif.c.est === "revisar" ? "Administración está revisando un cobro" : dif.c.est === "rechazo" ? "Un cobro no quedó registrado" : /archivada/.test(dif.adm) ? "Holded lo registró en una cuenta archivada" : "Holded lo registró en otra cuenta"; }
    else if(pend.length || sinComp || ivaF >= cbIvaTol(n || {})){
      f.est = "pc";
      f.nota = sinComp ? "Retención " + rr.rt + " %: falta el comprobante" : pend.length ? (pend.every(r => r.c && r.c.ef > 0 && !(r.c.us > 0 || r.c.ze > 0 || r.c.mp > 0 || r.c.bs > 0)) ? "Efectivo por entregar en oficina" : "Esperando que administración lo registre") : "Falta IVA " + cbM(ivaF, n);
    } else { f.est = "ok"; const sd = n ? cbVisible(n).saldo : 0; f.nota = !n ? "Registrado en Holded" : sd < 0.01 && n.pend < 0.01 ? "Saldada" : "Quedan " + cbM(sd, n) + " por cobrar"; }
  });
  return L.sort((a, b) => b.t - a.t);
}
const RC_MES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
function rcFichaHtml(f, ab){
  const rec = r => `<div class="rcrr"><div class="rcrh"><b>${r.rec ? "Recibo " + esc(r.rec) + " · " + esc(r.dia) : "Pago registrado por administración · " + esc(r.dia)}</b><b class="bs">${esc(r.m)}</b></div>
      <span class="rcmt">${esc(r.met)}</span><span class="rce ${r.s}">${RC_ICO[r.s]}<span>${esc(r.adm)}</span></span>
      ${r.c ? `<div class="rcbt">${r.c.rec ? `<button class="mini" data-cb="rec" data-id="${esc(r.c.id)}">Ver recibo</button>` : ""}${rcTieneCap(r.c) ? `<button class="mini" data-cb="rccap" data-id="${esc(r.c.id)}">Ver captura</button>` : ""}</div>` : ""}</div>`;
  return `<div class="rcf${ab ? " ab" : ""}"><span class="rct ${f.est}">${RC_ET[f.est]}</span><div class="rcc">
    <button class="rch" data-cb="rcopen" data-id="${esc(f.id)}" aria-expanded="${ab}"><span class="rcl"><span class="rcne bs">${esc(f.ne)}</span><span class="rccl">${esc(f.cli)}</span></span>
      <span class="rcr"><span class="rcm bs">${esc(f.monto)}</span><span class="rcs">${esc(f.sub)}</span></span></button>
    <p class="rcn ${f.est}">${esc(f.nota)}</p>
    ${ab ? `<div class="rcd">${f.recs.map(rec).join("")}<div class="rcbt"><button class="mini dk" data-cb="rcficha" data-id="${esc(f.id)}">${f.est === "dif" ? "Ver la diferencia" : "Ver detalle"}</button></div></div>` : ""}</div></div>`;
}
function rcListaHtml(){
  const todas = rcFichas(), q = admNorm(CB.rc.q), cnt = { todos:todas.length, pc:0, dif:0, ok:0 }; todas.forEach(f => cnt[f.est]++);
  const fs = todas.filter(f => (CB.rc.f === "todos" || f.est === CB.rc.f) && (!q || admNorm(f.ne + " " + f.cli + " " + f.recs.map(r => r.rec).join(" ")).indexOf(q) >= 0));
  const y = new Date().getFullYear(), meses = []; fs.forEach(f => { const d = new Date(f.t * 1000), k = d.getFullYear() * 12 + d.getMonth(); let m = meses.find(x => x.k === k); if(!m) meses.push(m = { k, nombre:RC_MES[d.getMonth()] + (d.getFullYear() !== y ? " " + d.getFullYear() : ""), fs:[] }); m.fs.push(f); });
  let h = `<p class="hint rcsum">Últimos 3 meses · ${fs.length} ${fs.length === 1 ? "nota" : "notas"} · ${fs.reduce((s, f) => s + f.recs.length, 0)} recibos</p>`;
  meses.forEach(m => { h += `<section class="rcg"><h2 class="bs">${esc(m.nombre)}</h2>${m.fs.map(f => rcFichaHtml(f, CB.rc.open === f.id)).join("")}</section>`; });
  if(!fs.length) h += `<div class="box"><p class="hint">${todas.length ? "No hay recibos con ese filtro." : CB.rc.cargando || !CB.rc.hist ? "Cargando tus recibos…" : "Todavía no tienes recibos en los últimos 3 meses."}</p></div>`;
  return h;
}
function rcHtml(){
  const todas = rcFichas(), cnt = { todos:todas.length, pc:0, dif:0, ok:0 }; todas.forEach(f => cnt[f.est]++);
  return `<label class="rcq"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>
      <input type="search" id="rcQ" aria-label="Buscar por cliente, nota o recibo" placeholder="Cliente, nota o recibo" autocomplete="off" value="${esc(CB.rc.q)}"></label>
    <div class="achips" role="group" aria-label="Filtro">${[["todos", "Todas"], ["pc", "Por confirmar"], ["dif", "Con diferencia"], ["ok", "Confirmadas"]].map(([k, l]) => `<button class="achip" data-cb="rcf" data-k="${k}" aria-pressed="${CB.rc.f === k}">${l} ${cnt[k]}</button>`).join("")}</div>
    ${CB.rc.err ? `<div class="msg">${esc(CB.rc.err)}</div>` : ""}<div id="rcL">${rcListaHtml()}</div>`;
}
/* ---- ficha de una nota: tu recibo frente a Holded ---- */
function rcDetalleHtml(f){
  const n = f.n, row2 = (lab, v, st) => `<span class="rk ${st || ""}">${lab}</span><span class="rv ${st || ""}">${v}</span>`, rows = (lab, a, b, st) => `<span class="rk ${st || ""}">${lab}</span><span class="rv ${st || ""}">${a}</span><span class="rv ${st || ""} h">${b}</span>`;
  let h = `<button class="txt" data-cb="rcfx" style="justify-self:start">‹ Recibos</button>
    <div class="rcf"><span class="rct ${f.est}">${RC_ET[f.est]}</span><div class="rcc rcx"><div class="rch2"><span class="rcne bs big">${esc(f.ne)}</span>${n && n.pend < 0.01 ? `<span class="st ok">Saldada en Holded</span>` : ""}</div>
      <b class="rccl">${esc(f.cli)}</b><span class="rcs">${esc(f.sub)}${n ? " · total " + cbM(cbNeto(n), n) : ""}</span></div></div>`;
  f.recs.forEach(r => {
    const c = r.c;
    if(!c){ h += `<section class="rcb"><div class="rcbh"><b>Pago registrado por administración</b><span>${esc(r.dia)}</span></div><div class="rcgr two">${row2("Monto", esc(r.m))}${row2("Cuenta", esc((r.p[3] || "sin dato") + (r.p[4] ? " (archivada)" : "")), r.s === "dif" ? "dif" : "")}${row2("Fecha", esc(r.dia))}</div>
      <p class="hint" style="padding:0 14px 12px">Lo registró administración sin un cobro tuyo. ${esB(n) ? "En tu nota BCV equivale a unos " + esc(money(r2(r.mv / FBCV()))) + " BCV." : ""}</p></section>`; return; }
    const conf = c.est === "confirmado", e = rcEst(c), hold = (c.pg || []).reduce((s, p) => s + (Number(p[1]) || 0), 0), hp = n ? (c.pg || []).map(p => (n.pagos || []).find(q => q[0] === p[0])).filter(Boolean)[0] : null;
    const m = /^Holded: (.*) · tu recibo: (.*)$/.exec(c.dif || "");
    if(r.s === "dif") h += `<div class="rca" role="alert">${RC_ICO.dif}<div><b>${m ? "La cuenta no coincide" : /archivada/.test(e.adm) ? "Cuenta archivada" : c.est === "revisar" ? "Administración está revisando este cobro" : c.est === "rechazo" ? "Cobro no registrado" : "Hay una diferencia"}</b>
      <span>${m ? `Cobraste ${esc(money(c.nom))} (${esc(rcMet(c).split(" · ")[0])}). Administración lo registró en <b>${esc(m[1])}</b> y debía ir a <b>${esc(m[2])}</b>.${c.est === "confirmado" && hold && Math.abs(hold - c.ab) < 0.06 ? " El monto sí coincide." : ""}` : esc(e.adm)}</span></div></div>`;
    h += `<section class="rcb"><div class="rcbh"><b>Recibo ${esc(c.rec || "sin número")}</b><span>${esc(cbHora(c.t))}</span></div><div class="rcgr"><span class="rk"></span><span class="rv hd">TU RECIBO</span><span class="rv hd h">HOLDED</span>
      ${rows("Monto", esc(money(c.nom)) + (c.tb === "b" ? " BCV" : ""), conf ? `<span class="rok">${RC_ICO.ok}${esc(money(r2(hold)))}</span>` : `<span class="mut">Aún no está</span>`, c.est === "revisar" ? "dif" : "")}
      ${rows("Cuenta", esc(c.ch || "—"), conf ? (c.cr ? esc(c.cr.replace(/ \$[\d.,]+/g, "")) : "—") : `<span class="mut">Aún no está</span>`, c.dif ? "dif" : "")}
      ${rows("Fecha", esc(c.fp ? cbFecha2(c.fp) : rcDia(c.t)), hp ? esc(rcDiaH(hp[2])) : "—")}
      ${rows("Referencia", esc(c.rf || "—"), `<span class="mut">No la trae</span>`)}</div></section>`;
    h += `<section class="rcb rcsc"><div class="rcth" role="img" aria-label="Captura del pago">${RC_ICO.pend.replace(/<circle.*<\/svg>/, "<rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"2\"/><circle cx=\"9\" cy=\"10\" r=\"1.8\"/><path d=\"M21 16l-5-5-8 8\"/></svg>")}<span>Captura</span></div>
      <div class="rcct"><b>${rcTieneCap(c) ? "Captura del pago" : "Sin captura"}</b><span>${rcTieneCap(c) ? "La adjuntaste al cobrar. Queda guardada con el recibo." : "No adjuntaste captura a este cobro."}</span>${rcTieneCap(c) ? `<button class="mini" data-cb="rccap" data-id="${esc(c.id)}">Ver grande</button>` : ""}</div></section>`;
    const hist = [[c.t, "Cobraste y anotaste el recibo", cbHora(c.t), ""]];
    if(conf) hist.push([c.tsc || c.t, "Administración lo registró en Holded", (hp ? rcDiaH(hp[2]) + " · " : "") + (c.cr || ""), ""]);
    if(r.s === "dif" && conf) hist.push([c.tsc || c.t, c.dif ? "El sistema detectó la cuenta distinta" : "Diferencia detectada", "revisión de cada hora", "dif"]);
    if(c.est === "revisar") hist.push([c.t, "Administración lo está revisando", c.obs || "", "dif"]);
    if(c.avv) hist.push([9e9, "Avisaste a administración", c.avv, ""]);
    h += `<section class="rcb rchi"><h3 class="bs">HISTORIAL</h3><ol>${hist.sort((a, b) => a[0] - b[0]).map(x => `<li><i class="${x[3]}"></i><span><b class="${x[3]}">${esc(x[1])}</b><small>${esc(x[2])}</small></span></li>`).join("")}</ol></section>`;
    h += `<div class="rcac">${r.s === "dif" && c.rec && c.est !== "rechazo" ? (c.avv ? `<p class="hint" style="text-align:center">Ya avisaste a administración (${esc(c.avv)}).</p>` : `<button class="send" data-cb="rcav" data-id="${esc(c.id)}"${CB.rc.avBusy === c.id ? " disabled" : ""}>${CB.rc.avBusy === c.id ? "AVISANDO…" : "AVISAR A ADMINISTRACIÓN"}</button><p class="hint" style="text-align:center">Le llega a administración con tu recibo y la captura.</p>`) : ""}
      <div class="rcdb">${c.rec ? `<button class="ghost" data-cb="rec" data-id="${esc(c.id)}">Reenviar recibo</button>` : ""}${n ? `<button class="ghost" data-cb="open" data-id="${esc(n.id)}">Ver la nota</button>` : ""}</div></div>`;
  });
  return h;
}
/* captura a pantalla completa (la imagen vive en Drive de administración; el vendedor la ve a través del receptor) */
async function rcVerCap(id){
  const c = rcTodos().find(x => x.id === id); if(!c) return;
  capVisor(c.rec && Number(c.cap) > 0 ? i => cbSrv("captura", { r:c.rec, i }) : null, rcPendCaps(id));
}
async function rcAvisar(id){
  const c = rcTodos().find(x => x.id === id); if(!c || !c.rec || CB.rc.avBusy) return; CB.rc.avBusy = id; cobRender();
  try{ const r = await cbSrv("avisar", { r:c.rec });
    if(r && r.estado === "ok"){ [CB.cobros, CB.rc.hist].forEach(a => (a || []).forEach(x => { if(x.id === id) x.avv = r.avv || "hoy"; })); cbSave(); rcGuarda(); }
    else CB.avisos.push((r && r.msg) || "No se pudo avisar a administración."); }
  catch(e){ CB.avisos.push("Sin conexión: no se pudo avisar. Intenta de nuevo."); }
  CB.rc.avBusy = ""; cobRender();
}

/* ---------- ADMIN › Cobros (parte 3): por registrar en Holded, con diferencia, por anotar en carpeta y cobro de administración (A-) ----------
   Datos: a=adcob (el receptor concilia al momento con Holded). Registrar = a=adreg (el receptor escribe el pago en Holded, uno por cuenta).
   El cobro de administración reutiliza el formulario del vendedor (lector de capturas incluido) con la nota en CB.adNota. */
AD.cb = { d:null, err:"", t:0, cargando:false, sub:"reg", conf:"", busy:"", msg:[], pick:false, q:"", sigue:{}, anular:"", hechos:{} };
const admCobRegs = d => (d.cob || []).filter(c => c.est === "cobrado" || (c.est === "revisar" && (/^Lleva/.test(c.obs || "") || (c.reg || []).length)));
const admCobDifs = d => (d.cob || []).filter(c => admCobRegs(d).indexOf(c) < 0);
const admCobN = () => { const d = AD.cb.d; return d ? admCobRegs(d).length + admCobDifs(d).length + (d.arch || []).length : 0; };
async function admCobCarga(forzar){
  if(!S.adm || AD.cb.cargando || (!forzar && AD.cb.t && Date.now() - AD.cb.t < 25000)) return; AD.cb.cargando = true;
  try{ const r = await admSrv("adcob");
    if(r && r.estado === "ok"){ AD.cb.d = r; AD.cb.err = ""; AD.cb.t = Date.now(); if(Array.isArray(r.tasas) && r.tasas.length){ const m = new Map((CB.tasas || []).map(x => [x[0], x])); r.tasas.forEach(x => m.set(x[0], x)); CB.tasas = Array.from(m.values()); cbSave(); } }
    else AD.cb.err = (r && r.estado === "no") ? "Esta llave de administración ya no es válida." : (r && r.msg) || "No se pudieron leer los cobros."; }
  catch(e){ AD.cb.err = "Sin conexión: se muestra lo último que llegó."; }
  AD.cb.cargando = false; admBadge();
  if(VISTA === "admin" && AD.tab === "cob" && !CB.nota && !CB.ok && !admEscribiendo()) admRender();
}
/* tarifa de una nota por sus precios (igual que refrescar_datos.py): para las notas creadas después del último refresco */
function admTarifa(ln){
  if(!ln || !S.precios) return ""; const v = { u:0, l:0, b:0 }; let m = 0;
  ln.forEach(([sku, pr]) => { const t = S.precios[String(sku).trim()]; if(!t || !(pr > 0)) return; m++;
    let best = null; [["u", t[0]], ["l", t[1]], ["b", t[2]]].forEach(([q, ref]) => { if(ref > 0){ const d = Math.abs(pr - ref) / ref; if(!best || d < best[0]) best = [d, q]; } });
    if(best && best[0] <= 0.02) v[best[1]]++; });
  const q = Object.keys(v).sort((a, b) => v[b] - v[a])[0]; return m && v[q] * 2 > m ? q : "";
}
function admFilaNota(x, tar){
  const d = x.d || 0, pen = x.pen, real = tar === "b" && !d ? r2(pen * FBCV()) : pen, bcv = tar === "b" ? (d > 0 ? r2(pen / (1 - d / 100)) : pen) : null;
  return [x.id, x.num, x.c, x.f, x.v, x.tot, x.pag, pen, tar, d, real, bcv, x.pg || [], x.fac || null];
}
function admNotaAbre(id){
  const x = ((AD.cb.d && AD.cb.d.np) || []).find(n => n.id === id); if(!x) return;
  const tar = (S.ntar && S.ntar[id]) || admTarifa(x.ln) || "?";
  CB.adCli = CB.adCli || {}; CB.adCli[x.c] = x.cn; CB.adX = x; CB.adNota = admFilaNota(x, tar === "l" ? "u" : tar);
  if(x.fac && !(CB.ret && CB.ret[id])){ CB.ret = CB.ret || {}; CB.ret[id] = { rt:x.rt || 0 }; }
  CB.nota = id; CB.f = cbF0(); cbCapLimpia(); CB.edit = null; CB.ok = null; CB.err = ""; CB.mpOn = false; CB.bsOn = false; CB.tbMan = false; CB.del = null;
  admRender(); window.scrollTo(0, 0);
}
const admNotaCierra = () => { CB.nota = null; CB.adNota = null; CB.adX = null; CB.edit = null; cbCapLimpia(); };
const admCtaMet = c => RC_MET[c] || c || "Pago";
const admDia = ts => rcDiaH(ts);
function admTasaHtml(){
  const ts = (AD.cb.d && AD.cb.d.tasas) || CB.tasas || [], hoy = cbHoy(), t = ts.filter(x => x[0] <= hoy).sort((a, b) => a[0] < b[0] ? 1 : -1)[0], man = ts.filter(x => x[0] > hoy).sort((a, b) => a[0] < b[0] ? 1 : -1)[0];
  if(!t) return "";
  return `<div class="adtasa"><span>${t[0] === hoy ? "Tasa BCV de hoy" : "Tasa BCV del " + esc(cbFecha2(t[0]))} · se actualiza sola${man ? `<small>Para el ${esc(cbFecha2(man[0]))}: ${esc(cbCom(man[1], 2))}</small>` : ""}</span><b class="bs num">${esc(cbCom(t[1], 2))}</b></div>`;
}
function admCobCab(c){
  return `<div class="adch"><span class="adcl"><span class="adcs">${esc(c.rec || "Sin número")} · ${esc(admVenTxt(c.ven))} · ${esc(rcDia(c.t))}${c.ad ? " · administración" : ""}</span><b class="adcn">${esc(c.cn || "Cliente")}</b>
    <span class="adcs">${esc(c.nn || "")} · ${c.tb === "b" ? "BCV" : "nota USD"}${c.fa ? " · Fac. " + esc(c.fa) : ""}</span></span>
    <span class="adcr"><b class="bs num">${money(c.nom)}</b>${c.tb === "b" ? `<small>TASA BCV</small>` : ""}</span></div>`;
}
const admMetTab = c => { const m = [["ef", "EFECTIVO"], ["us", "USDT"], ["ze", "ZELLE"], ["mp", "MERCANTIL PANAMÁ"], ["bs", "BOLÍVARES"]].filter(x => Number(c[x[0]]) > 0).map(x => x[1]); return (m.join(" + ") || "COBRO") + (c.fa && Number(c.bs) > 0 ? " · CON FACTURA" : ""); };
function admParteTxt(c, p){
  if(p.k !== "bs" || c.tb !== "b") return "";
  const bcv = r2((Number(c.bs) || 0) - (Number(c.iv) || 0)); return bcv > 0 && Math.abs(bcv * FBCV() - p.m) < 0.05 ? " (" + money(bcv) + " BCV × " + cbCom(FBCV(), 2) + ")" : "";
}
function admRegCard(c){
  const conf = AD.cb.conf === c.id, busy = AD.cb.busy === c.id, hechas = c.reg || [], partes = c.partes || [], falta = partes.filter(p => hechas.indexOf(p.k) < 0);
  const soloEf = partes.length === 1 && partes[0].k === "ef", suma = r2(falta.reduce((s, p) => s + p.m, 0)), ret = (AD.ret || []).find(r => r.n === c.n);
  const av = String(c.av || "").split(" · ").filter(Boolean);
  if(c.est === "revisar" && c.obs) av.unshift(c.obs);
  if(c.tb === "b" && !(c.nd > 0) && c.npen != null) av.push("La nota aún no tiene el " + DBCV + " % en Holded: quedará un saldo hasta que se lo pongas.");
  if(c.npen != null && suma > c.npen + 0.5) av.push("En Holded la nota solo tiene " + money(c.npen) + " pendientes.");
  let h = `<div class="adw"><span class="rct pc">${esc(admMetTab(c))}</span><article class="rcc adc">${admCobCab(c)}
    <span class="adm">${esc(rcMet(c))}</span>
    <div class="adbx">${partes.map(p => `<span>${hechas.indexOf(p.k) >= 0 ? "Ya está en Holded" : "Va a la nota"}</span><b class="num">${money(p.m)}</b><small>en ${esc(p.cta)}${esc(admParteTxt(c, p))}</small>`).join("")}
      ${Number(c.iv) > 0 ? `<span>IVA cobrado (no va a Holded)</span><b class="num">${cbM(Number(c.iv), { tar:c.tb === "b" ? "b" : "u" })}</b>` : ""}
      ${c.fa && ret && ret.rt > 0 ? `<small class="adret">Retuvo ${ret.rt} % · ${ret.rec ? "comprobante recibido" : "comprobante pendiente"}</small>` : ""}
      <small>Fecha del pago en Holded: ${esc(cbFecha2(c.fh || ""))}</small></div>
    ${av.map(a => `<div class="msg">${esc(a)}</div>`).join("")}`;
  if(busy) h += `<button class="send" disabled>REGISTRANDO EN HOLDED…</button>`;
  else if(conf) h += `<div class="adcf"><b>¿Registrar en Holded?</b><span>${falta.map(p => money(p.m) + " en " + esc(p.cta)).join(" + ")} · ${esc(cbFecha2(c.fh || ""))}</span>
      <div class="adbt"><button class="ghost" data-ad="cbno">Cancelar</button><button class="send" data-ad="cbsi" data-id="${esc(c.id)}">SÍ, REGISTRAR</button></div></div>`;
  else h += `<div class="adbt">${c.cap ? `<button class="ghost" data-ad="cbcap" data-id="${esc(c.id)}">Ver captura</button>` : ""}<button class="send" data-ad="cbreg" data-id="${esc(c.id)}">${soloEf ? "RECIBÍ EL EFECTIVO · REGISTRAR" : hechas.length ? "REGISTRAR LO QUE FALTA" : "REGISTRAR EN HOLDED"}</button></div>`;
  return h + `</article></div>`;
}
function admDifCard(c){
  const m = /^Holded: (.*) · tu recibo: (.*)$/.exec(c.dif || ""), arch = /archivada/.test(c.dif || ""), rev = c.est === "revisar", sig = AD.cb.sigue[c.id], an = AD.cb.anular === c.id;
  const hold = (c.pg || []).reduce((s, p) => s + (Number(p[1]) || 0), 0), coincide = c.est === "confirmado" && hold && Math.abs(hold - c.ab) < 0.06;
  let h = `<div class="adw"><span class="rct dif">${rev ? "MONTO DISTINTO" : arch ? "CUENTA ARCHIVADA" : "CUENTA DISTINTA"}</span><article class="rcc adc">${admCobCab(c)}`;
  if(rev) h += `<div class="adbx dif"><span>${esc(c.obs || "Administración debe revisarlo")}</span></div>`;
  else h += `<div class="adbx dif g2"><span>Recibo</span><b>${esc(rcMet(c).split(" · ")[0])} → ${esc(m ? m[2] : c.ch || "—")}</b><span>Holded</span><b class="rojo">${esc(m ? m[1] : (c.cr || "").replace(/ \$[\d.,]+/g, ""))}</b></div>`;
  const pie = [c.avv ? admVenTxt(c.ven) + " avisó el " + c.avv : "", coincide ? "el monto sí coincide" : ""].filter(Boolean).join(" · ");
  if(pie) h += `<span class="adcs">${esc(pie)}</span>`;
  if(sig) h += `<div class="msg">Holded todavía dice ${esc((c.cr || "").replace(/ \$[\d.,]+/g, ""))}. Corrígelo en Holded, o déjalo así si fue a propósito.</div>`;
  if(rev) h += an ? `<div class="adcf"><b>¿Anular el recibo ${esc(c.rec)}?</b><span>Desaparece de las cuentas por cobrar del vendedor.</span><div class="adbt"><button class="ghost" data-ad="cbno">No</button><button class="send" data-ad="cbanusi" data-id="${esc(c.id)}">SÍ, ANULAR</button></div></div>`
    : `<div class="adbt">${c.cap ? `<button class="ghost" data-ad="cbcap" data-id="${esc(c.id)}">Ver captura</button>` : ""}<button class="ghost" data-ad="cbanu" data-id="${esc(c.id)}">Anular</button><button class="send" data-ad="cbconf" data-id="${esc(c.id)}">CONFIRMAR ASÍ</button></div>`;
  else h += `<div class="adbt">${c.cap ? `<button class="ghost" data-ad="cbcap" data-id="${esc(c.id)}">Ver captura</button>` : ""}${sig ? `<button class="ghost" data-ad="cbacep" data-id="${esc(c.id)}">Dejar así</button>` : ""}<button class="send" data-ad="cbrev" data-id="${esc(c.id)}"${AD.cb.busy === c.id ? " disabled" : ""}>${AD.cb.busy === c.id ? "REVISANDO…" : "YA LO CORREGÍ"}</button></div>`;
  return h + `</article></div>`;
}
function admArchCard(p){
  return `<div class="adw"><span class="rct dif">CUENTA ARCHIVADA</span><article class="rcc adc"><div class="adch"><span class="adcl"><span class="adcs">Directo en Holded · ${esc(admVenTxt(p.ven))} · ${esc(admDia(p.f))}</span><b class="adcn">${esc(p.cn)}</b><span class="adcs">${esc(p.nn)}</span></span><span class="adcr"><b class="bs num">${money(p.m)}</b></span></div>
    <div class="adbx dif g2"><span>Holded</span><b class="rojo">${esc(p.cta)}</b></div><p class="hint">Muévelo en Holded a la cuenta activa que corresponde; sale de aquí solo.</p></article></div>`;
}
/* carpeta: por vendedor y por nota; el monto grande es el de Holded (el que se anota en el papel) y, en notas BCV, su equivalente pequeño */
function admCarpetas(lista){
  const g = {}; lista.forEach(x => { (g[x.ven] = g[x.ven] || {}); (g[x.ven][x.n] = g[x.ven][x.n] || []).push(x); });
  return Object.keys(g).sort((a, b) => (a === "Sin vendedor") - (b === "Sin vendedor") || a.localeCompare(b, "es")).map(v => {
    const notas = Object.keys(g[v]).map(n => g[v][n]).sort((a, b) => a[0].f - b[0].f);
    return { ven:v, notas, n:notas.length, p:notas.reduce((s, x) => s + x.length, 0) };
  });
}
function admCarHtml(lista){
  if(!lista.length) return `<div class="adok">Todas las carpetas están al día.</div>`;
  return admCarpetas(lista).map(cp => `<section class="adcp"><div class="adcph"><span><b class="bs">CARPETA ${esc(admVenTxt(cp.ven).toUpperCase())}</b><small>${cp.n} ${cp.n === 1 ? "nota" : "notas"} · ${cp.p} ${cp.p === 1 ? "pago" : "pagos"}</small></span>
      <button class="mini" data-ad="carv" data-k="${esc(cp.ven)}">Toda anotada</button></div>` +
    cp.notas.map(ps => { const x = ps[0], sal = x.pen < 0.01;
      return `<article class="rcc adc adnt"><div class="adch"><span class="adcl"><span class="rcne bs">${esc(x.nn)}</span><b class="adcn">${esc(x.cn)}</b></span><span class="st ${sal ? "ok" : "az"}">${sal ? "Saldada" : "Quedan " + money(x.pen)}</span></div>
        <div class="adpg">${ps.map(p => { const eq = p.rbv ? r2(p.m * p.rbv) : (S.ntar && S.ntar[p.n] === "b") || p.tb === "b" ? r2(p.m / FBCV()) : 0;
          return `<span class="d">${esc(admDia(p.f))}</span><span class="m"><b>${esc(admCtaMet(p.cta))}${p.arch ? " (archivada)" : ""}</b><small>${p.rec ? "Recibo " + esc(p.rec) + (p.ad ? " · administración" : "") : "Directo en Holded, sin recibo"}</small></span>
            <span class="v"><b class="num">${money(p.m)}</b>${eq ? `<small class="num">= ${money(eq)} BCV</small>` : ""}</span>`; }).join("")}</div>
        <button class="send" data-ad="carn" data-id="${esc(x.n)}">YA LA ANOTÉ</button></article>`; }).join("") + `</section>`).join("");
}
async function admCarMarca(ps, e){
  try{ const res = await fetch(SCRIPT_URL, { method:"POST", headers:{ "Content-Type":"text/plain;charset=utf-8" }, redirect:"follow", body:JSON.stringify({ a:"adcar", k:S.adm, e, p:ps.map(p => [p.p, p.nn, p.m]) }) });
    const r = JSON.parse(await res.text()); if(r && r.estado === "ok") return true; AD.cb.msg.push((r && r.msg) || "No se guardó la carpeta."); }
  catch(err){ AD.cb.msg.push("Sin conexión: la carpeta no se guardó. Intenta de nuevo."); }
  return false;
}
async function admCarHecho(ps, txt){
  ps.forEach(p => { AD.cb.hechos[p.p] = 1; }); admBadge(); admRender();
  const deshaz = async () => { ps.forEach(p => { delete AD.cb.hechos[p.p]; }); admRender(); if(await admCarMarca(ps, "pendiente")) admToast("Vuelve a la lista"); else admRender(); };
  admToast(txt, deshaz);
  if(!(await admCarMarca(ps, "anotado"))){ ps.forEach(p => { delete AD.cb.hechos[p.p]; }); admRender(); }
}
function admPicker(){
  const np = (AD.cb.d && AD.cb.d.np) || [], q = admNorm(AD.cb.q);
  const L = np.filter(n => admVenOk(n.ven) && (!q || admNorm(n.num + " " + n.cn + " " + n.ven).indexOf(q) >= 0)).sort((a, b) => b.f - a.f).slice(0, 40);
  return L.length ? L.map(n => { const tar = (S.ntar && S.ntar[n.id]) || admTarifa(n.ln); return `<button class="adpk" data-ad="cbnota" data-id="${esc(n.id)}"><span><b class="bs">${esc(n.num)}</b> ${tar === "b" ? `<span class="tg">BCV</span>` : ""}${n.fac ? ` <span class="tg fa">FACTURA ${esc(n.fac[0])}</span>` : ""}<br><span>${esc(n.cn)}</span><small>${esc(admVenTxt(n.ven))}${n.pc.length ? " · " + n.pc.length + " por registrar" : ""}</small></span>
      <span class="num">${money(n.pen)}<small>pendiente en Holded</small></span></button>`; }).join("") : `<div class="box"><p class="hint">${np.length ? "No hay notas pendientes con esa búsqueda." : "Cargando notas…"}</p></div>`;
}
function admCobros(){
  const d = AD.cb.d, msgs = AD.cb.msg.map((m, i) => `<div class="msg">${esc(m)} <button class="txt" data-ad="cbmsg" data-i="${i}">Entendido</button></div>`).join("");
  if(AD.cb.pick) return `<button class="txt" data-ad="cbpickx" style="justify-self:start">‹ Volver a cobros</button><h2 class="bs">Registrar un cobro</h2>
    <p class="hint">Elige la nota. El recibo sale con la serie A- y el pago se registra en Holded de una vez.</p>
    <label class="rcq"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>
      <input type="search" id="admQ" aria-label="Buscar nota o cliente" placeholder="Nota o cliente" autocomplete="off" value="${esc(AD.cb.q)}"></label>${msgs}<div id="admPk" class="adpkl">${admPicker()}</div>`;
  if(!d) return admTasaHtml() + msgs + `<div class="box"><p class="hint">${esc(AD.cb.err || "Cargando cobros…")}</p></div>`;
  const regs = admCobRegs(d).filter(c => admVenOk(c.ven)).sort((a, b) => a.t - b.t), difs = admCobDifs(d).filter(c => admVenOk(c.ven)), arch = (d.arch || []).filter(p => admVenOk(p.ven));
  const car = (d.car || []).filter(p => !AD.cb.hechos[p.p] && admVenOk(p.ven)), nCar = new Set(car.map(p => p.n)).size;
  let h = admTasaHtml() + `<div class="achips" role="group" aria-label="Cobros">${[["reg", "Por registrar " + regs.length], ["dif", "Con diferencia " + (difs.length + arch.length)], ["car", "Por anotar " + nCar]].map(([k, l]) => `<button class="achip" data-ad="cbsub" data-k="${k}" aria-pressed="${AD.cb.sub === k}">${l}</button>`).join("")}</div>`;
  h += (AD.cb.err ? `<div class="msg">${esc(AD.cb.err)}</div>` : "") + msgs;
  if(AD.cb.sub === "reg"){
    h += `<div class="adhd"><h2 class="bs">POR REGISTRAR EN HOLDED</h2><p class="hint">Mira que el dinero haya entrado y regístralo. Cada cobro sale de aquí cuando Holded lo tiene.</p></div>
      <button class="ghost" data-ad="cbnew">+ REGISTRAR UN COBRO</button>`;
    h += regs.length ? regs.map(admRegCard).join("") : `<div class="adok">No hay cobros por registrar.</div>`;
  } else if(AD.cb.sub === "dif"){
    h += `<div class="adhd"><h2 class="bs">CON DIFERENCIA</h2><p class="hint">Cobros cuya cuenta o monto en Holded no coincide con el recibo, y pagos que quedaron en una cuenta archivada.</p></div>`;
    h += difs.length || arch.length ? difs.map(admDifCard).join("") + arch.map(admArchCard).join("") : `<div class="adok">Nada con diferencia.</div>`;
  } else {
    h += `<div class="adhd"><h2 class="bs">POR ANOTAR EN CARPETA</h2><p class="hint">Pagos que ya están en Holded. Anótalos en la copia de cada nota y márcala. Se quedan aquí hasta que los marques, aunque pasen semanas.</p></div>` + admCarHtml(car);
  }
  return h;
}
/* el formulario del cobro de administración (y su pantalla de «guardado») se pinta dentro de ADMIN */
function admCobForm(el){
  const av = CB.avisos.length ? CB.avisos.map((a, i) => `<div class="msg">${esc(a)} <button class="txt" data-cb="avok" data-i="${i}">Entendido</button></div>`).join("") : "";
  if(CB.ok){ el.innerHTML = av + cbOkHtml() + admRegOk(); cbRecPinta(CB.ok.cobro); return true; }
  if(!CB.nota || !CB.adNota) return false;
  if(CB.adNota[8] === "?"){ const x = CB.adX || {};
    el.innerHTML = `<button class="txt" data-cb="volver" style="justify-self:start">‹ Volver a cobros</button><h2 class="bs">Nota ${esc(CB.adNota[1])}</h2>
      <div class="box"><b>${esc(x.cn || "")}</b><p class="hint">No pude saber si esta nota es en tasa BCV o en dólares (es muy nueva). ¿Cuál es?</p>
      <div class="adbt"><button class="ghost" data-ad="cbtar" data-k="u">Nota en dólares</button><button class="ghost" data-ad="cbtar" data-k="b">Nota BCV</button></div></div>`; return true; }
  const h = cbFormHtml(); if(!h) return false;
  el.innerHTML = av + h; if($("cbSum")) cbSum(); return true;
}
function admRegOk(){
  const o = CB.ok, c = o && o.cobro; if(!c || !c.ad) return "";
  const g = o.reg;
  if(c.est === "cola") return `<div class="msg">Cuando el cobro llegue al servidor se registra solo en Holded.</div>`;
  if(g && g.ok) return `<div class="okb"><b>Registrado en Holded</b>${esc(g.msg || "")}</div>` + (g.aviso ? `<div class="msg">${esc(g.aviso)}</div>` : "");
  if(g && g.ya) return `<div class="okb"><b>Ya estaba en Holded</b>${esc(g.msg || "")}</div>`;
  return `<div class="msg">No se registró en Holded${g && (g.msg || g.error) ? ": " + esc(g.msg || g.error) : ""}. Quedó en «Por registrar» para que lo revises.</div>`;
}
async function admCobAccion(a, ex, ok){
  AD.cb.busy = ex.id || ""; admRender();
  let r = null; try{ r = await admSrv(a, ex); }catch(e){ AD.cb.msg.push("Sin conexión: no se hizo. Intenta de nuevo."); }
  AD.cb.busy = ""; AD.cb.conf = ""; AD.cb.anular = "";
  if(r && r.estado === "ok"){ if(ok) ok(r); } else if(r) AD.cb.msg.push(r.msg || "No se pudo.");
  await admCobCarga(true); admRender();
}
async function admVerCap(id){ capVisor(i => admSrv("adcap", { id, i })); }
$("vCob").addEventListener("click", e => {
  const a = e.target.closest("[data-ad]"); if(!a || VISTA !== "admin") return; const k = a.dataset.ad, id = a.dataset.id, d = AD.cb.d;
  if(k === "cbsub"){ AD.cb.sub = a.dataset.k; AD.cb.conf = ""; admRender(); }
  else if(k === "cbreg"){ AD.cb.conf = id; AD.cb.anular = ""; admRender(); }
  else if(k === "cbno"){ AD.cb.conf = ""; AD.cb.anular = ""; admRender(); }
  else if(k === "cbsi"){ const c = d && d.cob.find(x => x.id === id);
    admCobAccion("adreg", { id }, r => { const g = r.reg || {};
      if(g.ok){ admToast((c ? c.rec + " " : "") + "registrado en Holded"); if(g.aviso) AD.cb.msg.push(g.aviso); }
      else if(g.ya) admToast(g.msg || "Ya estaba en Holded");
      else if(g.alto) AD.cb.msg.push(g.msg); }); }
  else if(k === "cbcap") admVerCap(id);
  else if(k === "cbrev") admCobAccion("adrev", { id, e:"revisar" }, r => { if(r.sigue) AD.cb.sigue[id] = 1; else { delete AD.cb.sigue[id]; admToast("Corregido: ya coincide"); } });
  else if(k === "cbacep") admCobAccion("adrev", { id, e:"aceptar" }, () => { delete AD.cb.sigue[id]; admToast("Se queda así"); });
  else if(k === "cbconf") admCobAccion("adrev", { id, e:"confirmar" }, () => admToast("Confirmado"));
  else if(k === "cbanu"){ AD.cb.anular = id; AD.cb.conf = ""; admRender(); }
  else if(k === "cbanusi") admCobAccion("adrev", { id, e:"anular" }, () => admToast("Recibo anulado"));
  else if(k === "cbmsg"){ AD.cb.msg.splice(Number(a.dataset.i), 1); admRender(); }
  else if(k === "cbnew"){ AD.cb.pick = true; AD.cb.q = ""; admRender(); window.scrollTo(0, 0); }
  else if(k === "cbpickx"){ AD.cb.pick = false; admRender(); }
  else if(k === "cbnota") admNotaAbre(id);
  else if(k === "cbtar"){ if(CB.adX){ CB.adNota = admFilaNota(CB.adX, a.dataset.k); admRender(); } }
  else if(k === "carn"){ const ps = ((d && d.car) || []).filter(p => p.n === id && !AD.cb.hechos[p.p]); if(ps.length) admCarHecho(ps, ps[0].nn + " anotada"); }
  else if(k === "carv"){ const ps = ((d && d.car) || []).filter(p => p.ven === a.dataset.k && !AD.cb.hechos[p.p]); if(ps.length) admCarHecho(ps, "Carpeta " + admVenTxt(a.dataset.k) + " al día"); }
});
$("vCob").addEventListener("input", e => { if(e.target.id === "admQ"){ AD.cb.q = e.target.value; const L = $("admPk"); if(L) L.innerHTML = admPicker(); } });

/* ---------- eventos ---------- */
$("vCob").addEventListener("click", async e => {
  const a = e.target.closest("[data-cb]"); if(!a) return; const k = a.dataset.cb, top = () => window.scrollTo(0, 0);
  if(k === "tab"){ CB.tab = a.dataset.k; CB.del = null; CB.msgOk = ""; CB.rc.ficha = null; cobRender(); if(CB.tab === "rc") rcCarga(); }
  else if(k === "rcf"){ CB.rc.f = a.dataset.k; cobRender(); }
  else if(k === "rcopen"){ CB.rc.open = CB.rc.open === a.dataset.id ? null : a.dataset.id; cobRender(); }
  else if(k === "rcficha"){ CB.rc.ficha = a.dataset.id; cobRender(); top(); }
  else if(k === "rcfx"){ CB.rc.ficha = null; cobRender(); }
  else if(k === "rccap") rcVerCap(a.dataset.id);
  else if(k === "rcav") rcAvisar(a.dataset.id);
  else if(k === "solo"){ CB.solo = a.dataset.k === "true"; cobRender(); }
  else if(k === "open"){ CB.msgOk = ""; CB.nota = a.dataset.id; CB.edit = null; CB.del = null; CB.f = cbF0(); CB.err = ""; cbCapLimpia(); CB.mpOn = false; CB.bsOn = false; CB.tbMan = false; cobRender(); top(); }
  else if(k === "volver"){ if(CB.adNota && VISTA === "admin") admNotaCierra(); CB.nota = null; CB.edit = null; CB.del = null; cbCapLimpia(); cobRender(); }
  else if(k === "listo"){ const ad = CB.ok && CB.ok.cobro && CB.ok.cobro.ad; CB.ok = null; if(ad){ admNotaCierra(); AD.cb.pick = false; AD.cb.sub = "reg"; admCobCarga(true); } cobRender(); top(); }
  else if(k === "guardar") cbGuardar();
  else if(k === "capsel"){ const f = $("cbCapF"); if(f) f.click(); }
  else if(k === "mpon"){ CB.mpOn = true; cobRender(); }
  else if(k === "bson"){ CB.bsOn = true; cobRender(); const i = $("cb_bsb"); if(i) i.focus(); }
  else if(k === "bsoff"){ CB.bsOn = false; CB.f.bs = ""; CB.f.bsb = ""; CB.f.ta = ""; cobRender(); }
  else if(k === "tabcv"){ const n = cbNotas().find(x => x.id === CB.nota), t = cbTasaDe(CB.f.fp); if(n && t){ CB.f.ta = cbCom(t, 4); cbBsCalc(n); cobRender(); } }
  else if(k === "capdel") cbCapQuita(Number(a.dataset.i));
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
    CB.nota = c.n; CB.edit = c.id; CB.del = null; CB.err = ""; cbCapLimpia(); CB.mpOn = Number(c.mp) > 0; CB.bsOn = Number(c.bsb) > 0; CB.tbMan = Number(c.tbc) > 0;
    CB.f = { ef:m(c.ef), us:m(c.us), ze:m(c.ze), mp:m(c.mp), bs:m(c.bs), bsb:m(c.bsb), tb:Number(c.tbc) > 0 ? cbCom(Number(c.tbc), 4) : "", ta:m(c.ta), fp:c.fp || "", rf:c.rf || "", dd:Number(c.dd) > 0 ? m(c.dd) : "" }; cobRender(); top();
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
$("vCob").addEventListener("change", e => { if(e.target.id === "cbFile" && e.target.files && e.target.files[0]){ const f = e.target.files[0]; e.target.value = ""; cbSubir(f); }
  if(e.target.id === "cbCapF" && e.target.files && e.target.files.length){ const fs = Array.from(e.target.files); e.target.value = ""; cbCapElegida(fs); } });
$("vCob").addEventListener("input", e => { if(e.target.id === "rcQ"){ CB.rc.q = e.target.value; const L = $("rcL"); if(L) L.innerHTML = rcListaHtml(); return; }
  if(e.target.id === "cb_fcm"){ CB.facTxt = e.target.value; CB.facErr = ""; const c = $("cbFcn"), x = $("cbFerr"); if(c) c.textContent = CB.facTxt.length + " / 600"; if(x) x.textContent = ""; return; } const k = e.target.dataset && e.target.dataset.cbIn; if(!k) return; CB.f[k] = e.target.value; CB.err = "";
  /* bolívares: Bs ÷ tasa = dólares de la nota. La tasa BCV sigue a la fecha del pago mientras el vendedor no la cambie a mano */
  const n = cbNotas().find(x => x.id === CB.nota);
  if(n && ["bsb", "tb", "ta", "fp"].indexOf(k) >= 0){
    if(k === "tb") CB.tbMan = true;
    if(k === "fp" && esB(n) && !CB.tbMan){ const t = cbTasaDe(CB.f.fp); if(t){ CB.f.tb = cbCom(t, 4); const i = $("cb_tb"); if(i) i.value = CB.f.tb; } }
    const antes = CB.f.bs; cbBsCalc(n); if(CB.f.bs !== antes){ const i = $("cb_bs"); if(i) i.value = CB.f.bs; }
  }
  if(k === "bs" && cbNum(CB.f.bsb) > 0){ CB.f.bsb = ""; const i = $("cb_bsb"); if(i) i.value = ""; }   // si escribe los dólares a mano, el monto en Bs ya no aplica
  cbSum(); });
/* barra inferior: cambia de ambiente. PEDIDOS vuelve a donde estabas (catálogo, pedido o mis pedidos); COBRANZAS abre siempre en la lista. */
$("nav").addEventListener("click", e => {
  const b = e.target.closest("[data-nav]"); if(!b) return;
  if(b.dataset.nav === "adm"){ if(VISTA === "admin"){ admAbre(); window.scrollTo(0, 0); } else { CB.last = VISTA === "pedido" || VISTA === "enviados" ? VISTA : CB.last; go("admin"); } return; }
  if(b.dataset.nav === "cob"){ if(VISTA === "cobros"){ cobAbre(); window.scrollTo(0, 0); } else { CB.last = VISTA === "pedido" || VISTA === "enviados" ? VISTA : ""; go("cobros"); } }
  else go((VISTA === "cobros" || VISTA === "admin") && CB.last ? CB.last : "catalogo");
});
window.addEventListener("online", () => { cbLoad(); cbFlush().then(() => { cbCapFlush(); if(VISTA === "cobros") cobRender(); cobBadge(); }); });
/* cobros guardados sin conexión: se intentan enviar al abrir el portal, sin esperar a que entren a Cobros */
setTimeout(() => { cbLoad(); if(CB.cola.length) cbFlush().then(() => { cbCapFlush(); cobBadge(); }); else cbCapFlush(); }, 5000);
/* iPhone: al cerrarse el teclado, la pantalla puede quedar "corrida" y las barras fijas flotan a media pantalla.
   Mientras se escribe se oculta la barra inferior; al terminar se le da un empujón mínimo al scroll para que el teléfono recoloque todo. */
{ const esCampo = el => !!(el && el.matches && el.matches("input,textarea,select"));
  const recoloca = () => { if(esCampo(document.activeElement)) return; const y = window.scrollY; window.scrollTo(window.scrollX, y + 1); window.scrollTo(window.scrollX, y); };
  document.addEventListener("focusin", e => { if(esCampo(e.target) && e.target.type !== "checkbox") document.body.classList.add("tecl"); });
  document.addEventListener("focusout", () => { setTimeout(() => { if(!esCampo(document.activeElement)){ document.body.classList.remove("tecl"); recoloca(); setTimeout(recoloca, 300); } }, 80); });
  /* el iPhone a veces cierra el teclado sin quitar el foco del campo: entonces el modo "escribiendo" quedaba pegado y las barras fuera de sitio.
     Si el teclado ya no ocupa la pantalla (o se hace scroll sin teclado), se sale de ese modo, se suelta el campo y se recoloca todo. */
  const vv = window.visualViewport, tactil = window.matchMedia && matchMedia("(pointer:coarse)").matches; let altoMax = vv ? vv.height : 0;
  let tFoco = 0; document.addEventListener("focusin", () => { tFoco = Date.now(); });   // el teclado tarda en abrir: no se juzga en ese lapso
  window.addEventListener("orientationchange", () => { altoMax = 0; });
  const tecladoAbierto = () => { if(!vv) return true; altoMax = Math.max(altoMax, vv.height); return vv.height < altoMax - 150; };
  const sueltaSiCerrado = () => { if(!tactil || !document.body.classList.contains("tecl") || Date.now() - tFoco < 900 || tecladoAbierto()) return;
    const a = document.activeElement; if(esCampo(a)) a.blur();
    document.body.classList.remove("tecl"); recoloca(); setTimeout(recoloca, 300); };
  if(vv) vv.addEventListener("resize", () => setTimeout(() => { recoloca(); sueltaSiCerrado(); }, 120));
  window.addEventListener("scroll", () => { if(document.body.classList.contains("tecl")) sueltaSiCerrado(); }, { passive:true }); }
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
