// Decimales (24 nov 2026): saldo a la vista, centavos que no se cobran y «Cuadrar decimales» en ADMIN.
const { cargar } = require("./arnes.js");
let ok = 0, mal = 0; const eq = (n, a, b) => { const s = JSON.stringify(a) === JSON.stringify(b); s ? ok++ : mal++; if(!s) console.log("FALLA", n, "→", JSON.stringify(a), "esperaba", JSON.stringify(b)); };
const si = (n, c) => eq(n, !!c, true);
const fila = (id, num, total, pagado, extra = []) => [id, num, "c1", 1795215600, 1795474800, total, pagado, Math.round((total - pagado) * 100) / 100, "u", 0, Math.round((total - pagado) * 100) / 100, null, [], null, "ELÍAS ISTANBOULIE"].map((v, i) => extra[i] !== undefined ? extra[i] : v);

// 1) el vendedor anotó $191,50 de $191,82: quedan $0,32 de centavos → saldo 0 en la lista y en el recibo
{ const W = cargar(); W.ctx.S.nt = [fila("n1", "NE4265", 191.82, 0)]; W.ctx.S.clientes = [];
  W.X.CB.cobros = [{ id: "k1", n: "n1", est: "cobrado", ab: 191.5, bv: 191.5, nom: 191.5, t: 1 }]; W.X.CB.cargado = true;
  const r = W.X.cbRows()[0]; eq("1 centavos", [r.saldo, r.cent], [0, 0.32]);
  eq("1 recibo saldo 0", W.X.cbSaldoRec({ n: "n1" }).saldo, 0); }
// 2) quedan $0,82: eso sí se cobra
{ const W = cargar(); W.ctx.S.nt = [fila("n1", "NE4265", 191.82, 0)]; W.ctx.S.clientes = [];
  W.X.CB.cobros = [{ id: "k1", n: "n1", est: "cobrado", ab: 191, bv: 191, nom: 191, t: 1 }]; W.X.CB.cargado = true;
  const r = W.X.cbRows()[0]; eq("2 sigue pendiente", [r.saldo, r.cent], [0.82, undefined]); eq("2 recibo", W.X.cbSaldoRec({ n: "n1" }).saldo, 0.82); }
// 3) textos de la diferencia
{ const W = cargar(); const n = { tar: "u" };
  eq("3 textos", [W.X.cbDifTxt(-0.18, n), W.X.cbDifTxt(0.32, n), W.X.cbDifTxt(0.82, n), W.X.cbDifTxt(0, n)], ["Pagó $0,18 de más", "Quedan $0,32 de centavos", "Quedan $0,82 por cobrar", "Cubre la nota exacta"]); }
// 4) varias notas: $0,18 que sobran no son saldo a favor, van a la última nota
{ const W = cargar(); const notas = [{ id: "a", num: "NE1", saldo: 100 }, { id: "b", num: "NE2", saldo: 91.82 }];
  const R = W.X.cbCentavos(W.X.cbReparto(notas, { ze: 192 }, false, null));
  eq("4 sin sobra", [R.sobraV, R.sobra.ze, R.cent], [0, 0, true]); eq("4 última", [R.filas[1].ze, R.filas[1].bv], [92, 92]);
  const R2 = W.X.cbCentavos(W.X.cbReparto(notas, { ze: 195 }, false, null)); eq("4 más de 0,50 sí es saldo a favor", R2.sobraV, 3.18);
  eq("4 estados", [W.X.cbMrEstado({ bv: 92 }, notas[1], { tar: "u" }).includes("de más"), W.X.cbMrEstado({ bv: 91.5 }, notas[1], { tar: "u" }).includes("centavos")], [true, true]); }
// 5) ADMIN: tarjeta con la diferencia y la casilla marcada sola con centavos
{ const W = cargar(); const c = { id: "u1", rec: "E-0001", ven: "Elías", cn: "ELÍAS ISTANBOULIE", nn: "NE4265", n: "n1", t: 1, nom: 192, ab: 192, ze: 192, est: "cobrado", tb: "", partes: [{ k: "ze", cta: "NUEVO ZELLE", m: 192 }], reg: [], npen: 191.82, nd: 0, fh: "2026-11-24" };
  W.X.AD.cb.d = { cob: [c], aj: 1, ajc: 1 };
  const a = W.X.admAjInfo(c); eq("5 info", [a.dif, a.puede, a.on], [-0.18, true, true]);
  const h = W.X.admRegCard(c); si("5 casilla", /data-ad="ajt"[^>]*checked/.test(h) && /La nota pasa a \$192,00 con una línea «Ajuste por redondeo» de \+\$0,18/.test(h)); eq("5 por línea", W.X.admAjInfo(c).linea, true); si("5 sin aviso de tope", !/solo tiene/.test(h));
  W.X.AD.cb.aj = { u1: false }; eq("5 desmarcada", W.X.admAjInfo(c).on, false);
  W.X.AD.cb.aj = {}; const big = Object.assign({}, c, { npen: 200 }); eq("5 más de $3: no se cuadra", [W.X.admAjInfo(big).puede, W.X.admAjInfo(big).on, W.X.admAjInfo(big).grande], [false, false, true]);
  W.X.AD.cb.d = { cob: [c, { id: "u2", n: "n1", est: "cobrado", rec: "E-0002" }], aj: 1 }; const o = W.X.admAjInfo(c); eq("5 con otro cobro no", [o.puede, !!o.otro], [false, true]);
  W.X.AD.cb.d = { cob: [c] }; eq("5 receptor viejo no", W.X.admAjInfo(c).puede, false);
  W.X.AD.cb.d = { cob: [c], aj: 1 }; eq("5 BCV sin descuento no", W.X.admAjInfo(Object.assign({}, c, { tb: "b", nd: 0 })).puede, false);
  si("5 con línea no pide la cuenta", !/falta crear esa cuenta/.test(W.X.admRegCard(c)));
  const g8 = Object.assign({}, c, { npen: 200 }); W.X.AD.cb.aj = { u1: true }; const h8 = W.X.admRegCard(g8); si("5 más de $3: sin casilla ni cuenta", !/data-ad="ajt"/.test(h8) && !/Ajustes por redondeo/.test(h8) && /pasa de \$3/.test(h8));
  const hd = W.X.admRegCard(Object.assign({}, c, { nd: 15 })); si("5 nota con descuento: línea", /data-ad="ajt"/.test(hd) && /línea «Ajuste por redondeo»/.test(hd) && !/Ajustes por redondeo/.test(hd)); }
// 6) ADMIN: notas con centavos (pagadas, sin cobro por registrar)
{ const W = cargar(); W.X.AD.cb.d = { aj: 1, np: [{ id: "a", num: "NE1", pag: 100, pen: 0.4, tot: 100.4, ven: "Elías", pc: [] }, { id: "b", num: "NE2", pag: 0, pen: 0.4, tot: 0.4, pc: [] }, { id: "c", num: "NE3", pag: 50, pen: 0.4, pc: [["x"]] }, { id: "d", num: "NE4", pag: 50, pen: 3, pc: [] }] };
  eq("6 lista", W.X.admCent(W.X.AD.cb.d).map(n => n.num), ["NE1"]); }

// 8) captura sin fecha: no se usa la de la imagen ni la de hoy; el vendedor la escribe y sin ella no se guarda
{ const W = cargar(); W.ctx.S.nt = [fila("n1", "NE4265", 191.82, 0)]; W.ctx.S.clientes = []; W.X.CB.cobros = []; W.X.CB.cargado = true; W.X.CB.nota = "n1";
  W.X.CB.f = { ef:"", us:"", ze:"", mp:"", bs:"", bsb:"", tb:"", ta:"", fp:"", rf:"", dd:"", dc:"", nv:"", aj:"" }; W.X.CB.on = {}; W.X.CB.man = {};
  W.X.CB.caps = [{ est: "listo", lec: { met: "ze", monto: 192, fecha: "2026-11-23", fechaDe: "imagen", ref: "123456" }, av: [] }];
  const n = W.X.cbNotas()[0]; W.X.cbCapRecalc(n);
  eq("8 sin fecha", [W.X.CB.f.fp, W.X.cbCapSinFecha(), W.X.cbFpFalta()], ["", true, true]); si("8 aviso en la captura", /no tiene fecha/.test(W.X.CB.caps[0].av.join(" ")));
  const h = W.X.cbFormHtml(); si("8 campo de fecha", /id="cb_fpx"/.test(h) && /La captura no tiene fecha/.test(h)); eq("8 no pone hoy", W.X.CB.f.fp, "");
  W.X.cbSum(); eq("8 no deja guardar", [W.X.CB && W.els.cbGo.disabled, W.els.cbErr.textContent], [true, "La captura no tiene fecha: escribe la fecha del pago."]);
  W.X.CB.f.fp = "2026-11-21"; W.X.CB.man.fp = true; W.X.cbSum(); eq("8 con fecha", [W.X.cbFpFalta(), W.els.cbGo.disabled], [false, false]);
  W.X.CB.f.fp = "2099-01-01"; W.X.cbSum(); eq("8 futura", [W.els.cbGo.disabled, W.els.cbErr.textContent], [true, "La fecha del pago no puede ser después de hoy."]);
  W.X.CB.caps = [{ est: "listo", lec: { met: "ze", monto: 192, fecha: "2026-11-22", fechaDe: "captura", ref: "1" }, av: [] }]; W.X.CB.man = {}; W.X.CB.f.fp = ""; W.X.cbCapRecalc(n);
  eq("8 con fecha en la captura", [W.X.CB.f.fp, W.X.cbFpFalta(), W.X.cbFpHtml()], ["2026-11-22", false, ""]); }
// 7) cobro de administración: la casilla se marca sola con centavos; con más de $0,50 hay que marcarla, y entonces se puede pasar
(async () => {
  const urls = [];
  const W = cargar({ VISTA: "admin", fetch: (u) => { urls.push(String(u)); const q = new URL(u, "http://x").searchParams; const x = q.get("x") ? JSON.parse(Buffer.from(q.get("x"), "base64url").toString("utf8")) : {};
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ estado: "ok", cobro: { rec: "A-0001", id: x.id, est: "confirmado", n: x.n, nom: x.nom, ab: x.ab, bv: x.bv, t: 1, ad: 1 } })) }); } });
  W.ctx.localStorage.setItem("ntx-cod", "RM"); W.ctx.localStorage.setItem("ntx-disp", "dispositivo123456"); W.ctx.S.adm = "ADM";
  const r = ["n9", "NE4271", "c1", 1795215600, 1795474800, 98.3, 0, 98.3, "u", 0, 98.3, null, [], null];
  W.X.AD.cb.d = { aj: 1, ajc: 1, cob: [] }; W.X.CB.adNota = r; W.X.CB.adX = { id: "n9", pc: [] }; W.X.CB.cobros = []; W.X.CB.cargado = true; W.X.CB.nota = "n9";
  const x = W.X.cbSaldoNota(); eq("7 centavos: sola", W.X.cbAjAdm(x, -0.2), true); eq("7 grande: no", W.X.cbAjAdm(x, -1.7), false);
  W.X.CB.f = { ef: "100", us: "", ze: "", mp: "", bs: "", bsb: "", tb: "", ta: "", fp: "", rf: "", dd: "", dc: "", nv: "", aj: "" };
  await W.X.cbGuardar(); eq("7 sin marcar no guarda", urls.filter(u => /a=cobro/.test(u)).length, 0);
  W.X.CB.f.aj = "1"; W.X.CB.busy = false; await W.X.cbGuardar();
  const u = urls.find(u => /a=cobro/.test(u)); si("7 enviado", u);
  if(u){ const p = JSON.parse(Buffer.from(new URL(u, "http://x").searchParams.get("x"), "base64url").toString("utf8")); eq("7 manda aj", [p.aj, p.ef, new URL(u, "http://x").searchParams.get("k")], ["1", 100, "ADM"]); }
  W.X.CB.adX = { id: "n9", pc: [["u5", "G-0003", "Gabriel", 50, 50]] }; eq("7 con cobro de vendedor pendiente no aplica", W.X.cbAjAdm(x, -0.2), null);
  console.log(ok + " bien, " + mal + " mal"); if(mal) process.exit(1);
})();

