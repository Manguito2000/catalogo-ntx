# Lector de capturas (portal de ventas NTX)

Archivos de [Tesseract.js](https://github.com/naptha/tesseract.js) 5.1.1 (licencia Apache 2.0), servidos desde aquí para que el teléfono del vendedor lea las capturas de pago sin depender de otros sitios:

- `tesseract.min.js`, `worker.min.js`: el lector.
- `tesseract-core-simd-lstm.wasm.js`, `tesseract-core-lstm.wasm.js`: el motor (el teléfono baja solo uno de los dos).
- `spa.traineddata.gz`: el modelo de español (tessdata 4.0.0_best_int).

La lógica que interpreta el texto (monto, fecha, referencia, cuenta destino) está en `herramientas/cobranzas_pagina.js`, bloque `/*LECTOR*/`. Las cuentas de la empresa no están en este repositorio: se inyectan cifradas al armar el portal (`aplicar_cobranzas.py`).

El teléfono baja estos archivos una sola vez y los guarda (Cache Storage `ntx-ocr-<OCR_V>` e IndexedDB). Si se cambia cualquiera de ellos, hay que subir `OCR_V` en `herramientas/cobranzas_pagina.js` para que los teléfonos bajen la versión nueva.
