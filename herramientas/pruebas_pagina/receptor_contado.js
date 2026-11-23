// Receptor de cobranzas con Google y Holded simulados: descuento de contado de punta a punta.
const fs = require("fs"), vm = require("vm"), crypto = require("crypto");
const GS = fs.readFileSync(require("path").join(__dirname, "..", "cobranzas_apps_script.gs"), "utf8");
const CFG = JSON.parse(fs.readFileSync(require("path").join(__dirname, "..", "..", "config.json"), "utf8"));
let ok = 0, mal = 0; const eq = (n, a, b) => { const s = JSON.stringify(a) === JSON.stringify(b); s ? ok++ : mal++; if(!s) console.log("FALLA", n, "→", JSON.stringify(a), "esperaba", JSON.stringify(b)); };
const si = (n, c) => eq(n, !!c, true);

function mundo(opts = {}) {
  const H = { notas: {}, contactos: { c1: { tags: ["gabriel"] } }, puts: [], pays: [] };
  const hojas = {};
  const hoja = nombre => hojas[nombre] || (hojas[nombre] = { v: [], getDataRange(){ const me = this; return { getValues: () => me.v.map(r => r.slice()) }; },
    getLastColumn(){ return this.v[0] ? this.v[0].length : 0; }, getLastRow(){ return this.v.length; }, getMaxRows(){ return 1000; },
    appendRow(r){ this.v.push(r.slice()); },
    getRange(f, c, nf, nc){ const me = this; return { setValue(x){ while(me.v.length < f) me.v.push([]); me.v[f - 1][c - 1] = x; }, setValues(xs){ xs.forEach((r, i) => r.forEach((x, j) => { while(me.v.length < f + i) me.v.push([]); me.v[f - 1 + i][c - 1 + j] = x; })); return { setFontWeight(){} }; }, setNumberFormat(){} }; },
    getParent(){ return { getUrl: () => "hoja" }; }, setFrozenRows(){}, hideColumns(){}, setName(){} });
  const sh = hoja("Cobros");
  const fmt = (d, tz, f) => { const o = new Intl.DateTimeFormat("en-CA", { timeZone: tz === "UTC" ? "UTC" : "America/Caracas", year:"numeric", month:"2-digit", day:"2-digit", hour:"numeric", minute:"2-digit", hour12:true }).formatToParts(d); const g = t => (o.find(x => x.type === t) || {}).value;
    return f === "yyyy-MM-dd" ? g("year") + "-" + g("month") + "-" + g("day") : g("day") + "/" + g("month") + "/" + g("year") + " " + g("hour") + ":" + g("minute"); };
  const props = { COB_HOJA: "x", HOLDED_KEY: "k" }, cache = {};
  const ctx = {
    console, JSON, Math, Date, Number, String, Array, Object, RegExp, isNaN, Intl,
    VENDEDORES: { gabriel: { nombre: "Gabriel", h: "h1" } }, ADMIN: "ADM",
    sha: x => "h1", estado: () => ({ bloq: false, disp: [{ id: "dispositivo123456" }] }), buscar: (l, id) => l.find(x => x.id === id) || null,
    corto: () => "AB12", fecha: iso => fmt(new Date(iso), "x", "f"), aviso: (a, b) => (H.avisos = (H.avisos || []).concat([a])),
    Utilities: { formatDate: fmt, newBlob: b => ({ getDataAsString: () => Buffer.from(b).toString("utf8") }), base64DecodeWebSafe: s => Buffer.from(s, "base64url") },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock(){}, releaseLock(){} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => n === "Cobros" ? sh : hojas[n] || null, insertSheet: n => hoja(n) }) },
    UrlFetchApp: { fetch(url, op = {}) {
      if (/config\.json/.test(url)) return { getContentText: () => JSON.stringify(CFG), getResponseCode: () => 200 };
      const ruta = url.replace("https://api.holded.com/api/invoicing/v1/", ""), m = (op.method || "get").toLowerCase();
      let cod = 200, out;
      let r = /^documents\/invoice\/([a-f0-9]{24})(\/pay)?$/.exec(ruta);
      if (r && m === "get") out = JSON.parse(JSON.stringify(H.notas[r[1]]));
      else if (r && r[2] && m === "post") { const b = JSON.parse(op.payload), n = H.notas[r[1]]; H.pays.push(b); n.paymentsDetail.push({ id: crypto.randomBytes(12).toString("hex"), amount: b.amount, date: b.date, bankId: b.treasury }); n.paymentsTotal += b.amount; n.paymentsPending = Math.round((n.total - n.paymentsTotal) * 100) / 100; out = { status: 1 }; }
      else if (r && m === "put") { const b = JSON.parse(op.payload), n = H.notas[r[1]]; H.puts.push(b);
        if (opts.putRompe) n.tags = []; else if ("tags" in b) n.tags = b.tags;
        n.discount = b.discount || 0; n.total = Math.round(n.subtotal * (100 - n.discount)) / 100; n.paymentsPending = Math.round((n.total - n.paymentsTotal) * 100) / 100; out = { status: 1 }; }
      else if (/^contacts\?page=/.test(ruta)) out = /page=1$/.test(ruta) ? Object.entries(H.contactos).map(([id, c]) => ({ id, ...c })) : [];
      else if (ruta === "treasury") out = [];
      else if (/^contacts\//.test(ruta)) out = H.contactos[ruta.split("/")[1]];
      else if (/^documents\/invoice\?page=/.test(ruta)) out = /page=1$/.test(ruta) ? Object.values(H.notas) : [];
      else { cod = 404; out = {}; }
      return { getResponseCode: () => cod, getContentText: () => JSON.stringify(out) };
    } },
  };
  vm.createContext(ctx); vm.runInContext(GS, ctx);
  sh.v.push(ctx.COB_COLS.slice());
  return { H, ctx, sh, hojas };
}
// nota en Holded: fecha "yyyy-mm-dd" → segundos a medianoche de España (invierno)
const sec = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 1000 - 3600;
const nota = (id, num, fechaN, total, extra = {}) => ({ id, docNumber: num, contact: "c1", contactName: "TALLER X", date: sec(fechaN), dueDate: sec(fechaN) + 30 * 86400, subtotal: total, total, discount: 0, paymentsTotal: 0, paymentsPending: total, paymentsDetail: [], tags: ["gabriel"], products: [{ sku: "A" }, { sku: "B" }], ...extra });
const x = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const hoyCcs = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" }).format(new Date());
const menosHabiles = (n) => { let d = new Date(hoyCcs + "T12:00:00Z"); let k = 0; while(k < n){ d = new Date(d - 86400000); const w = d.getUTCDay(); if(w && w !== 6 && !CFG.feriados.includes(d.toISOString().slice(0, 10))) k++; } return d.toISOString().slice(0, 10); };
const N1 = "a".repeat(24), N2 = "b".repeat(24), N3 = "c".repeat(24), N4 = "d".repeat(24);
const V = { cod: "GAB", d: "dispositivo123456" };

// 1) Pago dentro de 4 días hábiles: automático. Registrar pone el 15 % en Holded y paga $850.
{ const W = mundo(); W.H.notas[N1] = nota(N1, "NE4250", menosHabiles(2), 1000);
  const r = W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000001", n: N1, ze: 850, ab: 850, dc: 15, nv: "Le di el 15 % porque pagó casi de contado" }) });
  eq("1 ok", r.estado, "ok"); eq("1 automático", r.cobro.dce, "automático"); eq("1 días hábiles", r.cobro.dh, 2); eq("1 monto desc", r.cobro.dcm, 150); eq("1 nota vendedor", r.cobro.nv, "Le di el 15 % porque pagó casi de contado");
  const g = W.ctx.cobranzas({ a: "adreg", k: "ADM", id: "uid-00000001" });
  si("1 registrado", g.reg && g.reg.ok); eq("1 PUT", W.H.puts, [{ discount: 15, tags: ["gabriel"] }]); eq("1 pago", W.H.pays.map(p => p.amount), [850]); eq("1 nota saldada", W.H.notas[N1].paymentsPending, 0);
  eq("1 estado", g.cobro.est, "confirmado"); si("1 mensaje", /Descuento de 15 %/.test(g.reg.msg)); }

// 2) Pago al día hábil 6: por aprobar. Registrar se detiene; aprobar y registrar.
{ const W = mundo(); W.H.notas[N2] = nota(N2, "NE4300", menosHabiles(6), 1000);
  const r = W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000002", n: N2, ef: 850, ab: 850, dc: 15 }) });
  eq("2 por aprobar", r.cobro.dce, "por aprobar"); eq("2 días", r.cobro.dh, 6);
  const g = W.ctx.cobranzas({ a: "adreg", k: "ADM", id: "uid-00000002" });
  si("2 detenido", g.reg.alto && g.reg.dcp); eq("2 sin PUT", W.H.puts.length, 0); eq("2 sin pago", W.H.pays.length, 0);
  const a = W.ctx.cobranzas({ a: "adrev", k: "ADM", id: "uid-00000002", e: "dcaprobar" }); eq("2 aprobado", a.cobro.dce, "aprobado");
  const g2 = W.ctx.cobranzas({ a: "adreg", k: "ADM", id: "uid-00000002" }); si("2 registrado", g2.reg.ok); eq("2 saldada", W.H.notas[N2].paymentsPending, 0); }

// 3) Rechazado: se registra $850 sin descuento y la nota queda con $150.
{ const W = mundo(); W.H.notas[N2] = nota(N2, "NE4300", menosHabiles(8), 1000);
  W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000003", n: N2, ef: 850, ab: 850, dc: 15 }) });
  eq("3 rechazar", W.ctx.cobranzas({ a: "adrev", k: "ADM", id: "uid-00000003", e: "dcrechazar" }).cobro.dce, "rechazado");
  const g = W.ctx.cobranzas({ a: "adreg", k: "ADM", id: "uid-00000003" }); si("3 registrado", g.reg.ok); eq("3 sin PUT", W.H.puts.length, 0); eq("3 quedan 150", W.H.notas[N2].paymentsPending, 150); }

// 4) Reglas: BCV no, nota con descuento no, monto mayor que lo que falta con descuento no, dos descuentos en la misma nota no.
{ const W = mundo(); W.H.notas[N3] = nota(N3, "NE4310", menosHabiles(1), 1000); W.H.notas[N4] = nota(N4, "NE4311", menosHabiles(1), 1000, { discount: 15, total: 850, paymentsPending: 850 });
  eq("4 BCV", W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000041", n: N3, bs: 500, ab: 425, tb: "b", dc: 15 }) }).estado, "error");
  si("4 ya tiene desc", /ya tiene 15 %/.test(W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000042", n: N4, ze: 850, ab: 850, dc: 15 }) }).msg));
  si("4 abono > falta", /mayor que lo que falta.*850\.00, ya con el descuento/.test(W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000043", n: N3, ze: 900, ab: 900, dc: 15 }) }).msg));
  eq("4 parcial ok", W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000044", n: N3, ze: 400, ab: 400, dc: 15 }) }).estado, "ok");
  si("4 parcial avisado", /Pago parcial con descuento/.test(W.sh.v[1][W.ctx.COB["Avisos"]]));
  si("4 segundo descuento", /ya tiene el descuento de contado pedido en el recibo/.test(W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000045", n: N3, ze: 450, ab: 450, dc: 15 }) }).msg));
  eq("4 segundo cobro sin descuento cabe en lo que falta ($450)", W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000046", n: N3, ze: 450, ab: 450 }) }).estado, "ok");
  eq("4 tercero ya no cabe", W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000047", n: N3, ze: 10, ab: 10 }) }).estado, "error"); }

// 5) Administración pone un descuento para que cuadre (12,5 %) en un cobro sin descuento.
{ const W = mundo(); W.H.notas[N1] = nota(N1, "NE4250", menosHabiles(20), 1000);
  W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000005", n: N1, ze: 875, ab: 875, nv: "Pagó todo" }) });
  const p = W.ctx.cobranzas({ a: "adrev", k: "ADM", id: "uid-00000005", e: "dcpon", p: "12,5" });
  eq("5 aprobado", [p.cobro.dc, p.cobro.dcm, p.cobro.dce], [12.5, 125, "aprobado"]);
  const g = W.ctx.cobranzas({ a: "adreg", k: "ADM", id: "uid-00000005" }); si("5 registrado", g.reg.ok); eq("5 saldada", W.H.notas[N1].paymentsPending, 0);
  eq("5 quitar ya no (puesto)", W.ctx.cobranzas({ a: "adrev", k: "ADM", id: "uid-00000005", e: "dcpon", p: "0" }).estado, "error"); }

// 6) Holded cambia algo al poner el descuento: no se paga y se avisa.
{ const W = mundo({ putRompe: true }); W.H.notas[N1] = nota(N1, "NE4250", menosHabiles(1), 1000);
  W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000006", n: N1, ze: 850, ab: 850, dc: 15 }) });
  const g = W.ctx.cobranzas({ a: "adreg", k: "ADM", id: "uid-00000006" });
  si("6 detenido", g.reg.alto && /etiquetas/.test(g.reg.msg)); eq("6 sin pago", W.H.pays.length, 0); si("6 correo", (W.H.avisos || []).length === 1); }

// 7) Pago registrado a mano en Holded (sin el descuento): la vista lo muestra con dcf=1 y «dcholded» lo pone.
{ const W = mundo(); W.H.notas[N1] = nota(N1, "NE4250", menosHabiles(1), 1000);
  W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000007", n: N1, ze: 850, ab: 850, dc: 15 }) });
  const n = W.H.notas[N1]; n.paymentsDetail.push({ id: "f".repeat(24), amount: 850, date: sec(hoyCcs), bankId: "6a21f411a4a649295b04885a" }); n.paymentsTotal = 850; n.paymentsPending = 150;
  const v = W.ctx.cobranzas({ a: "adcob", k: "ADM" }); if(!v.cob) console.log(v); const c = v.cob.find(c => c.id === "uid-00000007");
  eq("7 confirmado y falta en Holded", [c.est, c.dcf], ["confirmado", 1]);
  const d = W.ctx.cobranzas({ a: "adrev", k: "ADM", id: "uid-00000007", e: "dcholded" }); eq("7 puesto", d.estado, "ok"); eq("7 saldada", W.H.notas[N1].paymentsPending, 0);
  const v2 = W.ctx.cobranzas({ a: "adcob", k: "ADM" }); eq("7 ya no sale", v2.cob.filter(c => c.id === "uid-00000007").length, 0); }

// 8) Cobro de administración (A-) con descuento: aprobado y registrado al momento.
{ const W = mundo(); W.H.notas[N1] = nota(N1, "NE4250", menosHabiles(15), 1000);
  const r = W.ctx.cobranzas({ a: "cobro", k: "ADM", ...V, x: x({ id: "uid-00000008", n: N1, ef: 850, ab: 850, dc: 15 }) });
  eq("8 aprobado", r.cobro.dce, "aprobado"); si("8 registrado", r.reg && r.reg.ok); eq("8 saldada", W.H.notas[N1].paymentsPending, 0); }

console.log(ok + " bien, " + mal + " mal"); if(mal) process.exit(1);
