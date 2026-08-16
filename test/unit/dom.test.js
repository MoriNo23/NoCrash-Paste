import { beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadFile, dropFileOn, insertTextInto, makeFile, setInputFile, sleep } from '../../src/dom.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('makeFile', () => {
  it('crea un File .txt con el nombre dado', () => {
    const file = makeFile('hola mundo', 'pegado.txt');
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('pegado.txt');
    expect(file.type).toBe('text/plain');
    expect(file.size).toBe(10);
  });

  it('conserva el contenido íntegro', async () => {
    const text = 'línea1\nlínea2\n'.repeat(1000);
    expect(await makeFile(text, 'x.txt').text()).toBe(text);
  });
});

describe('setInputFile', () => {
  it('mete el File en el input y dispara input + change', () => {
    const input = document.createElement('input');
    input.type = 'file';
    document.body.appendChild(input);
    const events = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));

    const ok = setInputFile(input, makeFile('abc', 'a.txt'));

    expect(ok).toBe(true);
    expect(input.files).toHaveLength(1);
    expect(input.files[0].name).toBe('a.txt');
    expect(events).toEqual(['input', 'change']);
  });

  it('los eventos burbujean (los frameworks escuchan arriba)', () => {
    const wrapper = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'file';
    wrapper.appendChild(input);
    document.body.appendChild(wrapper);
    const spy = vi.fn();
    wrapper.addEventListener('change', spy);

    setInputFile(input, makeFile('abc', 'a.txt'));
    expect(spy).toHaveBeenCalledOnce();
  });

  it('devuelve false si no hay input', () => {
    expect(setInputFile(null, makeFile('a', 'a.txt'))).toBe(false);
  });
});

describe('dropFileOn', () => {
  it('emite dragenter, dragover y drop con el archivo', () => {
    const zone = document.createElement('div');
    document.body.appendChild(zone);
    const seen = [];
    for (const type of ['dragenter', 'dragover', 'drop']) {
      zone.addEventListener(type, (e) => seen.push([type, e.dataTransfer.files[0]?.name]));
    }

    expect(dropFileOn(zone, makeFile('x', 'drop.txt'))).toBe(true);
    expect(seen).toEqual([
      ['dragenter', 'drop.txt'],
      ['dragover', 'drop.txt'],
      ['drop', 'drop.txt'],
    ]);
  });

  it('los eventos son cancelables (si no, el navegador abre el archivo)', () => {
    const zone = document.createElement('div');
    document.body.appendChild(zone);
    let cancelable = null;
    zone.addEventListener('drop', (e) => { cancelable = e.cancelable; });
    dropFileOn(zone, makeFile('x', 'd.txt'));
    expect(cancelable).toBe(true);
  });

  it('devuelve false sin zona', () => {
    expect(dropFileOn(null, makeFile('x', 'd.txt'))).toBe(false);
  });
});

describe('insertTextInto', () => {
  it('inserta en un textarea respetando la posición del cursor', () => {
    const ta = document.createElement('textarea');
    ta.value = 'HOLA MUNDO';
    document.body.appendChild(ta);
    ta.selectionStart = 4;
    ta.selectionEnd = 4;

    insertTextInto(ta, ' [X]');

    expect(ta.value).toBe('HOLA [X] MUNDO');
    expect(ta.selectionStart).toBe(8);
  });

  it('reemplaza la selección en un textarea', () => {
    const ta = document.createElement('textarea');
    ta.value = 'borra esto ya';
    document.body.appendChild(ta);
    ta.selectionStart = 6;
    ta.selectionEnd = 10;
    insertTextInto(ta, 'ESO');
    expect(ta.value).toBe('borra ESO ya');
  });

  it('dispara input en el textarea', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    const spy = vi.fn();
    ta.addEventListener('input', spy);
    insertTextInto(ta, 'hey');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('usa execCommand("insertText") en contenteditable si está disponible', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
    const exec = vi.fn(() => true);
    document.execCommand = exec;

    insertTextInto(editor, 'placeholder');

    expect(exec).toHaveBeenCalledWith('insertText', false, 'placeholder');
  });

  it('cae al fallback y notifica con InputEvent si execCommand falla', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
    document.execCommand = vi.fn(() => false);
    const spy = vi.fn();
    editor.addEventListener('input', spy);

    insertTextInto(editor, 'texto de respaldo');

    expect(editor.textContent).toContain('texto de respaldo');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].inputType).toBe('insertText');
  });

  it('cae al fallback si execCommand lanza', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
    document.execCommand = vi.fn(() => { throw new Error('no soportado'); });

    expect(() => insertTextInto(editor, 'x')).not.toThrow();
    expect(editor.textContent).toBe('x');
  });

  it('devuelve false sin elemento', () => {
    expect(insertTextInto(null, 'x')).toBe(false);
  });
});

describe('downloadFile', () => {
  it('crea un enlace temporal, lo clica y lo quita del DOM', () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const clicks = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreate(tag);
      if (tag === 'a') el.click = () => clicks.push(el.download);
      return el;
    });

    downloadFile(makeFile('contenido', 'salvado.txt'));

    expect(createSpy).toHaveBeenCalled();
    expect(clicks).toEqual(['salvado.txt']);
    expect(document.querySelector('a')).toBeNull();
    vi.restoreAllMocks();
  });

  it('libera el objectURL pasado un rato', () => {
    vi.useFakeTimers();
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    downloadFile(makeFile('a', 'a.txt'));
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10000);
    expect(revoke).toHaveBeenCalledWith('blob:mock');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});

describe('sleep', () => {
  it('resuelve tras el tiempo indicado', async () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    sleep(50).then(spy);
    await vi.advanceTimersByTimeAsync(49);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
