# -*- coding: utf-8 -*-
"""Refresca datos.json del Catálogo NTX de vendedores: precios, stock y clientes de Holded, cifrados con el código de cada vendedor
más su llave del servidor (la que el Apps Script solo entrega a dispositivos aprobados).
Uso:  python3 herramientas/refrescar_datos.py --vendedores vendedores.json --salida datos.json [--clave-archivo "clave V1.txt"]
  vendedores.json = {"v": [{"tag", "nombre", "codigo", "k", "s"}], "admin": "<llave del panel; opcional>"}  (está en la base del artefacto "Pedidos NTX": datos/vendedores_ext; NO se guarda en este repositorio)
  Sin --clave-archivo se llama a Holded sin cabecera de clave (sirve cuando el entorno la inyecta)."""
import argparse, base64, datetime, hashlib, json, os, re, urllib.request
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
BCV, LIS, NUEVO = '6a230ac4aac0c5474e02901d', '6a23420aba4c079b090b2167', dict(id='6af59ce1fe2e564cd90b25b4', nombre='CLIENTE NUEVO')
LINEAS = {'MOTORES', 'ASPAS', 'BOBINAS', 'CARBONERAS', 'CONECTORES', 'RELAYS', 'VÁLVULAS/SENSORES', 'ELECTROS'}
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
prods, conts, notas = todo('products'), todo('contacts'), todo('documents/invoice')
precios = {}
for x in prods:
    sku = (x.get('sku') or '').strip()
    if sku and LINEAS & {str(t).upper() for t in (x.get('tags') or [])}:
        r = {y['id']: y.get('subtotal') for y in (x.get('rates') or [])}
        precios[sku] = [round(float(x.get('price') or 0), 2), round(float(r.get(LIS) or 0), 2), round(float(r.get(BCV) or 0), 2), float(x.get('stock') or 0)]
cl = sorted(([x['id'], ' '.join((x.get('name') or '').split()), ((x.get('tags') or [''])[0] or ''), x.get('tradeName') or ''] for x in conts
             if x.get('type') == 'client' and (x.get('name') or '').strip() and x['id'] != NUEVO['id']), key=lambda r: r[1].upper())
assert len(precios) > 50 and len(cl) > 50, 'Holded devolvió muy pocos datos; no se toca datos.json'
# --- Cobranzas: notas pendientes (y saldadas hace poco) por cliente. Solo lectura de Holded.
# Cada nota: [id, número, idCliente, fecha, vence, total, pagado, pendiente, tarifa, desc%, saldoReal, saldoBs, [[idPago, monto, fecha]], factura]
#   factura = [número, iva] si la nota ya tiene factura AdriMan (etiquetas fac###### e iva##### que pone Claude al emitirla; iva en centavos de
#   dólares de la nota, None si no vino), o None. El portal muestra la nota con su factura y el IVA aparte del neto.
#   tarifa: 'u' USD, 'l' Lista, 'b' BCV, '?' no se pudo determinar (se deduce comparando los precios de la nota con las tarifas actuales).
#   saldoReal = lo que falta en dólares reales (lo que cuenta Holded una vez puesto el descuento BCV). En una nota BCV sin el descuento todavía: pendiente x (1 - descuento_bcv).
#   saldoBs   = solo notas BCV: lo que falta en dólares a tasa BCV (lo que ve y cobra el vendedor): pendiente / (1 - desc% de la nota), o el pendiente si aún no tiene descuento. En las demás va null.
#   Los pagos (id de Holded) permiten a la página confirmar los cobros anotados por el vendedor sin depender del saldo.
# Descuento BCV: un solo número para todo el sistema, en config.json (raíz del repositorio)
try: FBCV = 1 - float(json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'config.json'), encoding='utf-8'))['descuento_bcv']) / 100
except Exception: FBCV = 0.85
tar = {}
for x in prods:
    sku = (x.get('sku') or '').strip(); r = {y['id']: y.get('subtotal') for y in (x.get('rates') or [])}
    if sku: tar[sku] = (float(x.get('price') or 0), float(r.get(LIS) or 0), float(r.get(BCV) or 0))
def tarifa(n):
    v = dict(u=0, l=0, b=0); m = 0
    for l in n.get('products') or []:
        t, pr = tar.get((l.get('sku') or '').strip()), float(l.get('price') or 0)
        if not t or pr <= 0: continue
        m += 1; c = min(((abs(pr - ref) / ref, q) for ref, q in zip(t, 'ulb') if ref > 0), default=(9, ''))
        if c[0] <= 0.02: v[c[1]] += 1
    q = max(v, key=v.get)
    return q if m and v[q] * 2 > m else '?'
def factura(tags):
    f = iva = None
    for t in tags or []:
        t = str(t).lower(); m = re.fullmatch(r'fac(\d{1,10})', t); v = re.fullmatch(r'iva(\d{1,12})', t)
        if m: f = m.group(1).zfill(6)
        if v: iva = int(v.group(1)) / 100
    return [f, iva] if f else None
tagcl = {x['id']: ((x.get('tags') or [''])[0] or '') for x in conts}
corte = datetime.datetime.now().timestamp() - 21 * 86400; nt = {}
for n in notas:
    if n.get('draft') or not n.get('docNumber'): continue
    pen, pag = round(float(n.get('paymentsPending') or 0), 2), [[y.get('id'), round(float(y.get('amount') or 0), 2), y.get('date')] for y in (n.get('paymentsDetail') or [])]
    if pen < 0.01 and not (pag and max(y[2] or 0 for y in pag) >= corte): continue
    t, d = tarifa(n), float(n.get('discount') or 0)
    real = round(pen * FBCV, 2) if t == 'b' and d == 0 else pen
    bcv = (round(pen / (1 - d / 100), 2) if d > 0 else pen) if t == 'b' else None   # lo que falta en dólares a tasa BCV
    nt.setdefault(tagcl.get(n.get('contact'), ''), []).append([n['id'], n['docNumber'], n.get('contact'), n.get('date'), n.get('dueDate') or None,
        round(float(n.get('total') or 0), 2), round(float(n.get('paymentsTotal') or 0), 2), pen, t, d, real, bcv, pag, factura(n.get('tags'))])
assert len(notas) > 100, 'Holded devolvió muy pocas notas; no se toca datos.json'
ahora = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'); b64 = lambda b: base64.b64encode(b).decode(); blobs = []
VJ = json.load(open(a.vendedores, encoding='utf-8'))
ADM = VJ.get('admin') or os.environ.get('NTX_ADMIN') or ''   # llave de administración (receptor): solo entra, cifrada, en los datos del vendedor 'rm' (Mango)
for v in VJ['v']:
    cod = re.sub(r'[^A-Z0-9]', '', (v['codigo'] + v['s']).upper()); salt, iv = os.urandom(16), os.urandom(12)
    key = hashlib.pbkdf2_hmac('sha256', cod.encode(), salt, 150000, 32)
    data = dict(v=dict(k=v['k'], nombre=v['nombre'], tag=v['tag']), fecha=ahora, p=precios, nuevo=NUEVO, cl=[r for r in cl if r[2] == v['tag']], nt=sorted(nt.get(v['tag'], []), key=lambda r: r[3] or 0))
    if v['tag'] == 'rm' and ADM: data['adm'] = ADM
    blobs.append(dict(s=b64(salt), i=b64(iv), d=b64(AESGCM(key).encrypt(iv, json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode(), None))))
    print(v['tag'], len(data['cl']), 'clientes ·', sum(1 for r in data['nt'] if r[7] >= 0.01), 'notas pendientes')
json.dump(dict(fecha=ahora, v=blobs), open(a.salida, 'w', encoding='utf-8'), separators=(',', ':'))
print(len(precios), 'códigos con precio ·', ahora)
