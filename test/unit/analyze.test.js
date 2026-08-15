import { describe, expect, it } from 'vitest';
import {
  buildFileName,
  buildPlaceholder,
  byteLength,
  countLines,
  detectLanguage,
  exceedsLimits,
  formatNumber,
  humanSize,
  measure,
  previewOf,
} from '../../src/analyze.js';
import { DEFAULTS } from '../../src/config.js';

describe('byteLength', () => {
  it('cuenta ASCII como 1 byte por carácter', () => {
    expect(byteLength('hola')).toBe(4);
  });

  it('cuenta multibyte UTF-8 correctamente', () => {
    expect(byteLength('ñ')).toBe(2);
    expect(byteLength('日本')).toBe(6);
    expect(byteLength('🚀')).toBe(4);
  });

  it('devuelve 0 para vacío o nulo', () => {
    expect(byteLength('')).toBe(0);
    expect(byteLength(null)).toBe(0);
    expect(byteLength(undefined)).toBe(0);
  });
});

describe('countLines', () => {
  it('una línea sin saltos', () => {
    expect(countLines('una sola')).toBe(1);
  });

  it('cuenta n+1 líneas para n saltos', () => {
    expect(countLines('a\nb')).toBe(2);
    expect(countLines('a\nb\nc')).toBe(3);
  });

  it('el salto final cuenta como línea vacía extra', () => {
    expect(countLines('a\n')).toBe(2);
  });

  it('ignora \\r (CRLF sigue contando una línea por \\n)', () => {
    expect(countLines('a\r\nb')).toBe(2);
  });

  it('cadena vacía es 0 líneas', () => {
    expect(countLines('')).toBe(0);
  });
});

describe('measure', () => {
  it('reporta chars, lines y bytes juntos', () => {
    expect(measure('añ\nb')).toEqual({ chars: 4, lines: 2, bytes: 5 });
  });

  it('tolera entradas nulas', () => {
    expect(measure(null)).toEqual({ chars: 0, lines: 0, bytes: 0 });
  });
});

describe('humanSize', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [20000, '19.5 KB'],
    [1048575, '1024.0 KB'],
    [1048576, '1.00 MB'],
    [5242880, '5.00 MB'],
  ])('%i → %s', (bytes, expected) => {
    expect(humanSize(bytes)).toBe(expected);
  });

  it('trata basura como 0', () => {
    expect(humanSize(undefined)).toBe('0 B');
  });
});

describe('formatNumber', () => {
  it('usa separador de miles español', () => {
    expect(formatNumber(20000)).toBe('20.000');
  });
});

describe('exceedsLimits', () => {
  const cfg = { ...DEFAULTS, maxChars: 100, maxLines: 10, maxBytes: 200 };

  it('no dispara por debajo de todos los límites', () => {
    expect(exceedsLimits({ chars: 99, lines: 9, bytes: 199 }, cfg)).toEqual([]);
  });

  it('NO dispara justo en el límite (comparación estricta)', () => {
    expect(exceedsLimits({ chars: 100, lines: 10, bytes: 200 }, cfg)).toEqual([]);
  });

  it('dispara al superar por uno cualquiera de los tres ejes', () => {
    expect(exceedsLimits({ chars: 101, lines: 1, bytes: 1 }, cfg)).toHaveLength(1);
    expect(exceedsLimits({ chars: 1, lines: 11, bytes: 1 }, cfg)).toHaveLength(1);
    expect(exceedsLimits({ chars: 1, lines: 1, bytes: 201 }, cfg)).toHaveLength(1);
  });

  it('acumula todos los motivos superados', () => {
    const hits = exceedsLimits({ chars: 500, lines: 50, bytes: 5000 }, cfg);
    expect(hits).toHaveLength(3);
    expect(hits[0]).toContain('caracteres');
    expect(hits[1]).toContain('líneas');
    expect(hits[2]).toContain('KB');
  });

  it('un codebase real de 60k chars cruza el umbral por defecto', () => {
    const code = 'const x = 1;\n'.repeat(5000);
    expect(exceedsLimits(measure(code), DEFAULTS).length).toBeGreaterThan(0);
  });

  it('un mensaje normal no lo cruza', () => {
    expect(exceedsLimits(measure('¿Puedes revisar este bug?'), DEFAULTS)).toEqual([]);
  });
});

describe('detectLanguage', () => {
  it.each([
    ['python', 'def main():\n    return 42\n'],
    ['python', 'from os import path\nimport sys\n'],
    ['java', 'package com.acme.app;\npublic class Main {}'],
    ['cpp', '#include <vector>\nint main() { return 0; }'],
    ['rust', 'pub fn main() {\n    println!("hi");\n}'],
    ['go', 'package main\nfunc main() { fmt.Println("hi") }'],
    ['javascript', 'const a = 1;\nexport function f() {}'],
    ['php', '<?php\n$x = 1;'],
    ['sql', 'SELECT * FROM users WHERE id = 1;'],
    ['html', '<!DOCTYPE html>\n<html></html>'],
    ['shell', '#!/bin/bash\nset -e\n'],
    ['markdown', '# Título\ntexto'],
  ])('detecta %s', (expected, code) => {
    expect(detectLanguage(code).name).toBe(expected);
  });

  it('cae a texto plano cuando no reconoce nada', () => {
    expect(detectLanguage('lorem ipsum dolor sit amet')).toEqual({ name: 'texto', ext: 'txt' });
  });

  it('cae a texto plano con entrada vacía o en blanco', () => {
    expect(detectLanguage('').name).toBe('texto');
    expect(detectLanguage('   \n  ').name).toBe('texto');
    expect(detectLanguage(null).name).toBe('texto');
  });

  it('solo mira la cabecera (sampleSize) para no escanear megas', () => {
    const text = 'x'.repeat(50) + '\ndef tarde():\n  pass';
    expect(detectLanguage(text, 10).name).toBe('texto');
    expect(detectLanguage(text, 5000).name).toBe('python');
  });

  it('devuelve un objeto nuevo cada vez (no comparte el fallback)', () => {
    const a = detectLanguage('???');
    a.name = 'mutado';
    expect(detectLanguage('???').name).toBe('texto');
  });
});

describe('buildFileName', () => {
  const date = new Date(2026, 7, 15, 9, 5, 3); // 2026-08-15 09:05:03 local

  it('incluye lenguaje y timestamp con ceros a la izquierda', () => {
    expect(buildFileName({ name: 'python', ext: 'py' }, date)).toBe(
      'pegado-python-20260815-090503.txt'
    );
  });

  it('siempre termina en .txt aunque el lenguaje tenga otra extensión', () => {
    expect(buildFileName({ name: 'rust', ext: 'rs' }, date).endsWith('.txt')).toBe(true);
  });

  it('sanea nombres raros y soporta lenguaje ausente', () => {
    expect(buildFileName({ name: 'c++ / raro' }, date)).toBe('pegado-c-raro-20260815-090503.txt');
    expect(buildFileName(null, date)).toBe('pegado-texto-20260815-090503.txt');
  });
});

describe('previewOf', () => {
  const text = 'l1\nl2\nl3\nl4\nl5';

  it('recorta a las primeras N líneas', () => {
    expect(previewOf(text, 2)).toBe('l1\nl2');
  });

  it('devuelve todo si hay menos líneas que el límite', () => {
    expect(previewOf(text, 99)).toBe(text);
  });

  it('devuelve vacío con límite 0 o negativo', () => {
    expect(previewOf(text, 0)).toBe('');
    expect(previewOf(text, -5)).toBe('');
  });

  it('recorta por caracteres aunque quepa en las líneas pedidas (minificados)', () => {
    const minified = 'a'.repeat(50000);
    const out = previewOf(minified, 12, 100);
    expect(out.length).toBeLessThan(200);
    expect(out).toContain('recortado');
  });

  it('no marca como recortado lo que cabe entero', () => {
    expect(previewOf(text, 99, 1000)).not.toContain('recortado');
  });
});

describe('buildPlaceholder', () => {
  const base = {
    fileName: 'pegado-python-20260815-090503.txt',
    metrics: { chars: 50000, lines: 3200, bytes: 51200 },
    language: { name: 'python', ext: 'py' },
    text: 'def a():\n  pass\ndef b():\n  pass',
  };

  it('resume nombre, lenguaje, líneas y tamaño en la primera línea', () => {
    const out = buildPlaceholder({ ...base, config: { ...DEFAULTS } });
    const [first] = out.split('\n');
    expect(first).toContain(base.fileName);
    expect(first).toContain('python');
    expect(first).toContain('3200 líneas');
    expect(first).toContain('50.0 KB');
  });

  it('incluye el preview entre fences cuando includePreview está activo', () => {
    const out = buildPlaceholder({ ...base, config: { ...DEFAULTS, previewLines: 2 } });
    expect(out).toContain('```');
    expect(out).toContain('def a():');
    expect(out).not.toContain('def b():');
  });

  it('omite el preview cuando está desactivado', () => {
    const out = buildPlaceholder({ ...base, config: { ...DEFAULTS, includePreview: false } });
    expect(out).not.toContain('```');
    expect(out).not.toContain('def a():');
  });

  it('siempre avisa de que el contenido completo va adjunto', () => {
    const out = buildPlaceholder({ ...base, config: { ...DEFAULTS } });
    expect(out).toContain('archivo adjunto');
  });

  it('el placeholder es muchísimo más corto que el texto original', () => {
    const huge = 'x'.repeat(500000); // 500 KB en UNA sola línea (minificado)
    const out = buildPlaceholder({ ...base, text: huge, config: { ...DEFAULTS } });
    expect(out.length).toBeLessThan(2000);
  });
});
