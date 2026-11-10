// Copia a public/vendor/ia los archivos del motor del "Recorte de precisión" (transformers.js + onnxruntime-web).
// Se sirven como estáticos y el worker los carga sin pasar por webpack (el minificador de Next no entiende el
// bundle de onnxruntime-web). Se ejecuta solo antes de `dev` y `build`; la carpeta no se guarda en git.
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const destino = path.join(raiz, 'public', 'vendor', 'ia');
const archivos = [
  ['node_modules/@huggingface/transformers/dist/transformers.min.js', 'transformers.min.js'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.mjs'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.jsep.wasm'],
  // Motor directo con WebGPU (mejora de detalle)
  ['node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs', 'ort.webgpu.min.mjs'],
  // Motor directo (onnxruntime-web, solo procesador) para el relleno de objetos
  ['node_modules/onnxruntime-web/dist/ort.wasm.min.mjs', 'ort.wasm.min.mjs'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.mjs'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.wasm'],
  // Variante que usa el modo procesador (WASM)
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.mjs'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.wasm'],
];

fs.mkdirSync(destino, { recursive: true });
for (const [origen, nombre] of archivos) {
  const o = path.join(raiz, origen), d = path.join(destino, nombre);
  if (!fs.existsSync(o)) { console.error(`Falta ${origen}. Ejecuta "npm install" primero.`); process.exit(1); }
  if (!fs.existsSync(d) || fs.statSync(d).size !== fs.statSync(o).size) fs.copyFileSync(o, d);
}
console.log('Motor de recorte de precisión listo en public/vendor/ia');

