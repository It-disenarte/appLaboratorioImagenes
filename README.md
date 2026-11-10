# Laboratorio de imágenes · Diseñarte México

App web para trabajar imágenes, **sin costo por uso** (todo corre en el navegador, sin APIs de pago). **No hay cuentas, registro ni base de datos**: es una herramienta de uso inmediato y no guarda nada de nadie.

| Herramienta | Cómo funciona |
|---|---|
| Mejorar calidad | Dos vías: **rápida** (Lanczos-3 por pasos de 2× + filtro bilateral + enfoque) y **«Reconstruir detalle»**: Real-ESRGAN general x4v3 (BSD-3, 4.6 MB, `public/models/realesr-general-x4v3.onnx` con su licencia) con `onnxruntime-web` en un Web Worker (`lib/imaging/ia-detalle-worker.js`). Agranda 4× por mosaicos de 160 px con traslape de 16, usa WebGPU y, si no hay o falla, WASM (unas 6 veces más lento; tope de 0.4 MP de entrada sin GPU y 1.5 MP con GPU); el resultado se lleva a 1×/2×/3× con Lanczos y la transparencia se agranda aparte |
| Quitar fondo | Tres vías: **(1) «Recorte de precisión»**: modelo de segmentación BiRefNet 512×512 (licencia MIT, `onnx-community/BiRefNet_512x512-ONNX`) con `@huggingface/transformers` en un Web Worker (`lib/imaging/ia-worker.js`); se descarga de Hugging Face la primera vez (~200 MB) y queda en la caché del navegador; usa WebGPU y, si falla, WASM; la máscara se afina con filtro guiado a tamaño real; admite una selección previa (recuadro, a mano o silueta magnética). **(2) «Marcar sujeto»**: GrabCut propio (recuadro, lazo magnético o marcas verde/rojo). **(3) Automático / por color**: distancia de color en Lab. Todos con pincel de retoque |
| Quitar objetos | Dos vías: **rápida** (PatchMatch + votación, de grueso a fino) y **«Eliminar con precisión»**: modelo LaMa (`Carve/LaMa-ONNX`, Apache-2.0) con `onnxruntime-web` en un Web Worker (`lib/imaging/ia-objetos-worker.js`). Se descarga de Hugging Face la primera vez (~200 MB, caché del navegador) y trabaja con un recorte de 512×512 alrededor de lo marcado; solo se pegan de vuelta los píxeles marcados, con borde suave (`quitarObjetosPrecision` en `lib/imaging/client.js`) |
| Vectorizar | Cuantización de colores con paleta determinista (`lib/imaging/paleta.js`) + trazado de contornos (ImageTracer) → SVG y PDF vectorial |

Las imágenes se procesan **en el navegador** (Web Worker); nunca se suben a un servidor. La única preferencia que se guarda es la del asistente de uso, en el `localStorage` del propio navegador.

## Stack

Next.js 14 (Pages Router), sin base de datos ni autenticación. Diseño: `GUIA-DISENO-APPS-DISENARTE.md` (ícono dorado `#E0A526`).

## Desarrollo local

```bash
npm install
npm run dev          # http://localhost:3000
```

Para medir rendimiento real usa la versión de producción (`npm run build && npm start`): en `next dev` los cálculos pesados (vectorizar, GrabCut, relleno) van unas 10 veces más lentos.

`npm run dev` y `npm run build` ejecutan antes `scripts/copiar-ia.js`, que copia a `public/vendor/ia` el motor de los modelos (no se guarda en git).

## Producción

- No necesita variables de entorno ni base de datos.
- `Dockerfile` listo para Easypanel (`output: 'standalone'`). En Vercel funciona igual.
- Cualquiera que tenga la dirección puede usarla (no hay inicio de sesión). Si se quiere restringir el acceso, hay que hacerlo en el servidor o proxy (por ejemplo, autenticación básica en Easypanel).
- Los modelos se descargan de Hugging Face desde el navegador de cada persona; hace falta internet la primera vez.
- PWA: al cambiar el diseño, sube `CACHE` en `public/sw.js`.

## Estructura del motor de imagen

`lib/imaging/` — `upscale.js`, `bgremove.js`, `inpaint.js`, `vectorize.js`, `pdf.js` son funciones puras sobre `{ data, width, height }`;
`worker.js` las ejecuta fuera del hilo principal y `client.js` es el puente con la pantalla.

## Límites conocidos

- Máximo 50 megapíxeles por imagen (mejora de calidad: 36 MP de salida).
- Quitar fondo: los modos Automático y Por color van por color, así que fondos con muchos tonos o sujetos del mismo color que el fondo necesitan el recorte de precisión o retoque con pincel.
- Quitar objetos: el relleno de precisión trabaja a 512×512; un objeto muy grande en una foto de alta resolución se rellena a menor detalle.
- Vectorizar fotos da un efecto de ilustración por capas, no un trazo fiel.
