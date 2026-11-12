# -*- coding: utf-8 -*-
"""Refresca datos.json del Catálogo NTX de vendedores: precios, stock y clientes de Holded, cifrados con el código de cada vendedor.
Uso:  python3 herramientas/refrescar_datos.py --vendedores vendedores.json --salida datos.json [--clave-archivo "clave V1.txt"]
  vendedores.json = {"v": [{"tag", "nombre", "codigo", "k"}]}  (está en la base del artefacto "Pedidos NTX": datos/vendedores_ext; NO se guarda en este repositorio)
  Sin --clave-archivo se llama a Holded sin cabecera de clave (sirve cuando el entorno la inyecta)."""
import argparse, base64, datetime, hashlib, json, os, re, urllib.request
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
BCV, LIS, NUEVO = '6a230ac4aac0c5474e02901d', '6a23420aba4c079b090b2167', dict(id='6af59ce1fe2e564cd90b25b4', nombre='CLIENTE NUEVO')
LINEAS = {'MOTORES', 'ASPAS', 'BOBINAS', 'CARBONERAS', 'CONECTORES', 'RELAYS'}
a = argparse.ArgumentParser(); a.add_argument('--vendedores', required=True); a.add_argument('--salida', required=True); a.add_argument('--clave-archivo'); a = a.parse_args()
h = {'Accept': 'application/json'}
if a.clave_archivo: h['key'] = max(re.findall(r'[A-Za-z0-9]{20,}', open(a.clave_archivo, encoding='utf-8-sig').read()), key=len)
def todo(ruta):
    out, p = [], 1
    while p < 80:
        d = json.loads(urllib.request.urlopen(urllib.request.Request(f'https://api.holded.com/api/invoicing/v1/{ruta}?page={p}', headers=h), timeout=90).read())
        if not d: break
        out += d; p += 1
        if ruta == 'contacts' and len(d) < 500: break
    return out
prods, conts = todo('products'), todo('contacts')
precios = {}
for x in prods:
    sku = (x.get('sku') or '').strip()
    if sku and LINEAS & {str(t).upper() for t in (x.get('tags') or [])}:
        r = {y['id']: y.get('subtotal') for y in (x.get('rates') or [])}
        precios[sku] = [round(float(x.get('price') or 0), 2), round(float(r.get(LIS) or 0), 2), round(float(r.get(BCV) or 0), 2), float(x.get('stock') or 0)]
cl = sorted(([x['id'], ' '.join((x.get('name') or '').split()), ((x.get('tags') or [''])[0] or ''), x.get('tradeName') or ''] for x in conts
             if x.get('type') == 'client' and (x.get('name') or '').strip() and x['id'] != NUEVO['id']), key=lambda r: r[1].upper())
assert len(precios) > 50 and len(cl) > 50, 'Holded devolvió muy pocos datos; no se toca datos.json'
ahora = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'); b64 = lambda b: base64.b64encode(b).decode(); blobs = []
for v in json.load(open(a.vendedores, encoding='utf-8'))['v']:
    cod = re.sub(r'[^A-Z0-9]', '', v['codigo'].upper()); salt, iv = os.urandom(16), os.urandom(12)
    key = hashlib.pbkdf2_hmac('sha256', cod.encode(), salt, 150000, 32)
    data = dict(v=dict(k=v['k'], nombre=v['nombre'], tag=v['tag']), fecha=ahora, p=precios, nuevo=NUEVO, cl=[r for r in cl if r[2] == v['tag']])
    blobs.append(dict(s=b64(salt), i=b64(iv), d=b64(AESGCM(key).encrypt(iv, json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode(), None))))
    print(v['tag'], len(data['cl']), 'clientes')
json.dump(dict(fecha=ahora, v=blobs), open(a.salida, 'w', encoding='utf-8'), separators=(',', ':'))
print(len(precios), 'códigos con precio ·', ahora)
