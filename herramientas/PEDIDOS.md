# Pedidos directo a Holded y bandeja de Mango — estado y contrato (nov 2026)

Hecho y probado en seco contra Holded real (Opus): `pedidos_apps_script.gs` (archivo aparte del proyecto de Apps Script del receptor).
Falta (Sonnet): las pantallas de la bandeja en la pestaña ADMIN del portal.

## Qué cambió
- El receptor crea el pedido (`salesorder`) o presupuesto (`estimate`) en Holded **en el momento** en que el vendedor envía. Ya no hace falta la tarea horaria «Procesar pedidos NTX» (se apaga cuando Mango confirma la instalación).
- Reglas iguales a las de esa tarea: cliente tipo client; cartera = primera etiqueta del contacto igual al tag del vendedor (salvo `rm` y CLIENTE NUEVO); tarifa usd|bcv; descuento 0–15; código con precio; cantidad entera 1–999; conectores de 4 en 4 y con stock > 8; cantidad ≤ stock. Vencimiento 30 días si no es de contado. `notes` con «Pedido desde Pedidos NTX · Vendedor · TARIFA BCV · Pago de contado / Descuento · CLIENTE NUEVO · Nota · Ref <id>». `desc` visible con la nota del vendedor.
- Hoja «Pedidos» (en el libro de Cobranzas NTX): un registro por pedido del portal, con estado `holded` | `revisar` | `cola`. El mismo `id` no se duplica (recargar la pestaña no crea otro).
- El vendedor ve en la pestaña que se abre el número (SO… / E…) o el motivo. El correo a Mango ahora tiene asunto «NTX · Pedido SO260034 · cliente · vendedor» o «NTX · REVISAR pedido · …» (ya no empieza con «PEDIDO NTX»).
- `pdCiclo` (cada 10 min): reintenta la cola y revisa las notas que salieron de pedidos o presupuestos de los últimos 3–4 días (hoja «Revisión notas»; hasta el 1 dic 2026 también las del 16 nov en adelante, para arreglar NE4248, NE4254, NE4256, NE4258, NE4259 y NE4262):
  - **Envío**: en una nota que sale de un pedido, el stock solo baja con el envío del pedido (albarán W…). Si falta, lo envía solo (`POST documents/salesorder/<id>/shipbylines {lines:[{itemLinePosition, units}]}`), solo lo facturado.
  - **Piezas agregadas a la nota que no estaban en el pedido NO bajan del stock** (comprobado en el historial: NE4262 A612/MT1, NE4256 C251A/C128A). Se avisa por correo «stock por corregir» y en la bandeja; no se corrige solo.
  - Notas que salen de presupuestos bajan el stock solas (comprobado: NE4261, NE4254).
  - **Vencimiento**: 30 días; 3 si el pedido era de contado. Si la nota no está pagada y vence antes, se corrige (PUT con date, dueDate, discount, tags y desc, y se relee).
  - **Descuento**: si la nota tiene menos descuento que el pedido en las mismas piezas → «falta» (no se corrige: Mango imprime y luego aplica el global).
  - **Nota del vendedor**: si nombra códigos, comprueba que estén en la nota con esa cantidad; si no nombra códigos → «leer» (Mango la marca revisada).
  - CLIENTE NUEVO que sigue como CLIENTE NUEVO en la nota → aviso.
- Notas creadas por API (Claude, skill facturar-ntx) no tienen enlace con el pedido: se enlazan con la etiqueta del número de origen en minúsculas (`so260025`, `e260009`). Esas no necesitan envío (la nota por API baja el stock).

## Rutas nuevas del receptor (GET, mismo /exec)
- `?p=<pedido>` (sin `a`): lo de arriba. Devuelve HTML para el vendedor.
- `?a=bandeja&k=<ADMIN>[&f=1]` → JSON (caché 60 s; `f=1` la salta):
```
{ estado:"ok", ahora:<unix>, cfg:{hechosDias:7, presVence:15},
  ped: [V], pre: [V + vencido:bool], cola:[C], rev:[C], hechos:[H] }
V = { id, num:"SO260033", tipo:"pedido"|"presupuesto", fecha:<unix Holded>, dias:<entero, antigüedad>, cliente, clienteId, vend:"Elías"|"", total,
      tarifa:"usd"|"bcv"|"", contado:bool, desc:<% mayor>, vence:<días de crédito, 0 si no tiene>, nota:"texto del vendedor"|"", nuevo:bool (CLIENTE NUEVO),
      portal:bool, lineas:[[sku, unidades, precio, desc%]] }   // ordenados del más viejo al más nuevo
C = { id (id del portal), recibido:<unix real>, cliente, vend, tipo, lineas:"2 MT1, 8 C75A", nota, obs }   // cola = esperando a Holded; rev = no se creó (motivo en obs)
H = { notaId, nota:"NE4262", origen:"SO260032", tipo, cliente, vend, total, fecha:<unix Holded>, envio, venc, desc, notaV, avisos, visto:"" | <unix>, ok:bool, primera:<unix real> }
```
  Textos de H: `envio` = ok | n/a | «enviado solo: …» | «falta enviar» | «no se pudo enviar…»; `venc` = «ok (30 días)» | «corregido a 30 días» | «pagada (…)» | «corregir: …» | «revisar en Holded: …» | «vence a N días; debía ser M»;
  `desc` = ok | «falta: MT920 15% → 0%»; `notaV` = n/a | «ok: «…»» | «falta: 10 C251A · «…»» | «leer: «…»»; `avisos` = texto con « · »; los que empiezan con «STOCK:» son problemas de stock.
- `?a=bacc&k=<ADMIN>&h=<id de pedido/presupuesto o id del portal>&e=ocultar|mostrar` → oculta de la bandeja (no toca Holded). Devuelve la bandeja nueva.
- `?a=bacc&k=<ADMIN>&n=<notaId>&e=revisado|pendiente` → marca la revisión de una nota. Devuelve la bandeja nueva.
- Fechas de Holded (`fecha` de V y H): medianoche de España; día de calendario = UTC de (ts + 2 h), igual que `cbDia` en cobranzas_pagina.js.
- Las solicitudes de factura y retenciones siguen en `?a=adm` (cobranzas_apps_script.gs).

## Pantallas que faltan (pestaña ADMIN del portal, solo con el código de Mango)
Diseño aprobado por Mango (21 nov 2026):
- Arriba, tres pestañas: **Pedidos (n) · Presupuestos (n) · Facturas (n)**. Retenciones pasa a ser un filtro (chip) dentro de Facturas.
- Fila de chips de vendedor: Todos · Elías · Gabriel · Natasha · Nersi · Randy · Yo (Yo = vend vacío o Mango).
- Pedidos: franja azul «En camino a Holded (n)» (cola) y franja ámbar «Revisar (n)» (rev, con el motivo y botón Descartar = ocultar). Luego tarjetas, **la más vieja arriba**. Antigüedad: normal el mismo día, ámbar desde el día siguiente, roja después de 2 días.
- Tarjeta cerrada: cliente (o «Cliente nuevo: …»), total, número · vendedor · antigüedad, chips tarifa (USD/BCV) · crédito (30 días / contado) · n líneas, y la nota 📝 si hay. Al tocar: las líneas. Botones: «Copiar para Claude» (texto «convierte SO260033 en nota») y «Ocultar».
- Presupuestos: igual; los de 15 días o más van a un grupo plegado «Vencidos (n)» al final.
- Al pie de cada pestaña: «Hechos · últimos 7 días (n)» plegado. Cada hecho: «SO260032 → NE4262 · $213,66 · fecha» con ✓ verde si `ok` o si `visto`; si no, ⚠ con lo que falta (envío, vencimiento, descuento, nota del vendedor, avisos) y botón «Revisado». Un `desc` «falta» solo se pinta en ámbar si `primera` tiene más de 60 min (antes, Mango todavía puede estar aplicando el descuento global).
- Insignia roja del botón ADMIN: pedidos abiertos + rev + facturas pendientes + hechos con ⚠ «STOCK:». Los presupuestos no cuentan.
- Refresco: al abrir y cada 3 min (igual que hoy), y al jalar hacia abajo.
- Mantener la estética del portal y los colores de día/noche (`--red-tx` para texto rojo).

## Para cuando se automatice la conversión pedido → nota (pendiente)
Hoy Mango convierte a mano y cumple a mano lo que piden las notas de los vendedores (p. ej. NE4256 trae los «10 C251A» de la nota de Elías; NE4262 trae la A612 que Gabriel pidió «agregar al pedido pendiente»). Cuando la conversión la haga Claude:
- Leer la nota del vendedor (📝 en la descripción del pedido, o «Nota:» en notes) y aplicarla: códigos y cantidades a agregar; «agregar al pedido pendiente» = unir con el pedido abierto del mismo cliente.
- Agregar esas piezas **al pedido antes de convertirlo** (o crear la nota por API con la etiqueta so######), nunca solo en la nota: lo agregado solo en la nota no baja del stock.
- Si la nota no se puede interpretar con seguridad, preguntar a Mango antes de emitir.
- Stock regularizado el 21 nov 2026 por esta causa: NE4262 (A612 −1, MT1 −2) y NE4256 (C251A −10, C128A −8), con la descripción «NEXXXX CLIENTE FECHA - Regularización: línea facturada no descontada», fechados el día de la nota.
