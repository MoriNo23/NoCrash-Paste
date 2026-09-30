import { vi } from 'vitest';

/** Evento de paste falso, con el mismo contrato que el real. */
export function makePasteEvent({ text = '', files = [], target = null, composed = true } = {}) {
  const event = {
    clipboardData: {
      files,
      getData: vi.fn((type) => (type === 'text/plain' ? text : '')),
    },
    target,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };
  if (composed) event.composedPath = () => [target];
  return event;
}

/** Adaptador espía: registra lo que recibe y permite forzar fallos. */
export function makeFakeAdapter(overrides = {}) {
  return {
    id: 'fake',
    matches: () => true,
    isEditor: vi.fn(() => true),
    attach: vi.fn(async () => 'input'),
    insertText: vi.fn(() => true),
    ...overrides,
  };
}

/** Dependencias por defecto para createPasteHandler, todas espiadas. */
export function makeDeps(overrides = {}) {
  const adapter = overrides.adapter ?? makeFakeAdapter();
  return {
    adapter,
    makeFile: vi.fn((text, name) => ({ name, size: text.length, text })),
    downloadFile: vi.fn(),
    notify: vi.fn(),
    sleep: vi.fn(async () => {}),
    now: () => new Date(2026, 7, 15, 9, 5, 3),
    log: vi.fn(),
    ...overrides,
    adapter,
  };
}

export const bigCode = (lines = 4000) =>
  Array.from({ length: lines }, (_, i) => `export const value${i} = compute(${i});`).join('\n');
