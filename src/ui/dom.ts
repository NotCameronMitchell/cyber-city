// ─────────────────────────────────────────────────────────────────────────────
// Tiny DOM toolkit: element builder + write-if-changed helpers. Every per-frame
// or 5 Hz update goes through setText / setClass / setStyle so unchanged values
// never touch the DOM (no style recalc, no layout).
// ─────────────────────────────────────────────────────────────────────────────

export type Attrs = Record<string, string | number | boolean | null | undefined>;
export type Child = Node | string | null | undefined | false;

/**
 * Create an element. Attribute keys: `class`, `html` (trusted innerHTML, used
 * for our own inline SVG icons), `text`, anything else → setAttribute
 * (`true` → empty attribute, false/null/undefined → skipped).
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const key in attrs) {
      const v = attrs[key];
      if (v === undefined || v === null || v === false) continue;
      if (key === 'class') el.className = String(v);
      else if (key === 'html') el.innerHTML = String(v);
      else if (key === 'text') el.textContent = String(v);
      else el.setAttribute(key, v === true ? '' : String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

const textCache = new WeakMap<Node, string>();
/** Write textContent only when it differs from what we last wrote. */
export function setText(el: Element, text: string): void {
  if (textCache.get(el) === text) return;
  textCache.set(el, text);
  el.textContent = text;
}

const htmlCache = new WeakMap<Node, string>();
/** Write innerHTML only when it changed (for icon swaps). */
export function setHtml(el: Element, html: string): void {
  if (htmlCache.get(el) === html) return;
  htmlCache.set(el, html);
  el.innerHTML = html;
}

/** Toggle a class only when its state actually changes. */
export function setClass(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

const styleCache = new WeakMap<Node, Map<string, string>>();
/** Set a style property / custom property only when its value changed. */
export function setStyle(el: HTMLElement | SVGElement, prop: string, value: string): void {
  let m = styleCache.get(el);
  if (!m) {
    m = new Map();
    styleCache.set(el, m);
  }
  if (m.get(prop) === value) return;
  m.set(prop, value);
  el.style.setProperty(prop, value);
}

const attrCache = new WeakMap<Node, Map<string, string>>();
export function setAttr(el: Element, name: string, value: string): void {
  let m = attrCache.get(el);
  if (!m) {
    m = new Map();
    attrCache.set(el, m);
  }
  if (m.get(name) === value) return;
  m.set(name, value);
  el.setAttribute(name, value);
}

/** Show/hide via the `hidden` attribute (diffed). */
export function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

/** Restart a CSS animation class (forces one style flush; use for rare events only). */
export function replayClass(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** Closest ancestor (inclusive) carrying `data-<name>`, stopping at `root`. */
export function closestData(target: EventTarget | null, name: string, root: Element): HTMLElement | null {
  let el = target as HTMLElement | null;
  const attr = `data-${name}`;
  while (el && el !== root.parentElement) {
    if (el.nodeType === 1 && el.hasAttribute(attr)) return el;
    if (el === root) break;
    el = el.parentElement;
  }
  return null;
}

/** Escape text for the rare places we compose HTML strings. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Short haptic tap where supported (Android); silently ignored elsewhere. */
export function buzz(ms = 8): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(ms);
  } catch {
    /* blocked by permissions policy — optional */
  }
}
