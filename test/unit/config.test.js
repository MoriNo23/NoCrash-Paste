import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS, STORE_KEY, createStore, loadConfig, normalizeConfig } from '../../src/config.js';

describe('DEFAULTS', () => {
  it('usa umbrales pensados para equipos de ~4 GB de RAM', () => {
    expect(DEFAULTS.maxChars).toBe(20000);
    expect(DEFAULTS.maxLines).toBe(1500);
    expect(DEFAULTS.maxBytes).toBe(200000);
  });

  it('es inmutable', () => {
    expect(() => {
      'use strict';
      DEFAULTS.maxChars = 1;
    }).toThrow();
  });
});

describe('normalizeConfig', () => {
  it('devuelve los defaults sin entrada', () => {
    expect(normalizeConfig()).toEqual({ ...DEFAULTS });
    expect(normalizeConfig(null)).toEqual({ ...DEFAULTS });
    expect(normalizeConfig('basura')).toEqual({ ...DEFAULTS });
  });

  it('respeta los valores válidos del usuario', () => {
    expect(normalizeConfig({ maxChars: 5000, notify: false }))
      .toMatchObject({ maxChars: 5000, notify: false, maxLines: DEFAULTS.maxLines });
  });

  it('acepta 0 como valor válido (desactiva por saturación inmediata)', () => {
    expect(normalizeConfig({ maxChars: 0 }).maxChars).toBe(0);
  });

  it('descarta números inválidos y se queda con el default', () => {
    for (const bad of [-1, NaN, Infinity, 'hola', null, undefined, {}]) {
      expect(normalizeConfig({ maxChars: bad }).maxChars).toBe(DEFAULTS.maxChars);
    }
  });

  it('trunca decimales', () => {
    expect(normalizeConfig({ previewLines: 12.9 }).previewLines).toBe(12);
  });

  it('acepta strings numéricos (vienen así del input del panel)', () => {
    expect(normalizeConfig({ maxChars: '4200' }).maxChars).toBe(4200);
  });

  it('solo acepta booleanos reales para los flags', () => {
    expect(normalizeConfig({ notify: 'sí' }).notify).toBe(DEFAULTS.notify);
    expect(normalizeConfig({ notify: 0 }).notify).toBe(DEFAULTS.notify);
    expect(normalizeConfig({ notify: false }).notify).toBe(false);
  });

  it('ignora claves desconocidas', () => {
    expect(normalizeConfig({ hackeame: 1 })).not.toHaveProperty('hackeame');
  });
});

describe('createStore', () => {
  let storage;

  beforeEach(() => {
    const map = new Map();
    storage = {
      getItem: vi.fn((k) => (map.has(k) ? map.get(k) : null)),
      setItem: vi.fn((k, v) => map.set(k, v)),
      removeItem: vi.fn((k) => map.delete(k)),
    };
  });

  it('prefiere las APIs GM_* cuando existen', () => {
    const getValue = vi.fn(() => JSON.stringify({ maxChars: 99 }));
    const setValue = vi.fn();
    const store = createStore({ getValue, setValue, storage });

    expect(store.read()).toEqual({ maxChars: 99 });
    store.write({ maxChars: 1 });

    expect(setValue).toHaveBeenCalledWith(STORE_KEY, '{"maxChars":1}');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('cae a localStorage si no hay GM_*', () => {
    const store = createStore({ storage });
    store.write({ maxLines: 7 });
    expect(storage.setItem).toHaveBeenCalledWith(STORE_KEY, '{"maxLines":7}');
    expect(store.read()).toEqual({ maxLines: 7 });
  });

  it('cae a memoria si no hay ningún backend', () => {
    const store = createStore({});
    expect(store.read()).toEqual({});
    store.write({ maxBytes: 5 });
    expect(store.read()).toEqual({ maxBytes: 5 });
  });

  it('sobrevive a un storage que lanza excepción (modo privado)', () => {
    const hostile = {
      getItem: () => { throw new Error('bloqueado'); },
      setItem: () => { throw new Error('bloqueado'); },
      removeItem: () => { throw new Error('bloqueado'); },
    };
    const store = createStore({ storage: hostile });
    expect(() => store.write({ maxChars: 3 })).not.toThrow();
    expect(store.read()).toEqual({ maxChars: 3 }); // sirve la copia en memoria
    expect(() => store.clear()).not.toThrow();
  });

  it('devuelve {} ante JSON corrupto', () => {
    storage.getItem = () => '{esto no es json';
    expect(createStore({ storage }).read()).toEqual({});
  });

  it('rechaza JSON válido pero no-objeto', () => {
    storage.getItem = () => '[1,2,3]';
    expect(createStore({ storage }).read()).toEqual({});
    storage.getItem = () => '42';
    expect(createStore({ storage }).read()).toEqual({});
    storage.getItem = () => 'null';
    expect(createStore({ storage }).read()).toEqual({});
  });

  it('clear borra la clave', () => {
    const store = createStore({ storage });
    store.write({ maxChars: 1 });
    store.clear();
    expect(storage.removeItem).toHaveBeenCalledWith(STORE_KEY);
    expect(store.read()).toEqual({});
  });
});

describe('loadConfig', () => {
  it('mezcla lo persistido sobre los defaults y lo sanea', () => {
    const store = { read: () => ({ maxChars: 1234, notify: 'nope', basura: true }) };
    expect(loadConfig(store)).toEqual({ ...DEFAULTS, maxChars: 1234 });
  });
});
