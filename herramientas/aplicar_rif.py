# -*- coding: utf-8 -*-
"""Cliente nuevo con teléfono y foto del RIF en el pedido, o la marca «el cliente ya existe» (25 nov 2026). Se puede repetir.
Flujo: portal.py abrir -> aplicar_cobranzas.py -> aplicar_jalar.py -> aplicar_rif.py plano.json -> portal.py armar.
Necesita en el receptor: pedidos_apps_script.gs con pdRif y la línea  if (b.a === "rif") ...  en doPost (cobranzas_apps_script.gs)."""
import json, os, re, sys
AQUI = os.path.dirname(os.path.abspath(__file__)); lee = lambda n: open(os.path.join(AQUI, n), encoding='utf-8').read().strip()
p = sys.argv[1]; P = json.load(open(p, encoding='utf-8')); h, j = P['h'], P['j']
def quita(s, ini, fin):
    i = s.find(ini)
    if i < 0: return s
    k = s.find(fin, i); assert k > 0; return (s[:i] + s[k + len(fin):]).replace('\n\n\n', '\n\n')
h = quita(h, '/*RIF*/', '/*FIN-RIF*/'); j = quita(j, '/*RIF*/', '/*FIN-RIF*/')
def rep(a, b):
    global j
    if b in j: return                                   # ya aplicado
    assert j.count(a) >= 1, 'no encontré: ' + a[:80]; j = j.replace(a, b)
# 1) campos en la tarjeta del cliente nuevo
rep('<p class="hint">Envía su RIF y su teléfono a administración por WhatsApp para que creen la ficha del cliente.</p>', '${rifHtml()}')
# 2) teléfono y foto obligatorios, salvo que el vendedor marque «El cliente ya existe» (posible error de cartera)
rep('const canSend = () => !!(listo() && S.cliente && nombreOk() && !S.sending',
    'const canSend = () => !!(listo() && S.cliente && nombreOk() && nuevoOk() && !S.sending')
rep('!nombreOk() ? "Escribe el nombre del cliente nuevo para poder enviar."\n    : SCRIPT_URL',
    '!nombreOk() ? "Escribe el nombre del cliente nuevo para poder enviar." : !nuevoOk() ? rifFalta()\n    : SCRIPT_URL')
rep('!nombreOk() ? "Escribe el nombre del cliente nuevo para poder enviar."\n    : db ?',
    '!nombreOk() ? "Escribe el nombre del cliente nuevo para poder enviar." : !nuevoOk() ? rifFalta()\n    : db ?')
# 3) el teléfono se escribe igual que el nombre (refresca el botón de enviar)
rep('else if(e.target.id === "cn" && S.cliente){ S.cliente.nombreNuevo = e.target.value;',
    'else if((e.target.id === "cn" || e.target.id === "ctel") && S.cliente){ if(e.target.id === "ctel") S.cliente.tel = e.target.value; else S.cliente.nombreNuevo = e.target.value;')
# 4) el pedido lleva el teléfono (tl) y la marca de foto (rf)
rep('cn:o.cliente && o.cliente.nuevo ? (o.cliente.nombreNuevo || "").trim() : "", tp:',
    'cn:o.cliente && o.cliente.nuevo ? (o.cliente.nombreNuevo || "").trim() : "", tl:o.cliente && o.cliente.nuevo ? String(o.cliente.tel || "").trim() : "", rf:o.cliente && o.cliente.nuevo && !o.cliente.existe && (RIF || o.rif) ? 1 : 0, ye:o.cliente && o.cliente.nuevo && o.cliente.existe ? 1 : 0, tp:')
rep('(o.cliente.nombreNuevo || "").trim() : o.cliente.nombre) : "(sin cliente)"}\\nTarifa:',
    '(o.cliente.nombreNuevo || "").trim() : o.cliente.nombre) : "(sin cliente)"}${o.cliente && o.cliente.nuevo && o.cliente.tel ? "\\nTeléfono: " + o.cliente.tel : ""}\\nTarifa:')
# 5) al enviar, la foto sube con el id del pedido
rep('else if(act === "vsend"){ if(!canSend()){ e.preventDefault(); return; } const o = buildOrder(); a.href = sendHref(o);',
    'else if(act === "vsend"){ if(!canSend()){ e.preventDefault(); return; } const o = buildOrder(); a.href = sendHref(o); o.rif = !!(o.cliente && o.cliente.nuevo && !o.cliente.existe && RIF); rifEncola(o);')
j = j.replace('else if(act === "clnew"){', 'else if(act === "rifsel"){ const f = $("rifF"); if(f) f.click(); }\n  else if(act === "clnew"){', 1) if 'act === "rifsel"){ const f' not in j else j
# 6) cambiar de cliente o elegir cliente nuevo empieza sin foto
rep('else if(act === "clnew"){ S.cliente = {', 'else if(act === "clnew"){ RIF = null; rifGuarda(); S.rifErr = ""; S.cliente = {')
rep('else if(act === "clx"){ S.cliente = null;', 'else if(act === "clx"){ if(S.cliente && S.cliente.nuevo){ RIF = null; rifGuarda(); S.rifErr = ""; } S.cliente = null;')
# 7) pedidos en espera guardan su foto del RIF
rep('nota:S.nota, linea:S.linea }', 'nota:S.nota, linea:S.linea, rif:S.cliente && S.cliente.nuevo ? RIF : null }')
rep('guardaEspera(); S.cart = {}; S.cliente = null;', 'guardaEspera(); RIF = null; rifGuarda(); S.cart = {}; S.cliente = null;')
rep('S.cliente = o.cliente || null; S.tipo = o.tipo || "pedido";', 'S.cliente = o.cliente || null; RIF = o.rif || null; rifGuarda(); S.tipo = o.tipo || "pedido";')
# bloque de funciones y estilos
assert 'const RIF' not in j and 'let RIF' not in j
m = re.search(r'\nrenderLin\(\); renderBrands\(\);', j); assert m, 'no encontré la línea de arranque del catálogo'
j = j[:m.start()] + '\n' + lee('rif_pagina.js') + j[m.start():]
h = h.replace('</style>', lee('rif_pagina.css') + '\n</style>', 1)
P['h'], P['j'] = h, j; json.dump(P, open(p, 'w', encoding='utf-8'), ensure_ascii=False); print('rif aplicado')
