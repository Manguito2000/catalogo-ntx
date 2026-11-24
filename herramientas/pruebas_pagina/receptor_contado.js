// Receptor de cobranzas con Google y Holded simulados: descuento de contado y decimales (cuenta «Ajustes por redondeo») de punta a punta.
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
      else if (r && r[2] && m === "post" && opts.negRompe && JSON.parse(op.payload).amount < 0) { cod = 400; out = { status: 0, info: "amount must be positive" }; }
      else if (r && r[2] && m === "post") { const b = JSON.parse(op.payload), n = H.notas[r[1]]; H.pays.push(b); n.paymentsDetail.push({ id: crypto.randomBytes(12).toString("hex"), amount: b.amount, date: b.date, bankId: b.treasury }); n.paymentsTotal += b.amount; n.paymentsPending = Math.round((n.total - n.paymentsTotal) * 100) / 100; out = { status: 1 }; }
      else if (r && m === "put") { const b = JSON.parse(op.payload), n = H.notas[r[1]]; H.puts.push(b);
        if (opts.putRompe) n.tags = []; else if ("tags" in b) n.tags = b.tags;
        if (b.items){ n.products = b.items.map((it, i) => ({ name: it.name, desc: it.desc, price: it.subtotal, units: it.units, discount: it.discount || 0, tax: it.tax || 0, sku: it.sku || "", productId: it.productId || null, variantId: it.variantId || null, account: it.account || null }));
          if (opts.itemsRompe && n.products[0] && !H.rompio){ n.products[0].price += 1; H.rompio = 1; }   // rompe solo el primer PUT
          n.subtotal = Math.round(n.products.reduce((s, l) => s + Math.round(l.price * l.units * (100 - l.discount)) / 100, 0) * 100) / 100; }
        n.discount = b.discount || 0; n.total = Math.round(n.subtotal * (100 - n.discount)) / 100; n.paymentsPending = Math.round((n.total - n.paymentsTotal) * 100) / 100; out = { status: 1 }; }
      else if (/^contacts\?page=/.test(ruta)) out = /page=1$/.test(ruta) ? Object.entries(H.contactos).map(([id, c]) => ({ id, ...c })) : [];
      else if (ruta === "treasury") out = opts.tesoreria || [];
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
const nota = (id, num, fechaN, total, extra = {}) => ({ id, docNumber: num, contact: "c1", contactName: "TALLER X", date: sec(fechaN), dueDate: sec(fechaN) + 30 * 86400, subtotal: total, total, discount: 0, paymentsTotal: 0, paymentsPending: total, paymentsDetail: [], tags: ["gabriel"], products: [{ name: "A", sku: "A", price: total, units: 1, discount: 0, tax: 0, productId: "p1", variantId: "v1", account: "acc" }, { name: "B", sku: "B", price: 0, units: 1, discount: 0, tax: 0, productId: "p2", variantId: "v2", account: "acc" }], ...extra });
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


// 9) Fechas: el efectivo lleva el día en que administración lo recibe (hoy); lo de la captura lleva su fecha. «Por anotar en carpeta» muestra esas mismas.
{ const W = mundo(); const fz = menosHabiles(3), fe = menosHabiles(5);
  W.H.notas[N1] = nota(N1, "NE5001", menosHabiles(6), 400); W.H.notas[N2] = nota(N2, "NE5002", menosHabiles(6), 500);
  W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000091", n: N1, ze: 400, ab: 400, fp: fz }) });
  W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000092", n: N2, ef: 500, ab: 500, fp: fe }) });
  const v0 = W.ctx.cobranzas({ a: "adcob", k: "ADM" }), c92 = v0.cob.find(c => c.id === "uid-00000092");
  eq("9 efectivo: la tarjeta dice hoy", c92.fh, hoyCcs); eq("9 zelle: la tarjeta dice la fecha de la captura", v0.cob.find(c => c.id === "uid-00000091").fh, fz);
  W.ctx.cobranzas({ a: "adreg", k: "ADM", id: "uid-00000091" }); W.ctx.cobranzas({ a: "adreg", k: "ADM", id: "uid-00000092" });
  eq("9 pago Zelle en Holded", W.H.pays.find(p => p.amount === 400).date, sec(fz)); eq("9 pago efectivo en Holded", W.H.pays.find(p => p.amount === 500).date, sec(hoyCcs));
  const car = W.ctx.cobranzas({ a: "adcob", k: "ADM" }).car;
  eq("9 carpeta Zelle", car.find(p => p.nn === "NE5001").f, sec(fz)); eq("9 carpeta efectivo", car.find(p => p.nn === "NE5002").f, sec(hoyCcs)); }

// ---------- decimales (24 nov 2026): administración cuadra al registrar ----------
// Hasta $3 en una nota sin descuento: línea «Ajuste por redondeo» en la nota y el pago entra completo. Más de $3 (o nota con descuento): cuenta «Ajustes por redondeo».
const AJ = "e".repeat(24), TES = [{ id: AJ, name: "Ajustes por redondeo" }];
const ult = n => n.products[n.products.length - 1];
// 10) Pagó de más ($192 por $191,82): la nota pasa a $192 con una línea de +$0,18 y Zelle recibe $192
{ const W = mundo({ tesoreria: TES }); W.H.notas[N1] = nota(N1, "NE4265", menosHabiles(1), 191.82);
  const r = W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000010", n: N1, ze: 192, ab: 192 }) }); eq("10 cobro", r.estado, "ok");
  const v = W.ctx.cobranzas({ a: "adcob", k: "ADM" }); eq("10 receptor sabe", [v.aj, v.ajc], [1, 1]);
  const g = W.ctx.cobranzas({ a: "adreg", k: "ADM", id: "uid-00000010", aj: "1" }); const n = W.H.notas[N1];
  si("10 ok", g.reg.ok); eq("10 un pago", W.H.pays.map(p => [p.amount, p.treasury === AJ]), [[192, false]]); eq("10 nota", [n.total, n.paymentsPending, n.products.length], [192, 0, 3]);
  eq("10 línea", [ult(n).name, ult(n).price, ult(n).productId], ["Ajuste por redondeo", 0.18, null]); eq("10 líneas intactas", [n.products[0].productId, n.products[0].price, n.products[1].variantId], ["p1", 191.82, "v2"]);
  eq("10 hoja", g.cobro.aj, 0.18); si("10 mensaje", /llevada a \$192,00/.test(g.reg.msg)); eq("10 registro de ajustes", W.hojas["Ajustes"].v[1][3], 0.18);
  const v2 = W.ctx.cobranzas({ a: "adcob", k: "ADM" }); si("10 carpeta", v2.car.some(p => p.m === 192)); si("10 sin pagos sin dueño", !v2.arch.length); }
// 11) Pagó de menos ($191 por $191,82): línea de −$0,82
{ const W = mundo({ tesoreria: TES }); W.H.notas[N1] = nota(N1, "NE4266", menosHabiles(1), 191.82);
  W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000011", n: N1, ef: 191, ab: 191 }) });
  W.ctx.cobranzas({ a: "adreg", k: "ADM", id: "uid-00000011", aj: "1" }); const n = W.H.notas[N1];
  eq("11 pagos", W.H.pays.map(p => p.amount), [191]); eq("11 nota", [n.total, n.paymentsPending, ult(n).price], [191, 0, -0.82]); }
// 12) Sin cuadrar: se registra lo que entró y la nota queda como Holded la deje
{ const W = mundo({ tesoreria: TES }); W.H.notas[N1] = nota(N1, "NE4267", menosHabiles(1), 191.82);
  W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000012", n: N1, ef: 191, ab: 191 }) });
  const g = W.ctx.cobranzas({ a: "adreg", k: "ADM", id: "uid-00000012" }); si("12 ok", g.reg.ok); eq("12 un pago", W.H.pays.length, 1); eq("12 quedan", W.H.notas[N1].paymentsPending, 0.82); eq("12 sin línea", W.H.notas[N1].products.length, 2); }
// 13) La línea no necesita la cuenta de ajustes; más de $3 sí (y avisa que falta)
{ const W = mundo(); W.H.notas[N1] = nota(N1, "NE4268", menosHabiles(1), 191.82);
  W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000013", n: N1, ef: 191, ab: 191 }) });
  const g = W.ctx.cobranzas({ a: "adreg", k: "ADM", id: "uid-00000013", aj: "1" }); si("13 registrado", g.reg.ok); eq("13 saldada sin cuenta", W.H.notas[N1].paymentsPending, 0);
  const W2 = mundo(); W2.H.notas[N1] = nota(N1, "NE4268", menosHabiles(1), 195);
  const b = W2.ctx.cobranzas({ a: "cobro", ...V, k: "ADM", x: x({ id: "uid-00000021", n: N1, ef: 190, ab: 190, aj: "1" }) });
  si("13 >3 registrado", b.reg.ok); eq("13 >3 quedan", W2.H.notas[N1].paymentsPending, 5); si("13 aviso", /crea en Holded la cuenta/.test(b.reg.aviso)); }
// 14) Más de $3 de más: ajuste negativo en la cuenta; si Holded no lo acepta, el pago queda y se avisa
{ const W = mundo({ tesoreria: TES }); W.H.notas[N1] = nota(N1, "NE4269", menosHabiles(1), 95);
  const b = W.ctx.cobranzas({ a: "cobro", ...V, k: "ADM", x: x({ id: "uid-00000014", n: N1, ze: 100, ab: 100, aj: "1" }) });
  eq("14 pagos", W.H.pays.map(p => [p.amount, p.treasury === AJ]), [[100, false], [-5, true]]); eq("14 saldada", W.H.notas[N1].paymentsPending, 0); eq("14 sin línea", W.H.notas[N1].products.length, 2);
  const W2 = mundo({ tesoreria: TES, negRompe: true }); W2.H.notas[N1] = nota(N1, "NE4269", menosHabiles(1), 95);
  const c = W2.ctx.cobranzas({ a: "cobro", ...V, k: "ADM", x: x({ id: "uid-00000015", n: N1, ze: 100, ab: 100, aj: "1" }) });
  si("14 registrado", c.reg.ok); eq("14 a favor", W2.H.notas[N1].paymentsPending, -5); si("14 aviso", /no aceptó el ajuste/.test(c.reg.aviso)); }
// 15) Nota ya pagada con centavos (sin cobro): «Cuadrar» lleva la nota a lo pagado
{ const W = mundo({ tesoreria: TES }); W.H.notas[N1] = nota(N1, "NE4270", menosHabiles(1), 100.4, { paymentsTotal: 100, paymentsPending: 0.4 });
  const g = W.ctx.cobranzas({ a: "adaj", k: "ADM", n: N1 }); eq("15 ok", g.estado, "ok"); eq("15 sin pagos", W.H.pays.length, 0); eq("15 nota", [W.H.notas[N1].total, W.H.notas[N1].paymentsPending, ult(W.H.notas[N1]).price], [100, 0, -0.4]);
  eq("15 sin llave", W.ctx.cobranzas({ a: "adaj", k: "x", n: N1 }).estado, "no"); }
// 16) Cobro de administración que se pasa por más de $0,50: solo se acepta si cuadra
{ const W = mundo({ tesoreria: TES }); W.H.notas[N1] = nota(N1, "NE4271", menosHabiles(1), 98.3);
  const a = W.ctx.cobranzas({ a: "cobro", ...V, k: "ADM", x: x({ id: "uid-00000016", n: N1, ef: 100, ab: 100 }) }); eq("16 sin cuadrar no", a.estado, "error");
  const b = W.ctx.cobranzas({ a: "cobro", ...V, k: "ADM", x: x({ id: "uid-00000017", n: N1, ef: 100, ab: 100, aj: "1" }) });
  eq("16 ok", b.estado, "ok"); eq("16 pagos", W.H.pays.map(p => p.amount), [100]); eq("16 nota", [W.H.notas[N1].total, W.H.notas[N1].paymentsPending], [100, 0]); }
// 17) Un vendedor no puede pedir que se cuadre
{ const W = mundo({ tesoreria: TES }); W.H.notas[N1] = nota(N1, "NE4272", menosHabiles(1), 98.3);
  eq("17 vendedor tope", W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000018", n: N1, ef: 100, ab: 100, aj: "1" }) }).estado, "error"); }
// 18) Con otro cobro de la misma nota por registrar no se cuadra (se comería ese cobro)
{ const W = mundo({ tesoreria: TES }); W.H.notas[N1] = nota(N1, "NE4273", menosHabiles(1), 300);
  W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000019", n: N1, ef: 100, ab: 100 }) }); W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000020", n: N1, ze: 199.7, ab: 199.7 }) });
  const g = W.ctx.cobranzas({ a: "adreg", k: "ADM", id: "uid-00000019", aj: "1" }); si("18 registrado", g.reg.ok); eq("18 sin línea", W.H.notas[N1].products.length, 2); si("18 aviso", /otro cobro por registrar/.test(g.reg.aviso));
  eq("18 adaj detenido", W.ctx.cobranzas({ a: "adaj", k: "ADM", n: N1 }).estado, "error");
  W.ctx.cobranzas({ a: "adreg", k: "ADM", id: "uid-00000020", aj: "1" }); eq("18 ahora sí", [W.H.pays.map(p => p.amount), W.H.notas[N1].total, W.H.notas[N1].paymentsPending], [[100, 199.7], 299.7, 0]); }
// 19) Si Holded cambia una línea al poner el ajuste, la nota vuelve a como estaba y no se registra el pago
{ const W = mundo({ tesoreria: TES, itemsRompe: true }); W.H.notas[N1] = nota(N1, "NE4274", menosHabiles(1), 191.82);
  W.ctx.cobranzas({ a: "cobro", ...V, x: x({ id: "uid-00000022", n: N1, ze: 192, ab: 192 }) });
  const g = W.ctx.cobranzas({ a: "adreg", k: "ADM", id: "uid-00000022", aj: "1" });
  si("19 detenido", g.reg.alto && /quedó como estaba/.test(g.reg.msg)); eq("19 sin pago", W.H.pays.length, 0); eq("19 nota como estaba", [W.H.notas[N1].total, W.H.notas[N1].products.length, W.H.notas[N1].products[0].price], [191.82, 2, 191.82]); }
// 20) Nota con descuento general (BCV / contado): no lleva línea, va a la cuenta de ajustes
{ const W = mundo({ tesoreria: TES }); W.H.notas[N1] = nota(N1, "NE4275", menosHabiles(1), 85, { subtotal: 100, discount: 15 });
  const b = W.ctx.cobranzas({ a: "cobro", ...V, k: "ADM", x: x({ id: "uid-00000023", n: N1, ze: 85.3, ab: 85.3, aj: "1" }) });
  eq("20 pagos", W.H.pays.map(p => [p.amount, p.treasury === AJ]), [[85.3, false], [-0.3, true]]); eq("20 saldada", W.H.notas[N1].paymentsPending, 0); eq("20 sin PUT de líneas", W.H.puts.length, 0); }

console.log(ok + " bien, " + mal + " mal"); if(mal) process.exit(1);
