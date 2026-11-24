// Navegador simulado mínimo para cargar cobranzas_pagina.js y probar sus funciones puras y el HTML que arma.
const fs = require("fs"), vm = require("vm");
const SRC = fs.readFileSync("" + require("path").join(__dirname, "..", "cobranzas_pagina.js") + "", "utf8");
const CFG = JSON.parse(fs.readFileSync(require("path").join(__dirname, "..", "..", "config.json"), "utf8"));
function cargar(extra = {}) {
  const els = {}, el = id => els[id] || (els[id] = { id, innerHTML: "", textContent: "", hidden: false, value: "", dataset: {}, style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } }, addEventListener(){}, setAttribute(){}, removeAttribute(){}, focus(){}, click(){}, appendChild(){}, querySelector(){ return null; }, querySelectorAll(){ return []; }, closest(){ return null; }, getContext(){ return {}; } });
  const store = {};
  const ctx = {
    console, JSON, Math, Date, Number, String, Array, Object, RegExp, Promise, Set, Map, isNaN, parseFloat, parseInt, Intl, URLSearchParams, setTimeout: () => 0, clearTimeout(){}, setInterval: () => 0, clearInterval(){}, requestAnimationFrame(){ return 0; }, Blob: function(){}, URL: { createObjectURL: () => "blob:x", revokeObjectURL(){} },
    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: () => el("tmp" + Math.random()), body: el("body"), documentElement: el("html"), activeElement: null, addEventListener(){}, hidden: false },
    window: { scrollTo(){}, addEventListener(){}, matchMedia: () => ({ matches: false, addEventListener(){} }), innerWidth: 400, location: { hash: "" } }, navigator: {}, location: { hash: "", href: "" },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    fetch: () => Promise.resolve({ json: () => Promise.resolve(CFG), text: () => Promise.resolve("{}") }),
    $: id => el(id), money: v => "$" + (Math.round((Number(v) || 0) * 100) / 100).toFixed(2).replace(".", ","), esc: x => String(x == null ? "" : x).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]),
    matchMedia: () => ({ matches: false, addEventListener(){} }), visualViewport: null, crypto: require("crypto").webcrypto, TextEncoder, TextDecoder, btoa: s => Buffer.from(s, "binary").toString("base64"), atob: s => Buffer.from(s, "base64").toString("binary"), encodeURIComponent, decodeURIComponent, unescape, escape, Uint8Array,
    Image: function(){}, EXT: true, S: { nt: [], clientes: [], adm: "", rol: "vendedor" }, VISTA: "cobros", SCRIPT_URL: "http://x", LSC: "ntx-cod", OCR: { t: {} },
    cobBadge(){}, cobNav(){}, admRender(){}, admSrv: async () => ({}), admToast(){}, admVenTxt: x => String(x || ""), admMetTab: () => "Efectivo", mtChip: () => "", cbMetHtml: () => "", rcMet: () => "Efectivo", cbFecha2: x => String(x || ""), rcDia: () => "hoy", capVisor(){},
    ...extra,
  };
  ctx.globalThis = ctx; vm.createContext(ctx);
  // las funciones y const de nivel superior quedan en el contexto (const/let no se ven desde fuera: se exportan al final)
  const nombres = ["CB", "AD", "NT", "esB", "cbNeto", "cbVisible", "cbSaldoNota", "cbDcOk", "cbDcDraft", "cbDcPc", "cbDcCont", "cbDcTxt", "cbCalc", "cbFormHtml", "cbSum", "cobRender", "admRegCard", "admDifCard", "admDcHtml", "admDcCuadre", "rcEst", "cbReciboTxt", "cbCobros", "pendiente", "cbCfgContado", "contadoDecide", "cbDiaTxt", "cbHoy", "cbNotas", "cbGuardar", "cbEnviar", "DCP", "DCL", "DCF", "CENT", "cbRows", "cbCentavos", "cbReparto", "cbSaldoRec", "cbDifTxt", "cbAjAdm", "admAjInfo", "admAjHtml", "admCent", "admRegGrupo", "cbMrEstado", "cbCapSinFecha", "cbFpFalta", "cbFpHtml", "cbCapRecalc"];
  vm.runInContext(SRC + "\n;globalThis.__X = { " + nombres.map(n => n + ": typeof " + n + " !== 'undefined' ? " + n + " : undefined").join(", ") + " , cfg(){ return [DCP, DCL, DCF]; } };", ctx, { filename: "cobranzas_pagina.js" });
  return { ctx, X: ctx.__X, els };
}
module.exports = { cargar, CFG };
