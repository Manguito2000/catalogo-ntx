# -*- coding: utf-8 -*-
"""Inyecta la pestaña Cobranzas en el plano del portal (el que produce `portal.py abrir`). Se puede repetir: reemplaza el bloque anterior.
Uso:  python3 herramientas/aplicar_cobranzas.py plano.json      (después: portal.py armar ...)
Tocan: botón «Cobros» en la banda, sección vCob, ruta #cobros, S.nt en unlock(), y el bloque de CSS/JS marcado con /*COBRANZAS*/."""
import json, os, re, sys
AQUI = os.path.dirname(os.path.abspath(__file__)); lee = lambda n: open(os.path.join(AQUI, n), encoding='utf-8').read()
p = sys.argv[1]; P = json.load(open(p, encoding='utf-8')); h, j = P['h'], P['j']
def una(s, a, b, que):
    assert s.count(a) == 1 or (s.count(a) == 0 and b in s), 'no encontré (o ya aplicado): ' + que
    return s.replace(a, b) if a in s else s
def bloque(s, ini, fin, nuevo):
    i = s.find(ini)
    if i < 0: return None
    k = s.find(fin, i); assert k > 0, 'bloque sin cierre'; return s[:i] + nuevo.strip() + s[k + len(fin):]
css, js = lee('cobranzas_pagina.css'), lee('cobranzas_pagina.js')
# --- HTML
h = una(h, '<button class="lnk" id="btnEnv">Pedidos<span class="bdg" id="espN" hidden></span></button>',
        '<button class="lnk" id="btnEnv">Pedidos<span class="bdg" id="espN" hidden></span></button>\n    <button class="lnk" id="btnCob" hidden>Cobros<span class="bdg" id="cobN" hidden></span></button>', 'botón Pedidos')
h = una(h, '<section id="vEnv" class="pg" hidden></section>', '<section id="vEnv" class="pg" hidden></section>\n  <section id="vCob" class="pg" hidden></section>', 'sección vEnv')
n = bloque(h, '/*COBRANZAS*/', '/*FIN-COBRANZAS*/', css)
h = n if n is not None else h.replace('</style>', css.strip() + '\n</style>', 1)
# --- JS
j = una(j, 'const v = ({pedido:"pedido", enviados:"enviados"})[location.hash.replace("#","")] || "catalogo";', 'const v = ({pedido:"pedido", enviados:"enviados", cobros:"cobros"})[location.hash.replace("#","")] || "catalogo";', 'route: mapa')
j = una(j, '$("vEnv").hidden = v !== "enviados";\n', '$("vEnv").hidden = v !== "enviados"; $("vCob").hidden = v !== "cobros";\n', 'route: vistas')
j = una(j, '$("btnEnv").hidden = v !== "catalogo";', '$("btnEnv").hidden = v !== "catalogo"; $("btnCob").hidden = !(EXT && S.rol === "vendedor" && v === "catalogo");', 'route: botones')
j = una(j, '$("ttl").textContent = v === "pedido" ? "PEDIDO" : "PEDIDOS";', '$("ttl").textContent = v === "pedido" ? "PEDIDO" : v === "cobros" ? "COBRANZAS" : "PEDIDOS";', 'route: título')
j = una(j, 'if(v === "pedido") renderPed(); if(v === "enviados") renderEnv();', 'if(v === "pedido") renderPed(); if(v === "enviados") renderEnv();\n  if(v === "cobros"){ if(prev !== "cobros") cobAbre(); else if(!(document.activeElement && document.activeElement.matches("input"))) cobRender(); }', 'route: render')
j = una(j, 'purgaSinStock(); codeUI(); renderGrid(); route(); return true;', 'S.nt = d.nt || []; purgaSinStock(); codeUI(); renderGrid(); route(); cobBadge(); return true;', 'unlock')
fin = 'renderLin(); renderBrands(); renderSeg(); renderGrid(); route(); if(EXT) bootVend(); else boot();'
n = bloque(j, '/*COBRANZAS*/', '/*FIN-COBRANZAS*/', js)
if n is not None: j = n
else:
    assert j.count(fin) == 1, 'no encontré la línea final'; j = j.replace(fin, js.strip() + '\n' + fin)
assert 'cobAbre' in j and 'id="vCob"' in h and '.cbs{' in h
json.dump({'h': h, 'j': j}, open(p, 'w', encoding='utf-8')); print('Cobranzas aplicado:', len(h), len(j))
