// Receptor de pedidos del "Catálogo NTX Vendedores". Vive en la cuenta de Google de Mango (script.google.com).
// Recibe el pedido que manda la página y lo envía por correo a esa misma cuenta con el asunto "PEDIDO NTX <id>".
// Claude lee esos correos y crea el pedido en Holded. Implementar como aplicación web: "Ejecutar como: yo", "Acceso: cualquier persona".
function doGet(e) {
  var p = (e && e.parameter && e.parameter.p) || "";
  if (!/^[A-Za-z0-9_-]{20,6000}$/.test(p)) return pagina("No llegó ningún pedido", "Vuelve al catálogo y envíalo de nuevo.");
  var datos, b64 = p;
  while (b64.length % 4) b64 += "=";
  try {
    datos = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString("UTF-8"));
  } catch (err) {
    return pagina("No se pudo leer el pedido", "Envíalo por WhatsApp desde el catálogo.");
  }
  var cache = CacheService.getScriptCache();            // si recargan la pestaña no se duplica el correo
  if (!cache.get(String(datos.id))) {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), "PEDIDO NTX " + datos.id,
      "#NTX1." + p + "\n\nCliente: " + (datos.cn ? "CLIENTE NUEVO: " + datos.cn : datos.ci) +
      "\nPiezas: " + datos.l + "\nTarifa: " + datos.tf + " · Descuento: " + datos.d + "%" + (datos.n ? "\nNota: " + datos.n : ""));
    cache.put(String(datos.id), "1", 21600);
  }
  return pagina("Pedido recibido", "Ya puedes cerrar esta pestaña y volver al catálogo.");
}
function pagina(titulo, texto) {
  return HtmlService.createHtmlOutput('<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<div style="font-family:sans-serif;text-align:center;padding:48px 20px"><h1>' + titulo + '</h1><p>' + texto + '</p></div>');
}
