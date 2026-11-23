// Pruebas del reparto de un pago entre varias notas (bloque /*REPARTO*/ de cobranzas_pagina.js).
// Uso: node herramientas/reparto_pruebas.js
const fs = require("fs"), path = require("path"), assert = require("assert");
const js = fs.readFileSync(path.join(__dirname, "cobranzas_pagina.js"), "utf8");
const bloque = js.slice(js.indexOf("/*REPARTO*/"), js.indexOf("/*FIN REPARTO*/"));
const cbReparto = new Function(bloque + "; return cbReparto;")();
const K = ["ef", "us", "ze", "mp", "bs"], C = x => Math.round(x * 100);
// cada forma de pago se reparte completa, al centavo
const cuadra = (r, p) => K.forEach(k => assert.equal(C(r.filas.reduce((s, f) => s + f[k], 0) + r.sobra[k]), C(p[k] || 0), "forma " + k));
const N = [{ id: "a", num: "NE4240", saldo: 79.52 }, { id: "b", num: "NE4262", saldo: 213.66 }];
let r, p;

// 1 USD, Zelle exacto: las dos saldadas
p = { ze: 293.18 }; r = cbReparto(N, p, false, null); cuadra(r, p);
assert.deepEqual(r.filas.map(f => [f.ze, f.bv]), [[79.52, 79.52], [213.66, 213.66]]); assert.equal(r.sobraV, 0); assert.equal(r.err, "");
// 2 USD, Zelle menor: la más vieja saldada, la otra abono
p = { ze: 200 }; r = cbReparto(N, p, false, null); cuadra(r, p);
assert.deepEqual(r.filas.map(f => f.ze), [79.52, 120.48]); assert.equal(r.sobraV, 0);
// 3 USD, Zelle mayor: sobran 6,82
p = { ze: 300 }; r = cbReparto(N, p, false, null); cuadra(r, p);
assert.deepEqual(r.filas.map(f => f.ze), [79.52, 213.66]); assert.equal(r.sobra.ze, 6.82); assert.equal(r.sobraV, 6.82);
// 4 USD, efectivo + Zelle: el efectivo se usa primero
p = { ef: 100, ze: 193.18 }; r = cbReparto(N, p, false, null); cuadra(r, p);
assert.deepEqual(r.filas.map(f => [f.ef, f.ze]), [[79.52, 0], [20.48, 193.18]]);
// 5 BCV en divisas con 15 %: $293,18 en Zelle cubren $344,91 BCV
const B = [{ id: "a", num: "NE1", saldo: 93.55 }, { id: "b", num: "NE2", saldo: 251.36 }];
p = { ze: 293.18, dd: 15 }; r = cbReparto(B, p, true, null); cuadra(r, p);
assert.equal(r.filas[0].ze, 79.52); assert.equal(r.filas[1].ze, 213.66); assert(Math.abs(r.filas[0].bv - 93.55) <= 0.01 && Math.abs(r.filas[1].bv - 251.36) <= 0.02, JSON.stringify(r.filas)); assert(r.sobraV <= 0.01);
// 6 BCV en bolívares: 1 a 1 en dólares BCV
p = { bs: 344.91 }; r = cbReparto(B, p, true, null); cuadra(r, p);
assert.deepEqual(r.filas.map(f => f.bs), [93.55, 251.36]);
// 7 BCV mixto: bolívares primero, luego divisas con descuento
p = { bs: 100, ze: 200, dd: 15 }; r = cbReparto(B, p, true, null); cuadra(r, p);
assert.equal(r.filas[0].bs, 93.55); assert.equal(r.filas[1].bs, 6.45); assert.equal(r.filas[1].ze, 200); assert(Math.abs(r.filas[1].bv - (6.45 + 200 / 0.85)) < 0.02);
// 8 reparto cambiado a mano: lo que no se aplica sobra
p = { ze: 293.18 }; r = cbReparto(N, p, false, [50, 200]); cuadra(r, p);
assert.deepEqual(r.filas.map(f => f.ze), [50, 200]); assert.equal(r.sobra.ze, 43.18); assert.equal(r.err, "");
// 9 reparto a mano con errores
assert(/más de lo que falta/.test(cbReparto(N, { ze: 400 }, false, [80, 200]).err));
assert(/más que el pago/.test(cbReparto(N, { ze: 100 }, false, [79.52, 50]).err));
// 10 una nota en cero queda sin montos
p = { ze: 213.66 }; r = cbReparto(N, p, false, [0, 213.66]); cuadra(r, p);
assert.deepEqual(r.filas.map(f => f.bv), [0, 213.66]);
// 11 al azar: siempre cuadra al centavo y ninguna nota recibe más de lo que falta
for (let t = 0; t < 3000; t++) {
  const n = 2 + Math.floor(Math.random() * 3), bcv = Math.random() < 0.5, dd = bcv ? [0, 10, 15, 20][t % 4] : 0;
  const notas = Array.from({ length: n }, (_, i) => ({ id: "n" + i, num: "NE" + i, saldo: Math.round(Math.random() * 50000) / 100 }));
  const q = {}; K.forEach(k => { if (Math.random() < 0.45) q[k] = Math.round(Math.random() * 40000) / 100; }); q.dd = dd;
  const x = cbReparto(notas, q, bcv, null); cuadra(x, q);
  x.filas.forEach((f, i) => assert(f.bv <= notas[i].saldo + 0.02, "excede " + JSON.stringify([f, notas[i], q, bcv])));
  const tot = notas.reduce((s, z) => s + z.saldo, 0);
  if (x.valor <= tot - 0.05) assert(x.sobraV <= 0.02, "no debería sobrar " + JSON.stringify([x, q, notas]));
  if (x.valor >= tot + 0.05) assert(Math.abs(x.sobraV - (x.valor - tot)) < 0.05 * n, "sobra " + JSON.stringify([x, q]));
}
console.log("reparto: todo bien");
