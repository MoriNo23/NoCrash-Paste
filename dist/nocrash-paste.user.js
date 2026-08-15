// ==UserScript==
// @name         NoCrash Paste
// @namespace    https://github.com/MoriNo23/NoCrash-Paste
// @version      0.1.0
// @description  Evita que el navegador se congele al pegar codebases enormes en agentes web: convierte el pegado en un adjunto .txt y deja un resumen legible en el editor.
// @author       MoriNo23
// @match        https://gemini.google.com/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// ==/UserScript==

(() => {
  // src/dom.js
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function makeFile(text, fileName) {
    return new File([text], fileName, { type: "text/plain" });
  }
  function setInputFile(input, file) {
    if (!input) return false;
    const dt = new DataTransfer();
    dt.items.add(file);
    try {
      input.files = dt.files;
    } catch {
      Object.defineProperty(input, "files", { value: dt.files, configurable: true, writable: true });
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  function dropFileOn(zone, file) {
    if (!zone) return false;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const options = { bubbles: true, cancelable: true, composed: true, dataTransfer };
    for (const type of ["dragenter", "dragover", "drop"]) {
      zone.dispatchEvent(new DragEvent(type, options));
    }
    return true;
  }
  function insertTextInto(element, text) {
    if (!element) return false;
    if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
      const start = element.selectionStart ?? element.value.length;
      const end = element.selectionEnd ?? element.value.length;
      element.value = element.value.slice(0, start) + text + element.value.slice(end);
      element.selectionStart = element.selectionEnd = start + text.length;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    element.focus?.();
    let handled = false;
    try {
      handled = !!(typeof document.execCommand === "function" && document.execCommand("insertText", false, text));
    } catch {
      handled = false;
    }
    if (!handled) {
      const selection = typeof window.getSelection === "function" ? window.getSelection() : null;
      if (selection && selection.rangeCount && element.contains(selection.anchorNode)) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
      } else {
        element.textContent += text;
      }
      element.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
      );
    }
    return true;
  }
  function downloadFile(file) {
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1e4);
    return url;
  }

  // src/adapters/gemini.js
  var OPENER_SELECTOR = [
    'button[aria-label*="adjunt" i]',
    'button[aria-label*="attach" i]',
    'button[aria-label*="añadir archivo" i]',
    'button[aria-label*="add file" i]',
    "uploader-button button"
  ].join(",");
  var EDITOR_SELECTOR = 'rich-textarea, .ql-editor, [contenteditable="true"]';
  var DEFAULT_TIMEOUT_MS = 2500;
  var POLL_STEP_MS = 100;
  var TEXT_ACCEPTS = ["*/*", "text/*", "text/plain", ".txt"];
  function acceptsText(accept) {
    if (!accept) return true;
    return accept.split(",").map((token) => token.trim().toLowerCase()).some((token) => TEXT_ACCEPTS.includes(token));
  }
  var geminiAdapter = {
    id: "gemini",
    matches: () => globalThis.location?.hostname === "gemini.google.com",
    isEditor(element) {
      if (!element || typeof element.closest !== "function") return false;
      return !!element.closest(EDITOR_SELECTOR) || element.matches?.("textarea");
    },
    /** Gemini expone varios input[type=file]; queremos el que acepte texto. */
    findFileInput(doc = document) {
      const inputs = [...doc.querySelectorAll('input[type="file"]')];
      return inputs.find((input) => acceptsText(input.accept)) || inputs[0] || null;
    },
    /** Si el input aún no está montado, abrimos el menú "+" para forzarlo. */
    async ensureFileInput({ doc = document, timeout = DEFAULT_TIMEOUT_MS, step = POLL_STEP_MS } = {}) {
      let input = this.findFileInput(doc);
      if (input) return input;
      const opener = doc.querySelector(OPENER_SELECTOR);
      if (opener) opener.click();
      const deadline = Date.now() + timeout;
      while (!input && Date.now() < deadline) {
        await sleep(step);
        input = this.findFileInput(doc);
      }
      if (opener) {
        doc.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      }
      return input;
    },
    async attach(file, { doc = document, timeout = DEFAULT_TIMEOUT_MS } = {}) {
      const input = await this.ensureFileInput({ doc, timeout });
      if (input) return setInputFile(input, file);
      const zone = doc.querySelector(EDITOR_SELECTOR) || doc.body;
      return dropFileOn(zone, file);
    },
    insertText(element, text) {
      const editor = element.closest?.('.ql-editor, [contenteditable="true"]') || element;
      return insertTextInto(editor, text);
    }
  };

  // src/adapters/sandbox.js
  var sandboxAdapter = {
    id: "sandbox",
    matches: () => document.documentElement.hasAttribute("data-nocrash-test"),
    isEditor(element) {
      if (!element || typeof element.closest !== "function") return false;
      return !!element.closest('[contenteditable="true"]') || element.matches?.("textarea");
    },
    attach(file, { doc = document } = {}) {
      return setInputFile(doc.querySelector('input[type="file"]'), file);
    },
    insertText(element, text) {
      return insertTextInto(element.closest?.('[contenteditable="true"]') || element, text);
    }
  };

  // src/config.js
  var DEFAULTS = Object.freeze({
    maxChars: 2e4,
    maxLines: 1500,
    maxBytes: 2e5,
    placeholder: true,
    includePreview: true,
    previewLines: 12,
    notify: true,
    debug: false
  });
  var STORE_KEY = "nocrash-paste:config";
  var NUMERIC_KEYS = ["maxChars", "maxLines", "maxBytes", "previewLines"];
  var BOOLEAN_KEYS = ["placeholder", "includePreview", "notify", "debug"];
  function createStore(env = {}) {
    const { getValue, setValue, storage } = env;
    let memory = null;
    return {
      read() {
        let raw = null;
        try {
          if (typeof getValue === "function") raw = getValue(STORE_KEY, null);
          else if (storage) raw = storage.getItem(STORE_KEY);
          else raw = memory;
        } catch {
          raw = memory;
        }
        if (!raw) return {};
        try {
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch {
          return {};
        }
      },
      write(obj) {
        const raw = JSON.stringify(obj ?? {});
        memory = raw;
        try {
          if (typeof setValue === "function") setValue(STORE_KEY, raw);
          else if (storage) storage.setItem(STORE_KEY, raw);
        } catch {
        }
        return raw;
      },
      clear() {
        memory = null;
        try {
          if (typeof setValue === "function") setValue(STORE_KEY, null);
          else if (storage) storage.removeItem(STORE_KEY);
        } catch {
        }
      }
    };
  }
  function normalizeConfig(partial = {}) {
    const out = { ...DEFAULTS };
    if (!partial || typeof partial !== "object") return out;
    for (const key of NUMERIC_KEYS) {
      const raw = partial[key];
      if (typeof raw !== "number" && typeof raw !== "string") continue;
      if (typeof raw === "string" && raw.trim() === "") continue;
      const value = Number(raw);
      if (Number.isFinite(value) && value >= 0) out[key] = Math.floor(value);
    }
    for (const key of BOOLEAN_KEYS) {
      if (typeof partial[key] === "boolean") out[key] = partial[key];
    }
    return out;
  }
  function loadConfig(store) {
    return normalizeConfig(store.read());
  }

  // src/analyze.js
  function byteLength(text) {
    if (!text) return 0;
    if (typeof TextEncoder === "function") return new TextEncoder().encode(text).length;
    return Buffer.byteLength(text, "utf8");
  }
  function countLines(text) {
    if (!text) return 0;
    let lines = 1;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) lines++;
    }
    return lines;
  }
  function measure(text) {
    const value = text || "";
    return { chars: value.length, lines: countLines(value), bytes: byteLength(value) };
  }
  var formatNumber = (n) => Number(n).toLocaleString("es-ES");
  function humanSize(bytes) {
    const b = Number(bytes) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  }
  function exceedsLimits(metrics, config) {
    const hits = [];
    if (metrics.chars > config.maxChars) hits.push(`${formatNumber(metrics.chars)} caracteres`);
    if (metrics.lines > config.maxLines) hits.push(`${formatNumber(metrics.lines)} líneas`);
    if (metrics.bytes > config.maxBytes) hits.push(humanSize(metrics.bytes));
    return hits;
  }
  var SIGNATURES = [
    [/^\s*(?:#!\/bin\/(?:ba|z)?sh|#!\/usr\/bin\/env\s+(?:ba|z)?sh)/m, "shell", "sh"],
    [/<\?php|\$this->|namespace\s+\w+\\/m, "php", "php"],
    [/^\s*(?:def\s+\w+\s*\(|class\s+\w+(?:\(.*\))?\s*:|from\s+[\w.]+\s+import\b|import\s+\w+$)/m, "python", "py"],
    [/^\s*(?:package\s+[\w.]+;|public\s+(?:static\s+)?(?:final\s+)?class\s+\w+|@Override)/m, "java", "java"],
    [/#include\s*[<"]|std::\w+|int\s+main\s*\(/m, "cpp", "cpp"],
    [/^\s*(?:fn\s+\w+|pub\s+fn\s+\w+|impl\s+\w+|use\s+\w+::)/m, "rust", "rs"],
    [/^\s*(?:func\s+\w+|package\s+main\b)|:=\s|fmt\.Print/m, "go", "go"],
    [/(?:^|\s)(?:interface|type)\s+\w+\s*(?:=|\{)|:\s*(?:string|number|boolean)\b/m, "typescript", "ts"],
    [/^\s*(?:const|let|var|function|export|import|async function)\b|=>\s*[{(]/m, "javascript", "js"],
    [/^\s*(?:SELECT|INSERT\s+INTO|UPDATE|CREATE\s+TABLE|ALTER\s+TABLE)\b/im, "sql", "sql"],
    [/^\s*<(?:!DOCTYPE|html|head|body|div|section)\b/im, "html", "html"],
    [/^\s*[.#]?[\w-]+\s*\{[^{}]*[\w-]+\s*:[^{}]*;/m, "css", "css"],
    [/^\s*\{[\s\S]{0,400}?"[\w-]+"\s*:/m, "json", "json"],
    [/^---\s*$/m, "yaml", "yaml"],
    [/^#{1,6}\s+\S|^```/m, "markdown", "md"]
  ];
  var FALLBACK_LANGUAGE = Object.freeze({ name: "texto", ext: "txt" });
  function detectLanguage(text, sampleSize = 4e3) {
    const head = (text || "").slice(0, sampleSize);
    if (!head.trim()) return { ...FALLBACK_LANGUAGE };
    for (const [pattern, name, ext] of SIGNATURES) {
      if (pattern.test(head)) return { name, ext };
    }
    return { ...FALLBACK_LANGUAGE };
  }
  var pad = (n) => String(n).padStart(2, "0");
  function buildFileName(language, date = /* @__PURE__ */ new Date()) {
    const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    const name = String(language?.name || FALLBACK_LANGUAGE.name).replace(/[^\w-]+/g, "-");
    return `pegado-${name}-${stamp}.txt`;
  }
  var MAX_PREVIEW_CHARS = 1200;
  var TRUNCATION_MARK = "\n… (recortado)";
  function previewOf(text, lines, maxChars = MAX_PREVIEW_CHARS) {
    const limit = Math.max(0, Number(lines) || 0);
    if (limit === 0) return "";
    const head = (text || "").split("\n").slice(0, limit).join("\n");
    if (head.length <= maxChars) return head;
    return head.slice(0, maxChars) + TRUNCATION_MARK;
  }
  function buildPlaceholder({ fileName, metrics, language, text, config }) {
    const parts = [
      `[Adjunto: ${fileName} · ${language.name} · ${formatNumber(metrics.lines)} líneas · ${humanSize(metrics.bytes)}]`
    ];
    const preview = config.includePreview ? previewOf(text, config.previewLines) : "";
    if (preview) {
      const shown = Math.min(config.previewLines, metrics.lines);
      parts.push("", `Primeras ${formatNumber(shown)} líneas:`, "```", preview, "```");
    }
    parts.push("", "El contenido completo está en el archivo adjunto.");
    return parts.join("\n");
  }

  // src/handler.js
  var SKIP = Object.freeze({
    NO_CLIPBOARD: "no-clipboard-data",
    HAS_FILES: "clipboard-has-files",
    NO_TEXT: "no-text",
    NOT_EDITOR: "not-editor",
    UNDER_LIMITS: "under-limits"
  });
  var RESULT = Object.freeze({
    ATTACHED: "attached",
    FALLBACK_DOWNLOAD: "fallback-download"
  });
  function targetOf(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : null;
    return path && path[0] || event.target;
  }
  function createPasteHandler(deps) {
    const {
      adapter,
      config,
      makeFile: makeFile2,
      downloadFile: downloadFile2,
      // Defaults no-op: sus mutantes son equivalentes (no-op -> no-op).
      // Stryker disable next-line ArrowFunction
      notify = () => {
      },
      // Stryker disable next-line ArrowFunction
      sleep: sleep2 = () => Promise.resolve(),
      now = () => /* @__PURE__ */ new Date(),
      // Stryker disable next-line ArrowFunction
      log = () => {
      },
      settleDelay = 120
    } = deps;
    return async function onPaste(event) {
      const clipboard = event.clipboardData;
      if (!clipboard) return { skipped: SKIP.NO_CLIPBOARD };
      if (clipboard.files && clipboard.files.length > 0) return { skipped: SKIP.HAS_FILES };
      const text = clipboard.getData("text/plain");
      if (!text) return { skipped: SKIP.NO_TEXT };
      const target = targetOf(event);
      if (!adapter.isEditor(target)) return { skipped: SKIP.NOT_EDITOR };
      const metrics = measure(text);
      const hits = exceedsLimits(metrics, config);
      if (hits.length === 0) return { skipped: SKIP.UNDER_LIMITS, metrics };
      event.preventDefault();
      event.stopImmediatePropagation?.();
      log("interceptado", hits);
      const language = detectLanguage(text);
      const fileName = buildFileName(language, now());
      const file = makeFile2(text, fileName);
      let attached = false;
      try {
        attached = !!await adapter.attach(file);
      } catch (error) {
        log("fallo al adjuntar", error);
        attached = false;
      }
      if (!attached) {
        downloadFile2(file);
        notify(`No pude adjuntarlo automáticamente. Te lo descargué como ${fileName}: súbelo a mano.`, "warn");
        return { result: RESULT.FALLBACK_DOWNLOAD, fileName, metrics, language, hits };
      }
      if (config.placeholder) {
        await sleep2(settleDelay);
        adapter.insertText(target, buildPlaceholder({ fileName, metrics, language, text, config }));
      }
      if (config.notify) {
        notify(`Pegado convertido en adjunto · ${hits.join(" · ")}`, "ok");
      }
      return { result: RESULT.ATTACHED, fileName, metrics, language, hits };
    };
  }

  // src/ui.js
  var Z = 2147483647;
  function createToaster(doc = document) {
    return function toast(message, kind = "ok", ttl = 4200) {
      const el = doc.createElement("div");
      el.className = "nocrash-toast";
      el.textContent = message;
      Object.assign(el.style, {
        position: "fixed",
        zIndex: String(Z),
        bottom: "24px",
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: "520px",
        padding: "12px 18px",
        borderRadius: "10px",
        font: "13px/1.45 system-ui, sans-serif",
        color: "#fff",
        background: kind === "warn" ? "#92400e" : "#1f2937",
        boxShadow: "0 8px 28px rgba(0,0,0,.35)",
        opacity: "0",
        transition: "opacity .18s ease",
        pointerEvents: "none"
      });
      doc.body.appendChild(el);
      requestAnimationFrame(() => {
        el.style.opacity = "1";
      });
      setTimeout(() => {
        el.style.opacity = "0";
        setTimeout(() => el.remove(), 250);
      }, ttl);
      return el;
    };
  }
  var SETTING_ROWS = [
    ["maxChars", "Máx. caracteres", "number"],
    ["maxLines", "Máx. líneas", "number"],
    ["maxBytes", "Máx. bytes", "number"],
    ["previewLines", "Líneas de preview", "number"],
    ["placeholder", "Dejar resumen en el editor", "checkbox"],
    ["includePreview", "Incluir preview del código", "checkbox"],
    ["notify", "Mostrar aviso", "checkbox"],
    ["debug", "Log de depuración", "checkbox"]
  ];
  function readSettingsForm(root) {
    const values = {};
    root.querySelectorAll("input[data-key]").forEach((input) => {
      values[input.dataset.key] = input.type === "checkbox" ? input.checked : Number(input.value);
    });
    return values;
  }
  function createSettingsPanel({ config, onSave, onReset, doc = document }) {
    return function open() {
      if (doc.getElementById("nocrash-settings")) return null;
      const backdrop = doc.createElement("div");
      backdrop.id = "nocrash-settings";
      Object.assign(backdrop.style, {
        position: "fixed",
        inset: "0",
        zIndex: String(Z),
        background: "rgba(0,0,0,.55)",
        display: "grid",
        placeItems: "center",
        font: "14px/1.5 system-ui, sans-serif"
      });
      backdrop.innerHTML = `
      <div style="background:#111827;color:#e5e7eb;border-radius:14px;padding:22px 24px;width:380px;box-shadow:0 20px 60px rgba(0,0,0,.5)">
        <h2 style="margin:0 0 4px;font-size:16px">NoCrash Paste</h2>
        <p style="margin:0 0 16px;font-size:12px;color:#9ca3af">Se intercepta el pegado si supera <b>cualquiera</b> de los límites.</p>
        <div data-rows style="display:grid;gap:10px"></div>
        <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end">
          <button data-action="reset" style="padding:7px 12px;border-radius:8px;border:1px solid #374151;background:transparent;color:#9ca3af;cursor:pointer">Restaurar</button>
          <button data-action="close" style="padding:7px 12px;border-radius:8px;border:1px solid #374151;background:transparent;color:#e5e7eb;cursor:pointer">Cerrar</button>
          <button data-action="save" style="padding:7px 14px;border-radius:8px;border:0;background:#7c5cff;color:#fff;cursor:pointer">Guardar</button>
        </div>
      </div>`;
      const rows = backdrop.querySelector("[data-rows]");
      for (const [key, label, type] of SETTING_ROWS) {
        const row = doc.createElement("label");
        row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px";
        const span = doc.createElement("span");
        span.style.fontSize = "13px";
        span.textContent = label;
        const input = doc.createElement("input");
        input.type = type;
        input.dataset.key = key;
        if (type === "checkbox") {
          input.checked = !!config[key];
        } else {
          input.value = String(config[key]);
          input.style.cssText = "width:120px;padding:5px 8px;border-radius:6px;border:1px solid #374151;background:#0b1120;color:#e5e7eb";
        }
        row.append(span, input);
        rows.appendChild(row);
      }
      backdrop.addEventListener("click", (event) => {
        const action = event.target?.dataset?.action;
        if (event.target === backdrop || action === "close") {
          backdrop.remove();
          return;
        }
        if (action === "reset") {
          onReset?.({ ...DEFAULTS });
          backdrop.remove();
          return;
        }
        if (action === "save") {
          onSave?.(readSettingsForm(backdrop));
          backdrop.remove();
        }
      });
      doc.body.appendChild(backdrop);
      return backdrop;
    };
  }

  // src/main.js
  var ADAPTERS = [sandboxAdapter, geminiAdapter];
  function pickAdapter(adapters = ADAPTERS) {
    return adapters.find((adapter) => {
      try {
        return adapter.matches();
      } catch {
        return false;
      }
    }) || null;
  }
  function bootstrap({ adapters = ADAPTERS, gm = {} } = {}) {
    const adapter = pickAdapter(adapters);
    if (!adapter) return null;
    const store = createStore({
      getValue: gm.getValue,
      setValue: gm.setValue,
      storage: typeof localStorage !== "undefined" ? localStorage : null
    });
    const config = loadConfig(store);
    const log = (...args) => config.debug && console.log("%c[NoCrash]", "color:#7c5cff", ...args);
    const toast = createToaster();
    const handler = createPasteHandler({
      adapter,
      config,
      makeFile,
      downloadFile,
      notify: toast,
      sleep,
      log
    });
    document.addEventListener("paste", handler, true);
    const openSettings = createSettingsPanel({
      config,
      onSave: (values) => {
        Object.assign(config, normalizeConfig({ ...config, ...values }));
        store.write(config);
        toast("Ajustes guardados.");
      },
      onReset: (defaults) => {
        store.clear();
        Object.assign(config, defaults);
        toast("Ajustes restaurados a los valores por defecto.");
      }
    });
    gm.registerMenuCommand?.("⚙️ Ajustes de NoCrash Paste", openSettings);
    window.addEventListener("keydown", (event) => {
      if (event.altKey && event.shiftKey && event.code === "KeyP") {
        event.preventDefault();
        openSettings();
      }
    });
    log("activo", adapter.id, config);
    return { adapter, config, handler, openSettings, store };
  }
  if (typeof document !== "undefined" && !globalThis.__NOCRASH_NO_AUTOSTART__) {
    bootstrap({
      gm: {
        getValue: typeof GM_getValue === "function" ? GM_getValue : void 0,
        setValue: typeof GM_setValue === "function" ? GM_setValue : void 0,
        registerMenuCommand: typeof GM_registerMenuCommand === "function" ? GM_registerMenuCommand : void 0
      }
    });
  }
})();
