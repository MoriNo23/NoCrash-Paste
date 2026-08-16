# NoCrash Paste

Userscript que evita que el navegador se congele (o mate la pestaña) cuando pegas un
**codebase entero** en un agente web. En vez de dejar que el editor intente renderizar
200 KB de código, el pegado se convierte en un **adjunto `.txt`** y en el compositor
solo queda un resumen legible.

```
[Adjunto: pegado-python-20260815-090503.txt · python · 3200 líneas · 50.0 KB]

Primeras 12 líneas:
```
def main():
    ...
```

El contenido completo está en el archivo adjunto.
```

## Por qué peta el navegador

El compositor de estos agentes es un `contenteditable` (Quill en el caso de Gemini):
al pegar se crea **un nodo DOM por línea**, se dispara un reflow completo y el
framework re-renderiza en cada pulsación posterior. Medido en un equipo de ~4 GB de RAM:

| Tamaño pegado | Comportamiento |
|---|---|
| < 10k caracteres | fluido |
| 20k–50k caracteres | lag notable al escribir |
| 50k–150k caracteres | freeze de 2–20 s, "la página no responde" |
| > 200 KB | OOM / crash de la pestaña |

De ahí los umbrales por defecto: **20.000 caracteres · 1.500 líneas · 200 KB**
(salta el primero que se cruce, los tres son configurables).

## Instalación

1. Instala [Violentmonkey](https://violentmonkey.github.io/) o Tampermonkey.
2. `npm install && npm run build`
3. Arrastra `dist/nocrash-paste.user.js` al gestor de userscripts.

## Uso

Pega normal. Si el texto supera los límites:

1. Se cancela el pegado nativo (el sitio nunca ve el texto → no hay freeze).
2. Se detecta el lenguaje y se genera `pegado-<lenguaje>-<timestamp>.txt`.
3. El archivo se sube al uploader del sitio (o, si eso falla, se te descarga para
   que lo subas a mano — **el texto nunca se pierde**).
4. Se escribe el resumen en el compositor.

Ajustes: menú del gestor de userscripts → *⚙️ Ajustes de NoCrash Paste*, o **Alt+Shift+P**.

## Soporte por sitio

| Sitio | Estado | Estrategia |
|---|---|---|
| gemini.google.com | ✅ | `input[type=file]` del uploader, con fallback a drag&drop sintético |
| ChatGPT / Claude / otros | 🔜 | añadir un adaptador en `src/adapters/` |

### Añadir un adaptador nuevo

Un adaptador es un objeto con cinco métodos (`src/adapters/gemini.js` como referencia):

```js
export const miAdaptador = {
  id: 'mi-sitio',
  matches: () => location.hostname === 'mi-sitio.com',
  isEditor: (el) => !!el?.closest?.('[contenteditable="true"]'),
  attach: async (file) => { /* subir el File; devolver true/false */ },
  insertText: (el, texto) => { /* escribir el resumen */ },
};
```

Regístralo en `src/main.js` (`ADAPTERS`) y añade el `@match` en `build.mjs`.

## Arquitectura

```
src/
  analyze.js         medir texto, umbrales, detectar lenguaje, textos derivados (puro)
  config.js          defaults, saneado y persistencia (GM_* → localStorage → memoria)
  handler.js         el listener de paste: toda la lógica de decisión (inyección de deps)
  dom.js             File, DataTransfer, insertar texto, descarga de emergencia
  ui.js              toast + panel de ajustes
  adapters/          un objeto por sitio
  main.js            wiring y autoarranque
```

El núcleo (`handler.js`) no toca el DOM: recibe adaptador, config, `makeFile`,
`downloadFile`, `notify`, `sleep`, `now` y `log` por inyección, así que se puede
testear entero sin navegador.

## Testing

```bash
npm test            # 218 tests unitarios (Vitest + jsdom)
npm run coverage    # cobertura V8 (umbral: 90% líneas)
npm run mutation    # mutation testing con Stryker (umbral de ruptura: 85%)
npm run verify      # las tres cosas + build
```

Estado actual:

| Métrica | Valor |
|---|---|
| Tests | 218 ✅ |
| Cobertura de líneas | 99% |
| **Mutation score** | **91.4%** (`handler.js` 97%, `config.js` 95%) |

Los tests cubren el contrato completo: qué NO se intercepta (portapapeles con
archivos, texto corto, foco fuera del editor), qué sí, el fallback a descarga cuando
el uploader no aparece, la integridad del texto, el saneado de configuración y los
detalles del DOM (burbujeo de eventos, `execCommand` fallando, selección viva del
usuario, `input.files` de solo lectura…).

Dos exclusiones deliberadas de mutación, documentadas en el código:

- la tabla `SIGNATURES` de detección de lenguaje (sus mutantes `\s+`→`\s` son
  equivalentes: fallar la detección solo cambia el nombre del adjunto);
- los defaults no-op del handler (`notify`, `sleep`, `log`).

### Banco de pruebas manual

```bash
npm run build
npx http-server . -p 3000
# abre http://localhost:3000/test/sandbox.html
```

Simula el compositor de un agente (contenteditable + uploader oculto), genera
pegados de 5k / 60k / 400k caracteres y te deja probar la intercepción de verdad.
El adaptador de pruebas solo se activa si el documento tiene `data-nocrash-test`,
así que jamás puede dispararse en un sitio real.
