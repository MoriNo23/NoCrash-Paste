import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../../src/config.js';
import { SETTING_ROWS, createSettingsPanel, createToaster, readSettingsForm } from '../../src/ui.js';

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('createToaster', () => {
  it('muestra el mensaje y lo retira solo', () => {
    vi.useFakeTimers();
    const toast = createToaster(document);
    const el = toast('Pegado convertido en adjunto');

    expect(document.body.contains(el)).toBe(true);
    expect(el.textContent).toBe('Pegado convertido en adjunto');

    vi.advanceTimersByTime(4200 + 250 + 10);
    expect(document.body.contains(el)).toBe(false);
  });

  it('usa color de aviso para kind="warn"', () => {
    const toast = createToaster(document);
    expect(toast('ojo', 'warn').style.background).toContain('146'); // #92400e
    expect(toast('ok').style.background).not.toContain('146');
  });

  it('no intercepta clics del usuario', () => {
    expect(createToaster(document)('x').style.pointerEvents).toBe('none');
  });
});

describe('readSettingsForm', () => {
  it('lee números y booleanos con el tipo correcto', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <input data-key="maxChars" type="number" value="1234">
      <input data-key="notify" type="checkbox">
      <input data-key="debug" type="checkbox" checked>
      <input type="text" value="ignorame">`;
    expect(readSettingsForm(root)).toEqual({ maxChars: 1234, notify: false, debug: true });
  });
});

describe('createSettingsPanel', () => {
  const open = (overrides = {}) =>
    createSettingsPanel({ config: { ...DEFAULTS }, doc: document, ...overrides })();

  it('pinta una fila por ajuste con el valor actual', () => {
    const panel = open({ config: { ...DEFAULTS, maxChars: 777, notify: false } });
    expect(panel.querySelectorAll('input[data-key]')).toHaveLength(SETTING_ROWS.length);
    expect(panel.querySelector('[data-key="maxChars"]').value).toBe('777');
    expect(panel.querySelector('[data-key="notify"]').checked).toBe(false);
  });

  it('no abre dos paneles a la vez', () => {
    const openPanel = createSettingsPanel({ config: { ...DEFAULTS }, doc: document });
    openPanel();
    expect(openPanel()).toBeNull();
    expect(document.querySelectorAll('#nocrash-settings')).toHaveLength(1);
  });

  it('guardar emite los valores del formulario y cierra', () => {
    const onSave = vi.fn();
    const panel = open({ onSave });
    panel.querySelector('[data-key="maxChars"]').value = '999';
    panel.querySelector('[data-key="debug"]').checked = true;

    panel.querySelector('[data-action="save"]').click();

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ maxChars: 999, debug: true }));
    expect(document.getElementById('nocrash-settings')).toBeNull();
  });

  it('restaurar emite los defaults y cierra', () => {
    const onReset = vi.fn();
    open({ onReset }).querySelector('[data-action="reset"]').click();
    expect(onReset).toHaveBeenCalledWith({ ...DEFAULTS });
    expect(document.getElementById('nocrash-settings')).toBeNull();
  });

  it('cerrar no guarda nada', () => {
    const onSave = vi.fn();
    open({ onSave }).querySelector('[data-action="close"]').click();
    expect(onSave).not.toHaveBeenCalled();
    expect(document.getElementById('nocrash-settings')).toBeNull();
  });

  it('clicar el fondo cierra, clicar el diálogo no', () => {
    const panel = open();
    panel.querySelector('h2').click();
    expect(document.getElementById('nocrash-settings')).not.toBeNull();
    panel.click();
    expect(document.getElementById('nocrash-settings')).toBeNull();
  });

  it('funciona sin callbacks inyectados', () => {
    const panel = open({ onSave: undefined, onReset: undefined });
    expect(() => panel.querySelector('[data-action="save"]').click()).not.toThrow();
  });
});
