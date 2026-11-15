# Catálogo NTX

Catálogo de motores, aspas, bobinas, carboneras, conectores y relays NTX para vendedores (portal de ventas NTX). La página se genera automáticamente; no edites estos archivos a mano.

## Seguridad
- Todo el catálogo, los precios, el stock y los clientes van cifrados. Para abrirlos hacen falta el código del vendedor **y** una llave que solo entrega el receptor (Google Apps Script) a un dispositivo aprobado.
- El primer dispositivo de cada vendedor queda registrado solo. Cualquier otro queda esperando la aprobación de administración, que recibe un correo para aprobar o rechazar.
- La página muestra una marca de agua discreta con el nombre del vendedor y la ficha corta de su dispositivo.

## Herramientas
- `herramientas/refrescar_datos.py`: refresca `datos.json` desde Holded (tarea automática).
- `herramientas/portal.py`: abre `index.html` para editar el catálogo y lo vuelve a armar cifrado.
- `herramientas/receptor_apps_script.gs`: plantilla del receptor (pedidos, portero de dispositivos y panel). Los valores secretos no están en este repositorio.
