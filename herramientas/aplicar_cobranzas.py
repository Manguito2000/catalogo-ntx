# -*- coding: utf-8 -*-
"""Inyecta la pestaña Cobranzas en el plano del portal (el que produce `portal.py abrir`). Se puede repetir: reemplaza el bloque anterior.
Uso:  python3 herramientas/aplicar_cobranzas.py plano.json      (después: portal.py armar ...)
Tocan: botón «Cobros» en la banda, sección vCob, ruta #cobros, S.nt en unlock(), y el bloque de CSS/JS marcado con /*COBRANZAS*/."""
import json, os, re, sys
AQUI = os.path.dirname(os.path.abspath(__file__)); lee = lambda n: open(os.path.join(AQUI, n), encoding='utf-8').read()
p = sys.argv[1]; P = json.load(open(p, encoding='utf-8')); h, j = P['h'], P['j']
def bloque(s, ini, fin, nuevo):
    i = s.find(ini)
    if i < 0: return None
    k = s.find(fin, i); assert k > 0, 'bloque sin cierre'; return s[:i] + nuevo.strip() + s[k + len(fin):]
css, js = lee('cobranzas_pagina.css'), lee('cobranzas_pagina.js')
NAV = ('<nav class="nav" id="nav" hidden aria-label="Secciones del portal">'
  '<button id="navPed" data-nav="ped"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg><span>PEDIDOS</span></button>'
  '<button id="navCob" data-nav="cob"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 10v4M17.5 10v4"/></svg><span>COBRANZAS</span><span class="bdg" id="cobN" hidden></span></button></nav>\n')
BE = '<button class="lnk" id="btnEnv">Pedidos<span class="bdg" id="espN" hidden></span></button>'
RL = 'if(v === "pedido") renderPed(); if(v === "enviados") renderEnv();'
RC = '\n  if(v === "cobros"){ if(prev !== "cobros") cobAbre(); else if(!(document.activeElement && document.activeElement.matches("input"))) cobRender(); }'
# (dónde, texto original, texto nuevo, descripción)
PARES = [
 ('h', BE, BE.replace('>Pedidos<', '>Mis pedidos<'), 'botón Pedidos'),
 ('h', '<section id="vEnv" class="pg" hidden></section>', '<section id="vEnv" class="pg" hidden></section>\n  <section id="vCob" class="pg" hidden></section>', 'sección vEnv'),
 ('h', '<div class="bar" id="bar" hidden>', NAV + '<div class="bar" id="bar" hidden>', 'barra inferior'),
 ('j', 'const v = ({pedido:"pedido", enviados:"enviados"})[location.hash.replace("#","")] || "catalogo";', 'const v = ({pedido:"pedido", enviados:"enviados", cobros:"cobros"})[location.hash.replace("#","")] || "catalogo";', 'route: mapa'),
 ('j', '$("vEnv").hidden = v !== "enviados";\n', '$("vEnv").hidden = v !== "enviados"; $("vCob").hidden = v !== "cobros";\n', 'route: vistas'),
 ('j', '$("btnBack").hidden = v === "catalogo";', '$("btnBack").hidden = v === "catalogo" || v === "cobros";', 'route: volver'),
 ('j', '$("ttl").textContent = v === "pedido" ? "PEDIDO" : "PEDIDOS";', '$("ttl").textContent = v === "pedido" ? "PEDIDO" : v === "cobros" ? "COBRANZAS" : "MIS PEDIDOS";', 'route: título'),
 ('j', RL, RL + RC + '\n  cobNav(v);', 'route: render'),
 ('j', 'purgaSinStock(); codeUI(); renderGrid(); route(); return true;', 'S.nt = d.nt || []; purgaSinStock(); codeUI(); renderGrid(); route(); cobBadge(); return true;', 'unlock'),
]
# versiones anteriores de este mismo script (se deshacen si están)
VIEJOS = [
 ('h', BE, BE + '\n    <button class="lnk" id="btnCob" hidden>Cobros<span class="bdg" id="cobN" hidden></span></button>'),
 ('j', '$("btnEnv").hidden = v !== "catalogo";', '$("btnEnv").hidden = v !== "catalogo"; $("btnCob").hidden = !(EXT && S.rol === "vendedor" && v === "catalogo");'),
 ('j', RL, RL + RC),
 ('j', '$("ttl").textContent = v === "pedido" ? "PEDIDO" : "PEDIDOS";', '$("ttl").textContent = v === "pedido" ? "PEDIDO" : v === "cobros" ? "COBRANZAS" : "PEDIDOS";'),
]
T = {'h': h, 'j': j}
for lista in (PARES, VIEJOS):
    for x in lista:
        while x[2] in T[x[0]]: T[x[0]] = T[x[0]].replace(x[2], x[1])
for k, a, b, que in PARES:
    assert T[k].count(a) == 1, 'no encontré: ' + que
    T[k] = T[k].replace(a, b)
h, j = T['h'], T['j']
n = bloque(h, '/*COBRANZAS*/', '/*FIN-COBRANZAS*/', css)
h = n if n is not None else h.replace('</style>', css.strip() + '\n</style>', 1)
fin = 'renderLin(); renderBrands(); renderSeg(); renderGrid(); route(); if(EXT) bootVend(); else boot();'
n = bloque(j, '/*COBRANZAS*/', '/*FIN-COBRANZAS*/', js)
if n is not None: j = n
else:
    assert j.count(fin) == 1, 'no encontré la línea final'; j = j.replace(fin, js.strip() + '\n' + fin)
assert 'cobAbre' in j and h.count('id="vCob"') == 1 and h.count('id="nav"') == 1 and 'btnCob' not in h + j and '.cbs{' in h
json.dump({'h': h, 'j': j}, open(p, 'w', encoding='utf-8')); print('Cobranzas aplicado:', len(h), len(j))
