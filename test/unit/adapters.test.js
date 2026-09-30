import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { geminiAdapter } from '../../src/adapters/gemini.js';
import { sandboxAdapter } from '../../src/adapters/sandbox.js';
import { makeFile } from '../../src/dom.js';

const file = () => makeFile('codebase enorme', 'pegado.txt');

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-nocrash-test');
});

afterEach(() => vi.restoreAllMocks());

describe('geminiAdapter.matches', () => {
  it('solo en gemini.google.com', () => {
    // jsdom corre en localhost
    expect(geminiAdapter.matches()).toBe(false);
  });
});

describe('geminiAdapter.isEditor', () => {
  it.each([
    ['rich-textarea', '<rich-textarea><div id="t"></div></rich-textarea>'],
    ['.ql-editor', '<div class="ql-editor"><p id="t">hola</p></div>'],
    ['contenteditable', '<div contenteditable="true"><span id="t"></span></div>'],
  ])('reconoce %s', (_, html) => {
    document.body.innerHTML = html;
    expect(geminiAdapter.isEditor(document.getElementById('t'))).toBe(true);
  });

  it('reconoce un textarea directo', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    expect(geminiAdapter.isEditor(document.getElementById('t'))).toBe(true);
  });

  it('rechaza elementos fuera del compositor', () => {
    document.body.innerHTML = '<div id="t">barra lateral</div>';
    expect(geminiAdapter.isEditor(document.getElementById('t'))).toBe(false);
  });

  it('rechaza null y objetos sin closest', () => {
    expect(geminiAdapter.isEditor(null)).toBe(false);
    expect(geminiAdapter.isEditor({})).toBe(false);
    expect(geminiAdapter.isEditor(document)).toBe(false);
  });
});

describe('geminiAdapter.findFileInput', () => {
  it('devuelve null si no hay ninguno', () => {
    expect(geminiAdapter.findFileInput(document)).toBeNull();
  });

  it('prefiere el input que acepta texto sobre el de solo imágenes', () => {
    document.body.innerHTML = `
      <input type="file" id="img" accept="image/*">
      <input type="file" id="any" accept="text/plain,.txt">`;
    expect(geminiAdapter.findFileInput(document).id).toBe('any');
  });

  it('acepta el input sin atributo accept', () => {
    document.body.innerHTML = `
      <input type="file" id="img" accept="image/png">
      <input type="file" id="libre">`;
    expect(geminiAdapter.findFileInput(document).id).toBe('libre');
  });

  it('descarta el input de solo imágenes', () => {
    document.body.innerHTML = '<input type="file" id="img" accept="image/*"><input type="file" id="txt" accept=".txt">';
    expect(geminiAdapter.findFileInput(document).id).toBe('txt');
  });

  it('cae al primero si ninguno encaja', () => {
    document.body.innerHTML = `
      <input type="file" id="a" accept="image/png">
      <input type="file" id="b" accept="video/mp4">`;
    expect(geminiAdapter.findFileInput(document).id).toBe('a');
  });
});

describe('geminiAdapter.ensureFileInput', () => {
  it('devuelve el input existente sin tocar nada', async () => {
    document.body.innerHTML = '<input type="file" id="ya">';
    const input = await geminiAdapter.ensureFileInput({ doc: document });
    expect(input.id).toBe('ya');
  });

  it('clica el botón de adjuntar y espera a que el input aparezca', async () => {
    document.body.innerHTML = '<button aria-label="Añadir archivos">+</button>';
    const button = document.querySelector('button');
    button.addEventListener('click', () => {
      setTimeout(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.id = 'tardio';
        document.body.appendChild(input);
      }, 30);
    });

    const input = await geminiAdapter.ensureFileInput({ doc: document, timeout: 1000, step: 10 });
    expect(input.id).toBe('tardio');
  });

  it('cliquea el item "Archivos" del menú para forzar el input', async () => {
    document.body.innerHTML = `
      <button aria-label="Cargas y herramientas">+</button>
      <div role="menu"><div role="menuitem" aria-label="Subir archivos. Archivos de código">Subir</div></div>`;
    const opener = document.querySelector('button');
    const item = document.querySelector('[role="menuitem"]');
    let opened = false, itemClicked = false;
    opener.addEventListener('click', () => { opened = true; });
    item.addEventListener('click', () => {
      itemClicked = true;
      setTimeout(() => {
        const input = document.createElement('input');
        input.type = 'file';
        document.body.appendChild(input);
      }, 5);
    });
    const input = await geminiAdapter.ensureFileInput({ doc: document, timeout: 200, step: 5 });
    expect(opened).toBe(true);
    expect(itemClicked).toBe(true);
    expect(input).not.toBeNull();
  });

  it('devuelve null (sin colgarse) si el input nunca aparece', async () => {
    document.body.innerHTML = '<button aria-label="cargas y herramientas">+</button>';
    const input = await geminiAdapter.ensureFileInput({ doc: document, timeout: 40, step: 10 });
    expect(input).toBeNull();
  });
});

describe('geminiAdapter.attach', () => {
  it('inyecta el archivo en el input cuando lo encuentra', async () => {
    document.body.innerHTML = '<input type="file">';
    const changes = vi.fn();
    document.querySelector('input').addEventListener('change', changes);

    expect(await geminiAdapter.attach(file(), { doc: document })).toBe('input');
    expect(document.querySelector('input').files[0].name).toBe('pegado.txt');
    expect(changes).toHaveBeenCalledOnce();
  });

  it('cae a drag&drop sobre el compositor si no hay input', async () => {
    document.body.innerHTML = '<div contenteditable="true" id="editor"></div>';
    const drops = vi.fn();
    document.getElementById('editor').addEventListener('drop', drops);

    expect(await geminiAdapter.attach(file(), { doc: document, timeout: 30 })).toBe('drop');
    expect(drops).toHaveBeenCalledOnce();
    expect(drops.mock.calls[0][0].dataTransfer.files[0].name).toBe('pegado.txt');
  });

  it('como último recurso suelta el archivo en el body', async () => {
    const drops = vi.fn();
    document.body.addEventListener('drop', drops);
    expect(await geminiAdapter.attach(file(), { doc: document, timeout: 30 })).toBe('drop');
    expect(drops).toHaveBeenCalledOnce();
  });
});

describe('geminiAdapter.insertText', () => {
  it('sube al .ql-editor aunque el target sea un nodo interno', () => {
    document.body.innerHTML = '<div class="ql-editor" contenteditable="true"><p id="t"></p></div>';
    document.execCommand = vi.fn(() => false);

    geminiAdapter.insertText(document.getElementById('t'), 'RESUMEN');

    expect(document.querySelector('.ql-editor').textContent).toContain('RESUMEN');
  });
});

describe('sandboxAdapter', () => {
  it('solo se activa con data-nocrash-test', () => {
    expect(sandboxAdapter.matches()).toBe(false);
    document.documentElement.setAttribute('data-nocrash-test', '');
    expect(sandboxAdapter.matches()).toBe(true);
  });

  it('reconoce el editor del banco de pruebas', () => {
    document.body.innerHTML = '<div contenteditable="true"><span id="t"></span></div>';
    expect(sandboxAdapter.isEditor(document.getElementById('t'))).toBe(true);
    expect(sandboxAdapter.isEditor(null)).toBe(false);
  });

  it('adjunta en el input del sandbox y devuelve false si no existe', () => {
    expect(sandboxAdapter.attach(file(), { doc: document })).toBe(false);
    document.body.innerHTML = '<input type="file">';
    expect(sandboxAdapter.attach(file(), { doc: document })).toBe(true);
  });
});
