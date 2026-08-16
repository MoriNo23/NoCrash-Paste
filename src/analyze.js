/**
 * Análisis del texto pegado: tamaño, límites, lenguaje y textos derivados.
 * Todo aquí es puro — sin DOM — para poder testearlo y mutarlo a gusto.
 */

/** Bytes UTF-8 sin depender de Blob (que no existe en todos los runtimes). */
export function byteLength(text) {
  if (!text) return 0;
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
  return Buffer.byteLength(text, 'utf8');
}

export function countLines(text) {
  if (!text) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines++;
  }
  return lines;
}

export function measure(text) {
  const value = text || '';
  return { chars: value.length, lines: countLines(value), bytes: byteLength(value) };
}

export const formatNumber = (n) => Number(n).toLocaleString('es-ES');

export function humanSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Devuelve la lista de límites superados (vacía = pegado normal).
 * Estrictamente mayor: pegar justo el límite NO se intercepta.
 */
export function exceedsLimits(metrics, config) {
  const hits = [];
  if (metrics.chars > config.maxChars) hits.push(`${formatNumber(metrics.chars)} caracteres`);
  if (metrics.lines > config.maxLines) hits.push(`${formatNumber(metrics.lines)} líneas`);
  if (metrics.bytes > config.maxBytes) hits.push(humanSize(metrics.bytes));
  return hits;
}

/**
 * Firmas ordenadas de más específica a más genérica.
 *
 * Stryker está desactivado en esta tabla a propósito: son heurísticas de
 * "mejor esfuerzo" y sus mutantes (\s+ -> \s, \w -> \W, ...) son equivalentes
 * en la práctica — fallar la detección solo cambia el nombre del adjunto, no
 * el comportamiento. Lo que sí se testea es el contrato: detecta los lenguajes
 * habituales y cae a "texto" cuando no reconoce nada.
 */
// Stryker disable all
export const SIGNATURES = [
  [/^\s*(?:#!\/bin\/(?:ba|z)?sh|#!\/usr\/bin\/env\s+(?:ba|z)?sh)/m, 'shell', 'sh'],
  [/<\?php|\$this->|namespace\s+\w+\\/m, 'php', 'php'],
  [/^\s*(?:def\s+\w+\s*\(|class\s+\w+(?:\(.*\))?\s*:|from\s+[\w.]+\s+import\b|import\s+\w+$)/m, 'python', 'py'],
  [/^\s*(?:package\s+[\w.]+;|public\s+(?:static\s+)?(?:final\s+)?class\s+\w+|@Override)/m, 'java', 'java'],
  [/#include\s*[<"]|std::\w+|int\s+main\s*\(/m, 'cpp', 'cpp'],
  [/^\s*(?:fn\s+\w+|pub\s+fn\s+\w+|impl\s+\w+|use\s+\w+::)/m, 'rust', 'rs'],
  [/^\s*(?:func\s+\w+|package\s+main\b)|:=\s|fmt\.Print/m, 'go', 'go'],
  [/(?:^|\s)(?:interface|type)\s+\w+\s*(?:=|\{)|:\s*(?:string|number|boolean)\b/m, 'typescript', 'ts'],
  [/^\s*(?:const|let|var|function|export|import|async function)\b|=>\s*[{(]/m, 'javascript', 'js'],
  [/^\s*(?:SELECT|INSERT\s+INTO|UPDATE|CREATE\s+TABLE|ALTER\s+TABLE)\b/im, 'sql', 'sql'],
  [/^\s*<(?:!DOCTYPE|html|head|body|div|section)\b/im, 'html', 'html'],
  [/^\s*[.#]?[\w-]+\s*\{[^{}]*[\w-]+\s*:[^{}]*;/m, 'css', 'css'],
  [/^\s*\{[\s\S]{0,400}?"[\w-]+"\s*:/m, 'json', 'json'],
  [/^---\s*$/m, 'yaml', 'yaml'],
  [/^#{1,6}\s+\S|^```/m, 'markdown', 'md'],
];
// Stryker restore all

export const FALLBACK_LANGUAGE = Object.freeze({ name: 'texto', ext: 'txt' });

/** Heurística barata: solo mira la cabecera, suficiente para nombrar el archivo. */
export function detectLanguage(text, sampleSize = 4000) {
  const head = (text || '').slice(0, sampleSize);
  if (!head.trim()) return { ...FALLBACK_LANGUAGE };
  for (const [pattern, name, ext] of SIGNATURES) {
    if (pattern.test(head)) return { name, ext };
  }
  return { ...FALLBACK_LANGUAGE };
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Siempre .txt: es la extensión que todos los agentes web aceptan sin pelear.
 * El lenguaje detectado va en el nombre para que el modelo tenga la pista.
 */
export function buildFileName(language, date = new Date()) {
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const name = String(language?.name || FALLBACK_LANGUAGE.name).replace(/[^\w-]+/g, '-');
  return `pegado-${name}-${stamp}.txt`;
}

/** Tope duro del preview: un minificado puede tener 500 KB en UNA sola línea. */
export const MAX_PREVIEW_CHARS = 1200;
export const TRUNCATION_MARK = '\n… (recortado)';

export function previewOf(text, lines, maxChars = MAX_PREVIEW_CHARS) {
  const limit = Math.max(0, Number(lines) || 0);
  if (limit === 0) return '';
  const head = (text || '').split('\n').slice(0, limit).join('\n');
  if (head.length <= maxChars) return head;
  return head.slice(0, maxChars) + TRUNCATION_MARK;
}

export function buildPlaceholder({ fileName, metrics, language, text, config }) {
  const parts = [
    `[Adjunto: ${fileName} · ${language.name} · ${formatNumber(metrics.lines)} líneas · ${humanSize(metrics.bytes)}]`,
  ];
  const preview = config.includePreview ? previewOf(text, config.previewLines) : '';
  if (preview) {
    const shown = Math.min(config.previewLines, metrics.lines);
    parts.push('', `Primeras ${formatNumber(shown)} líneas:`, '```', preview, '```');
  }
  parts.push('', 'El contenido completo está en el archivo adjunto.');
  return parts.join('\n');
}
