const { cargar, CFG } = require("./arnes.js");
let ok = 0, mal = 0; const eq = (n, a, b) => { const s = JSON.stringify(a) === JSON.stringify(b); s ? ok++ : mal++; if(!s) console.log("FALLA", n, "→", JSON.stringify(a), "esperaba", JSON.stringify(b)); };
const si = (n, c) => eq(n, !!c, true);
const sec = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 1000 - 3600;
const hoy = new Intl.DateTimeFormat("en-CA").format(new Date());
const habiles = n => { let d = new Date(hoy + "T12:00:00"); let k = 0; while(k < n){ d = new Date(d - 86400000); const w = d.getDay(); if(w && w !== 6 && !CFG.feriados.includes(d.toISOString().slice(0, 10))) k++; } return d.toISOString().slice(0, 10); };
const nota = (id, num, f, total, extra = {}) => { const r = [id, num, "c1", sec(f), sec(f) + 30 * 86400, total, 0, total, "u", 0, total, null, [], null]; Object.assign(r, extra); return r; };

function nuevo(notas, cobros = []) {
  const W = cargar(); W.ctx.S.nt = notas; W.X.CB.cobros = cobros; W.X.CB.cargado = true; W.ctx.S.clientes = [{ id: "c1", n: "TALLER X" }]; W.X.CB.nota = notas[0][0]; return W;
}
// 1) Config leída
{ const W = cargar(); W.X.cbCfgContado(CFG); const c0 = W.X.cfg(); eq("cfg por defecto", [c0[0], c0[1]], [15, 4]); W.X.cbCfgContado(Object.assign({}, CFG, { descuento_contado: 12, contado_dias_habiles: 3 })); const c1 = W.X.cfg(); eq("cfg leída", [c1[0], c1[1], c1[2].length > 10], [12, 3, true]); W.X.cbCfgContado(CFG); }

// 2) Nota USD de hace 2 días hábiles: con 15 % el saldo baja a 850 y se decide automático
{ const W = nuevo([nota("n1", "NE4250", habiles(2), 1000)]); W.X.CB.f = { ef:"", us:"", ze:"", mp:"", bs:"", bsb:"", tb:"", ta:"", fp:"", rf:"", dd:"", dc:"15", nv:"" };
  const x = W.X.cbSaldoNota(); eq("saldo con desc", x.saldo, 850); eq("desc $", x.dr.dcm, 150); si("auto", x.dr.dec.auto); eq("dh", x.dr.dec.dh, 2);
  const h = W.X.cbFormHtml(); si("casilla marcada", /data-cb="dcon" checked/.test(h)); si("campo nota", /id="cb_nv"/.test(h)); si("falta con descuento", /con 15 % de descuento \(−\$150,00\)/.test(h)); }
// 3) Hace 7 días hábiles: por aprobar
{ const W = nuevo([nota("n1", "NE4300", habiles(7), 1000)]); W.X.CB.f = { ef:"850", us:"", ze:"", mp:"", bs:"", bsb:"", tb:"", ta:"", fp:"", rf:"", dd:"", dc:"15", nv:"" };
  const x = W.X.cbSaldoNota(); si("por aprobar", !x.dr.dec.auto); eq("dh 7", x.dr.dec.dh, 7); }
// 4) No ofrece descuento: BCV, con descuento, con factura
{ const b = nota("n1", "NE1", habiles(1), 1000); b[8] = "b"; b[11] = 1000;
  eq("BCV no", cargar && nuevo([b]).X.cbDcOk(nuevo([b]).X.cbNotas()[0]), false);
  const d = nota("n2", "NE2", habiles(1), 850); d[9] = 15; eq("con desc no", nuevo([d]).X.cbDcOk(nuevo([d]).X.cbNotas()[0]), false);
  const f = nota("n3", "NE3", habiles(1), 1000); f[13] = ["F1", null]; eq("factura no", nuevo([f]).X.cbDcOk(nuevo([f]).X.cbNotas()[0]), false);
  const u = nota("n4", "NE4", habiles(1), 1000); eq("USD sí", nuevo([u]).X.cbDcOk(nuevo([u]).X.cbNotas()[0]), true); }
// 5) Cobro con descuento automático ya anotado: el saldo que ve el vendedor baja (pago + descuento) y no se ofrece otro descuento
{ const c = { id: "u1", n: "n1", est: "cobrado", rec: "G-0001", nom: 850, ab: 850, ze: 850, bv: 850, dc: 15, dcm: 150, dce: "automático", dh: 2, t: 1 };
  const W = nuevo([nota("n1", "NE4250", habiles(2), 1000)], [c]); const n = W.X.cbNotas()[0], v = W.X.cbVisible(n);
  eq("visible", [v.pc, v.saldo], [1000, 0]); eq("no se ofrece otro", W.X.cbDcOk(n), false); si("texto", /aplicado solo/.test(W.X.cbDcTxt(c)));
  // por aprobar: el descuento NO se resta
  const p = Object.assign({}, c, { dce: "por aprobar", dh: 6 }); const W2 = nuevo([nota("n1", "NE4300", habiles(6), 1000)], [p]); const v2 = W2.X.cbVisible(W2.X.cbNotas()[0]); eq("por aprobar no resta", [v2.pc, v2.saldo], [850, 150]);
  // rechazado: tampoco, y se puede volver a ofrecer
  const r = Object.assign({}, c, { dce: "rechazado" }); const W3 = nuevo([nota("n1", "NE4300", habiles(6), 1000)], [r]); eq("rechazado", [W3.X.cbVisible(W3.X.cbNotas()[0]).saldo, W3.X.cbDcOk(W3.X.cbNotas()[0])], [150, true]);
  // Holded ya tiene el descuento (nota con 15 %): no se resta dos veces
  const n2 = nota("n1", "NE4250", habiles(2), 850); n2[9] = 15; n2[10] = 850; const W4 = nuevo([n2], [Object.assign({}, c, { est: "confirmado", pg: [["p1", 850, 1]] })]); n2[12] = [["p1", 850, 1]]; n2[7] = 0; n2[10] = 0;
  eq("Holded ya lo tiene", W4.X.cbVisible(W4.X.cbNotas()[0]).saldo, 0); }
// 6) Corregir un cobro con descuento libera el descuento
{ const c = { id: "u1", n: "n1", est: "cobrado", rec: "G-0001", nom: 850, ab: 850, ze: 850, bv: 850, dc: 15, dcm: 150, dce: "automático", dh: 2, t: 1 };
  const W = nuevo([nota("n1", "NE4250", habiles(2), 1000)], [c]); W.X.CB.edit = "u1"; W.X.CB.f = { ef:"", us:"", ze:"850", mp:"", bs:"", bsb:"", tb:"", ta:"", fp:"", rf:"", dd:"", dc:"15", nv:"" };
  const x = W.X.cbSaldoNota(); eq("al corregir", [x.pc, x.saldo], [0, 850]); si("ofrece de nuevo", W.X.cbDcOk(W.X.cbNotas()[0], x.ed)); }
// 7) Recibo en texto
{ const c = { id: "u1", n: "n1", est: "cobrado", rec: "G-0001", cn: "TALLER X", nn: "NE4250", nom: 850, ab: 850, ze: 850, bv: 850, dc: 15, dcm: 150, dce: "automático", t: 1 };
  const W = nuevo([nota("n1", "NE4250", habiles(2), 1000)], [c]); const t = W.X.cbReciboTxt(c); si("recibo texto", /Descuento de contado 15 % \(−\$150,00\)/.test(t) && /Saldo \$0,00/.test(t)); }
// 8) Mis recibos: estados
{ const W = cargar(); const base = { est: "cobrado", rec: "G-1", nom: 850, ab: 850, dc: 15, dcm: 150 };
  eq("rc rechazado", W.X.rcEst(Object.assign({}, base, { dce: "rechazado" })).s, "dif"); eq("rc por aprobar", W.X.rcEst(Object.assign({}, base, { dce: "por aprobar" })).s, "pend"); eq("rc auto", W.X.rcEst(Object.assign({}, base, { dce: "automático" })).s, "pend"); }
console.log(ok + " bien, " + mal + " mal"); if(mal) process.exit(1);
