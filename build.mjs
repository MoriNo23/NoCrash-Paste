import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const banner = `// ==UserScript==
// @name         NoCrash Paste
// @namespace    https://github.com/MoriNo23/NoCrash-Paste
// @version      ${pkg.version}
// @description  ${pkg.description}
// @author       MoriNo23
// @match        https://gemini.google.com/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// ==/UserScript==
`;

const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  charset: 'utf8',
  banner: { js: banner },
  outfile: 'dist/nocrash-paste.user.js',
  legalComments: 'none',
  metafile: true,
});

const out = result.metafile.outputs['dist/nocrash-paste.user.js'];
console.log(`✔ dist/nocrash-paste.user.js — ${(out.bytes / 1024).toFixed(1)} KB`);

// Copia estable para el banco de pruebas local.
writeFileSync('test/nocrash-paste.build.js', readFileSync('dist/nocrash-paste.user.js'));
