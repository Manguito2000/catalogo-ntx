# -*- coding: utf-8 -*-
"""Arma o abre index.html del portal de ventas NTX (catálogo de vendedores).
El catálogo (HTML + JS) va cifrado con una llave de catálogo; esa llave va envuelta una vez por vendedor con
PBKDF2(código + llave del servidor). La llave del servidor solo la entrega el Apps Script a dispositivos aprobados.

  Abrir para editar:  python3 herramientas/portal.py abrir --vendedores V.json --tag rm --salida plano.json
  Armar:              python3 herramientas/portal.py armar --plano plano.json --vendedores V.json --datos datos.json --salida index.html
V.json = {"v": [{"tag","nombre","codigo","k","s"}], "srv": "<url /exec del Apps Script>"}  (NO va en este repositorio).
plano.json = {"h": html del catálogo, "j": js del catálogo}  (NO va en este repositorio)."""
import argparse, base64, hashlib, json, os, re, secrets, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
AQUI = os.path.dirname(os.path.abspath(__file__))
b64, ub = (lambda x: base64.b64encode(x).decode()), base64.b64decode
norm = lambda s: re.sub(r'[^A-Z0-9]', '', str(s).upper())
pase = lambda v: norm(v['codigo']) + norm(v['s'])
kdf = lambda p, salt: hashlib.pbkdf2_hmac('sha256', p.encode(), salt, 150000, 32)

def abrir(a):
    V = json.load(open(a.vendedores, encoding='utf-8')); v = next(x for x in V['v'] if x['tag'] == a.tag)
    h = open(a.indice, encoding='utf-8').read()
    L = json.loads(re.search(r'const LLAVES = (\[.*?\]), CAT', h).group(1)); C = json.loads(re.search(r'CAT = (\{.*?\}), LSC', h).group(1))
    for w in L:
        for p in (pase(v), norm(v['codigo'])):
            try: kc = AESGCM(kdf(p, ub(w['s']))).decrypt(ub(w['i']), ub(w['d']), None)
            except Exception: continue
            open(a.salida, 'w', encoding='utf-8').write(AESGCM(kc).decrypt(ub(C['i']), ub(C['d']), None).decode()); print('plano listo:', a.salida); return
    sys.exit('No se pudo abrir con ese vendedor')

def armar(a):
    V = json.load(open(a.vendedores, encoding='utf-8')); P = json.load(open(a.plano, encoding='utf-8')); D = json.load(open(a.datos, encoding='utf-8'))
    j = P['j']
    # 1) el catálogo usa la llave que entrega la portada (código + llave del servidor) y no guarda nada por su cuenta
    j = j.replace('let saved = ""; try{ saved = localStorage.getItem(LSC) || ""; }catch(e){}', 'let saved = window.NTX_PASE || "";')
    j = j.replace('try{ localStorage.setItem(LSC, c); }catch(_){}', '')
    assert 'window.NTX_PASE' in j and 'localStorage.setItem(LSC' not in j, 'el catálogo cambió: revisa los reemplazos'
    # 2) los precios incrustados (respaldo si datos.json no carga) son los mismos de datos.json, ya con las llaves nuevas
    ini = j.find('const MODO = "vendedor", VEND = '); assert ini >= 0, 'no encontré VEND en el catálogo'
    ini += len('const MODO = "vendedor", VEND = '); _, fin = json.JSONDecoder().raw_decode(j, ini)
    j = j[:ini] + json.dumps(D['v'], separators=(',', ':')) + j[fin:]
    kc = os.urandom(32); iv = os.urandom(12)
    CAT = dict(i=b64(iv), d=b64(AESGCM(kc).encrypt(iv, json.dumps(dict(h=P['h'], j=j), ensure_ascii=False).encode(), None)))
    L = []
    for v in V['v']:
        s, i = os.urandom(16), os.urandom(12)
        L.append(dict(s=b64(s), i=b64(i), d=b64(AESGCM(kdf(pase(v), s)).encrypt(i, kc, None))))
    secrets.SystemRandom().shuffle(L)
    cab = open(os.path.join(AQUI, 'portada_cabeza.html'), encoding='utf-8').read()
    scr = open(os.path.join(AQUI, 'portada_script.html'), encoding='utf-8').read()
    scr = scr.replace('__LLAVES__', json.dumps(L, separators=(',', ':'))).replace('__CAT__', json.dumps(CAT, separators=(',', ':'))).replace('__SRV__', V['srv'])
    open(a.salida, 'w', encoding='utf-8').write(cab + scr); print('index listo:', a.salida, len(L), 'vendedores')

ap = argparse.ArgumentParser(); sp = ap.add_subparsers(dest='cmd', required=True)
x = sp.add_parser('abrir'); x.add_argument('--vendedores', required=True); x.add_argument('--tag', default='rm'); x.add_argument('--indice', default='index.html'); x.add_argument('--salida', required=True)
x = sp.add_parser('armar'); x.add_argument('--plano', required=True); x.add_argument('--vendedores', required=True); x.add_argument('--datos', default='datos.json'); x.add_argument('--salida', default='index.html')
a = ap.parse_args(); abrir(a) if a.cmd == 'abrir' else armar(a)
