const { cargar, CFG } = require("./arnes.js");
let ok = 0, mal = 0; const eq = (n, a, b) => { const s = JSON.stringify(a) === JSON.stringify(b); s ? ok++ : mal++; if(!s) console.log("FALLA", n, "→", JSON.stringify(a), "esperaba", JSON.stringify(b)); };
const si = (n, c) => eq(n, !!c, true);
const sec = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 1000 - 3600;
const hoy = new Intl.DateTimeFormat("en-CA").format(new Date());
const habiles = n => { let d = new Date(hoy + "T12:00:00"); let k = 0; while(k < n){ d = new Date(d - 86400000); const w = d.getDay(); if(w && w !== 6 && !CFG.feriados.includes(d.toISOString().slice(0, 10))) k++; } return d.toISOString().slice(0, 10); };

// --- cbGuardar manda dc y nv
(async () => {
  const urls = [];
  const W = cargar({ fetch: (u) => { urls.push(String(u)); if(/config\.json/.test(u)) return Promise.resolve({ json: () => Promise.resolve(CFG) });
      const q = new URL(u, "http://x").searchParams; const x = q.get("x") ? JSON.parse(Buffer.from(q.get("x"), "base64url").toString("utf8")) : {};
      return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ estado: "ok", cobro: Object.assign({ rec: "G-0001", id: x.id, est: "cobrado", n: x.n, nom: 850, ab: 850, bv: 850, dc: x.dc, dcm: 150, dce: "automático", dh: 2, nv: x.nv, t: 1 }) })) }); } });
  W.ctx.localStorage.setItem("ntx-cod", "GAB"); W.ctx.localStorage.setItem("ntx-disp", "dispositivo123456");
  const f = habiles(2); W.ctx.S.nt = [["n1", "NE4250", "c1", sec(f), sec(f) + 30 * 86400, 1000, 0, 1000, "u", 0, 1000, null, [], null]]; W.ctx.S.clientes = [{ id: "c1", n: "TALLER X" }];
  W.X.CB.cobros = []; W.X.CB.cargado = true; W.X.CB.nota = "n1"; W.X.CB.f = { ef:"", us:"", ze:"850", mp:"", bs:"", bsb:"", tb:"", ta:"", fp:"", rf:"", dd:"", dc:"15", nv:"Le di el 15 % porque pagó casi de contado" };
  await W.X.cbGuardar();
  const u = urls.find(u => /a=cobro/.test(u)); si("se envió", u);
  if(u){ const x = JSON.parse(Buffer.from(new URL(u, "http://x").searchParams.get("x"), "base64url").toString("utf8")); eq("payload dc/nv", [x.dc, x.nv, x.ze, x.ab], [15, "Le di el 15 % porque pagó casi de contado", 850, 850]); }
  const c = W.X.CB.cobros[0]; eq("cobro guardado", [c && c.dc, c && c.dce], [15, "automático"]);
  // sin descuento: no manda dc
  urls.length = 0; W.X.CB.cobros = []; W.X.CB.nota = "n1"; W.X.CB.f = { ef:"100", us:"", ze:"", mp:"", bs:"", bsb:"", tb:"", ta:"", fp:"", rf:"", dd:"", dc:"", nv:"" };
  await W.X.cbGuardar(); const u2 = urls.find(u => /a=cobro/.test(u)); const x2 = JSON.parse(Buffer.from(new URL(u2, "http://x").searchParams.get("x"), "base64url").toString("utf8")); eq("sin dc ni nv", ["dc" in x2, "nv" in x2], [false, false]);

  // --- tarjetas de ADMIN
  const base = { id: "u1", rec: "G-0001", ven: "gabriel", cn: "TALLER X", nn: "NE4250", n: "n1", t: 1, nom: 850, ab: 850, ze: 850, est: "cobrado", tb: "", partes: [{ k: "ze", cta: "NUEVO ZELLE", m: 850 }], reg: [], npen: 1000, nbase: 1000, nd: 0, fh: hoy, nv: "Le di el 15 % porque pagó casi de contado" };
  const W2 = cargar(); W2.X.AD.cb.d = { cob: [base] };
  let h = W2.X.admRegCard(Object.assign({}, base, { dc: 15, dcm: 150, dce: "automático", dh: 2 }));
  si("nota visible", /class="nvbox"/.test(h) && /Le di el 15 %/.test(h)); si("auto: aviso", /aplicado solo/.test(h) && /día hábil 2 de 4/.test(h)); si("auto: quitar", /data-ad="dcno"/.test(h)); si("registrar habilitado", !/data-ad="cbreg"[^>]*disabled/.test(h));
  h = W2.X.admRegCard(Object.assign({}, base, { dc: 15, dcm: 150, dce: "por aprobar", dh: 6 }));
  si("por aprobar: botones", /data-ad="dcap"/.test(h) && /data-ad="dcno"/.test(h)); si("registrar bloqueado", /data-ad="cbreg"[^>]*disabled/.test(h)); si("dice la nota queda en 850", /quedaría en \$850,00/.test(h));
  h = W2.X.admRegCard(base); si("sin descuento: opciones", /data-ad="dcpon"[^>]*data-p="15"/.test(h)); si("que cuadre = 15 %", /Que cuadre · 15 %/.test(h)); si("otro %", /data-ad="dcotro"/.test(h));
  const base2 = Object.assign({}, base, { ze: 875, nom: 875, ab: 875, partes: [{ k: "ze", cta: "NUEVO ZELLE", m: 875 }] }); h = W2.X.admRegCard(base2); si("cuadre 12,5", /Que cuadre · 12,5 %/.test(h));
  h = W2.X.admRegCard(Object.assign({}, base, { tb: "b" })); si("BCV sin descuento", !/dcpon/.test(h)); h = W2.X.admRegCard(Object.assign({}, base, { nd: 15 })); si("nota con desc. no ofrece", !/dcpon/.test(h));
  h = W2.X.admRegCard(Object.assign({}, base, { nv: "" })); si("sin nota no hay recuadro", !/nvbox/.test(h));
  h = W2.X.admDifCard(Object.assign({}, base, { est: "confirmado", dc: 15, dcm: 150, dce: "automático", dcf: 1, npen: 150 })); si("dcf1", /DESCUENTO POR PONER EN HOLDED/.test(h) && /data-ad="dcholded"/.test(h) && /PONER 15 % EN HOLDED/.test(h));
  h = W2.X.admDifCard(Object.assign({}, base, { est: "confirmado", dc: 15, dcm: 150, dce: "por aprobar", dh: 6, dcf: 2 })); si("dcf2", /DESCUENTO POR DECIDIR/.test(h) && /data-ad="dcap"/.test(h));
  console.log(ok + " bien, " + mal + " mal"); if(mal) process.exit(1);
})();
