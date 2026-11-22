# -*- coding: utf-8 -*-
"""Inyecta la pestaña Cobranzas en el plano del portal (el que produce `portal.py abrir`). Se puede repetir: reemplaza el bloque anterior.
Uso:  python3 herramientas/aplicar_cobranzas.py plano.json V.json      (después: portal.py armar ...)
V.json es el mismo de portal.py: su campo "cuentas" (cuentas de la empresa que reconoce el lector de capturas) se inyecta en el
catálogo, que va cifrado. Esas cuentas nunca van en el repositorio.
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
# Fase 2 (facturas AdriMan + administración de Mango): se aplica sobre el resultado de la fase 1
SVG_ADM = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/><path d="M10 12h6M10 16h6"/></svg>'
NAVADM = '<button id="navAdm" data-nav="adm" hidden>' + SVG_ADM + '<span>ADMIN</span><span class="bdg" id="admN" hidden></span></button>'
CIERRE = '<span class="bdg" id="cobN" hidden></span></button></nav>'
RC_OLD = 'else if(!(document.activeElement && document.activeElement.matches("input"))) cobRender(); }'
PARES2 = [
 ('h', CIERRE, CIERRE.replace('</nav>', NAVADM + '</nav>'), 'botón ADMIN'),
 ('j', 'cobros:"cobros"})[location.hash', 'cobros:"cobros", admin:"admin"})[location.hash', 'route: admin'),
 ('j', '$("vCob").hidden = v !== "cobros";', '$("vCob").hidden = v !== "cobros" && v !== "admin";', 'route: vista admin'),
 ('j', 'v === "catalogo" || v === "cobros";', 'v === "catalogo" || v === "cobros" || v === "admin";', 'route: volver admin'),
 ('j', 'v === "cobros" ? "COBRANZAS" : "MIS PEDIDOS"', 'v === "cobros" ? "COBRANZAS" : v === "admin" ? "ADMINISTRACIÓN" : "MIS PEDIDOS"', 'route: título admin'),
 ('j', RC_OLD, 'else if(!(document.activeElement && document.activeElement.matches("input,textarea"))) cobRender(); }\n  if(v === "admin"){ if(prev !== "admin") admAbre(); else if(!(document.activeElement && document.activeElement.matches("input,textarea"))) admRender(); }', 'route: render admin'),
 ('j', 'S.nt = d.nt || []; purgaSinStock();', 'S.nt = d.nt || []; S.adm = d.adm || ""; purgaSinStock();', 'unlock: llave de administración'),
]
# Fase 3 (ADMIN › Cobros, 22 nov 2026): tarifa de las notas de todos para administración
PARES3 = [
 ('j', 'S.adm = d.adm || "";', 'S.adm = d.adm || ""; S.ntar = d.ntar || {};', 'unlock: tarifas de las notas'),
]
T = {'h': h, 'j': j}
for k, a, b, que in PARES3:      # se deshace primero lo más nuevo
    while b in T[k]: T[k] = T[k].replace(b, a)
for k, a, b, que in PARES2:      # primero se deshace la fase 2 (si ya estaba aplicada), luego la fase 1
    while b in T[k]: T[k] = T[k].replace(b, a)
for lista in (PARES, VIEJOS):
    for x in lista:
        while x[2] in T[x[0]]: T[x[0]] = T[x[0]].replace(x[2], x[1])
for k, a, b, que in PARES:
    assert T[k].count(a) == 1, 'no encontré: ' + que
    T[k] = T[k].replace(a, b)
for k, a, b, que in PARES2:
    assert T[k].count(a) == 1, 'no encontré (fase 2): ' + que
    T[k] = T[k].replace(a, b)
for k, a, b, que in PARES3:
    assert T[k].count(a) == 1, 'no encontré (fase 3): ' + que
    T[k] = T[k].replace(a, b)
h, j = T['h'], T['j']
# Tema: el rojo de marca sirve de fondo (botones), pero como letra sobre negro se lee mal de noche.
# --red-tx es el rojo para TEXTO: más oscuro de día (contraste 6:1 sobre blanco) y coral claro de noche (6,7:1 sobre la superficie oscura).
h = h.replace('--red:#D7141E;', '--red:#D7141E;--red-tx:#C0111A;') if '--red-tx:#C0111A' not in h else h
if '--red-tx:#FF7A73' not in h: h = h.replace('--red:#E3222C;', '--red:#E3222C;--red-tx:#FF7A73;')
assert h.count('--red-tx:') == 3, 'no encontré los tres bloques de colores del tema'
h = re.sub(r'(?<![-\w])color:var\(--red\)', 'color:var(--red-tx)', h)
n = bloque(h, '/*COBRANZAS*/', '/*FIN-COBRANZAS*/', css)
h = n if n is not None else h.replace('</style>', css.strip() + '\n</style>', 1)
fin = 'renderLin(); renderBrands(); renderSeg(); renderGrid(); route(); if(EXT) bootVend(); else boot();'
n = bloque(j, '/*COBRANZAS*/', '/*FIN-COBRANZAS*/', js)
if n is not None: j = n
else:
    assert j.count(fin) == 1, 'no encontré la línea final'; j = j.replace(fin, js.strip() + '\n' + fin)
# cuentas de la empresa para el lector de capturas (CB_CTAS): salen de los datos privados, nunca del repositorio
if len(sys.argv) > 2:
    C = json.load(open(sys.argv[2], encoding='utf-8')).get('cuentas') or []
    j, k = re.subn(r'/\*CTAS\*/.*?/\*FIN-CTAS\*/', lambda m: '/*CTAS*/' + json.dumps(C, ensure_ascii=False, separators=(',', ':')).replace('*/', '') + '/*FIN-CTAS*/', j, count=1, flags=re.S)
    assert k == 1, 'no encontré CB_CTAS en el catálogo'; print('cuentas del lector:', len(C))
else: print('AVISO: sin V.json el lector de capturas no reconocerá las cuentas de la empresa')
assert 'cobAbre' in j and h.count('id="vCob"') == 1 and h.count('id="nav"') == 1 and 'btnCob' not in h + j and '.cbs{' in h
json.dump({'h': h, 'j': j}, open(p, 'w', encoding='utf-8')); print('Cobranzas aplicado:', len(h), len(j))
