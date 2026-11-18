# -*- coding: utf-8 -*-
"""Inyecta «jalar para actualizar» en el plano del portal. Se puede repetir (reemplaza el bloque anterior).
Flujo: portal.py abrir -> aplicar_cobranzas.py -> aplicar_jalar.py plano.json -> portal.py armar."""
import json, os, re, sys
AQUI = os.path.dirname(os.path.abspath(__file__)); lee = lambda n: open(os.path.join(AQUI, n), encoding='utf-8').read().strip()
p = sys.argv[1]; P = json.load(open(p, encoding='utf-8')); h, j = P['h'], P['j']
def quita(s, ini, fin):
    i = s.find(ini)
    if i < 0: return s
    k = s.find(fin, i); assert k > 0; return (s[:i] + s[k + len(fin):]).replace('\n\n\n', '\n\n')
h = quita(h, '/*JALAR*/', '/*FIN-JALAR*/'); j = quita(j, '/*JALAR*/', '/*FIN-JALAR*/')
assert h.count('</style>') >= 1 and 'const PTR' not in j
h = h.replace('</style>', lee('jalar_pagina.css') + '\n</style>', 1)
m = re.search(r'\nrenderLin\(\); renderBrands\(\);', j); assert m, 'no encontré la línea de arranque del catálogo'
j = j[:m.start()] + '\n' + lee('jalar_pagina.js') + j[m.start():]
P['h'], P['j'] = h, j; json.dump(P, open(p, 'w', encoding='utf-8'), ensure_ascii=False); print('jalar aplicado')
