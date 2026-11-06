'use strict';
/* Reusable UI: modals, toasts, confirm / scope dialogs, the time picker and small popovers. */

const Modals = [];

function openModal({ title, body, footer, className = '', onClose, canDismiss, headExtra } = {}) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const box = h('div', { class: 'modal ' + className, role: 'dialog', 'aria-modal': 'true' });
  const m = { el: box, closed: false, canDismiss, close };
  if (title != null) {
    box.append(h('div', { class: 'modal-h' },
      h('h2', null, title),
      headExtra || null,
      h('button', { class: 'icon-btn', title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => tryClose() }, icon('x'))));
  }
  box.append(h('div', { class: 'modal-b' }, body));
  if (footer) box.append(h('div', { class: 'modal-f' }, footer));
  backdrop.append(box);

  let downOnBackdrop = false;
  backdrop.addEventListener('pointerdown', e => { downOnBackdrop = e.target === backdrop; });
  backdrop.addEventListener('click', e => { if (e.target === backdrop && downOnBackdrop) tryClose(); });

  function tryClose() {
    if (canDismiss && !canDismiss()) {
      box.classList.remove('shake');
      void box.offsetWidth;
      box.classList.add('shake');
      return;
    }
    close();
  }
  function close(result) {
    if (m.closed) return;
    m.closed = true;
    closePopover();
    backdrop.remove();
    const i = Modals.indexOf(m);
    if (i >= 0) Modals.splice(i, 1);
    if (onClose) onClose(result);
  }
  m.tryClose = tryClose;
  document.getElementById('modalRoot').append(backdrop);
  Modals.push(m);
  requestAnimationFrame(() => {
    const f = box.querySelector('[autofocus]') || box.querySelector('input:not([type=checkbox]):not([type=radio]), textarea');
    if (f) { f.focus(); if (f.select && f.value) f.select(); }
  });
  return m;
}

function topModal() { return Modals[Modals.length - 1] || null; }
function closeAllModals() { [...Modals].reverse().forEach(m => m.close()); }

// ── Toasts ──────────────────────────────────────────────────────────────
function toast(text, opts = {}) {
  const root = document.getElementById('toastRoot');
  const el = h('div', { class: 'toast' + (opts.kind ? ' ' + opts.kind : ''), role: 'status' }, h('span', null, text));
  let timer = 0;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.add('out');
    setTimeout(() => el.remove(), 180);
  };
  if (opts.action) el.append(h('button', { onclick: () => { dismiss(); opts.onAction(); } }, opts.action));
  root.append(el);
  timer = setTimeout(dismiss, opts.timeout || 5000);
  while (root.children.length > 3) root.firstElementChild.remove();
  return dismiss;
}

function clearToasts() { document.getElementById('toastRoot').replaceChildren(); }

// ── Dialogs ─────────────────────────────────────────────────────────────
function confirmDialog({ title, text, ok = 'OK', cancel = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    let result = false;
    const m = openModal({
      title,
      className: 'small',
      body: h('p', { class: 'dialog-text' }, text),
      footer: [
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => m.close() }, cancel),
        h('button', { class: 'btn ' + (danger ? 'danger-fill' : 'primary'), autofocus: true, onclick: () => { result = true; m.close(); } }, ok),
      ],
      onClose: () => resolve(result),
    });
  });
}

/** Asks which occurrences of a repeating event a change applies to. Resolves 'one' | 'following' | 'all' | null. */
function scopeDialog({ title = 'Change repeating event', verb = 'Save', allowOne = true } = {}) {
  return new Promise(resolve => {
    const options = [
      allowOne && ['one', 'This event'],
      ['following', 'This and following events'],
      ['all', 'All events'],
    ].filter(Boolean);
    let choice = options[0][0];
    let result = null;
    const body = h('div', { class: 'radio-list' }, options.map(([v, label]) =>
      h('label', { class: 'radio' },
        h('input', { type: 'radio', name: 'scope', value: v, checked: v === choice, onchange: () => { choice = v; } }),
        h('span', null, label))));
    const m = openModal({
      title, className: 'small', body,
      footer: [
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
        h('button', { class: 'btn primary', autofocus: true, onclick: () => { result = choice; m.close(); } }, verb),
      ],
      onClose: () => resolve(result),
    });
  });
}

// ── Popovers (one at a time) ────────────────────────────────────────────
let activePopover = null;

function openPopover(anchor, content, { align = 'start', className = '' } = {}) {
  closePopover();
  const pop = h('div', { class: 'popover ' + className }, content);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = align === 'end' ? r.right - pr.width : r.left;
  let top = r.bottom + 6;
  if (top + pr.height > innerHeight - 8) top = Math.max(8, r.top - pr.height - 6);
  left = clamp(left, 8, innerWidth - pr.width - 8);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  const onDown = e => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closePopover(); };
  setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
  activePopover = { el: pop, cleanup: () => document.removeEventListener('pointerdown', onDown, true) };
  return pop;
}
function closePopover() {
  if (!activePopover) return false;
  activePopover.cleanup();
  activePopover.el.remove();
  activePopover = null;
  return true;
}

function colorPicker(anchor, current, onPick) {
  const grid = h('div', { class: 'swatches' }, CAT_PALETTE.map(c =>
    h('button', {
      class: 'swatch' + (c.toLowerCase() === String(current).toLowerCase() ? ' on' : ''),
      style: { '--c': c }, title: c, 'aria-label': 'Colour ' + c,
      onclick: () => { closePopover(); onPick(c); },
    })));
  openPopover(anchor, grid, { className: 'swatch-pop' });
}

// ── Time picker: type "930", "9:30", "9pm" or pick from a 15-minute list ──
function timeField({ value, onChange, listFrom, durationFrom }) {
  let cur = value;
  const input = h('input', { type: 'text', class: 'input time-input', spellcheck: 'false', autocomplete: 'off', value: fmtTime(value) });
  const wrap = h('div', { class: 'time-field' }, input);
  let list = null;

  function set(v, fire = true) {
    cur = v;
    input.value = fmtTime(v);
    if (fire) onChange(v);
  }
  function open() {
    close();
    const base = listFrom ? listFrom() : 0;
    const origin = durationFrom ? durationFrom() : null;
    list = h('div', { class: 'time-list', role: 'listbox' });
    let selected = null;
    for (let i = 0; i < 96; i++) {
      const m = base + (durationFrom ? (i + 1) * 15 : i * 15);
      const label = fmtTime(m) + (origin != null ? `  (${fmtDur(m - origin)})` : '');
      const item = h('div', {
        class: 'time-opt' + (m === cur ? ' on' : ''), role: 'option',
        onpointerdown: e => { e.preventDefault(); set(m); close(); },
      }, label);
      if (m === cur) selected = item;
      list.append(item);
    }
    wrap.append(list);
    const target = selected || list.children[Math.max(0, Math.floor(((cur - base) / 15)) - 1)] || list.firstChild;
    if (target) list.scrollTop = target.offsetTop - 60;
  }
  function close() { if (list) { list.remove(); list = null; } }
  function commit() {
    const p = parseTime(input.value);
    if (p == null) { input.value = fmtTime(cur); return; }
    // The end-time box can hold a value past midnight (start + duration), so compare by time of day.
    const sameTimeOfDay = (p % 1440) === (((cur % 1440) + 1440) % 1440);
    if (sameTimeOfDay) { input.value = fmtTime(cur); return; }
    set(p);
  }
  input.addEventListener('focus', () => { input.select(); open(); });
  input.addEventListener('blur', () => { close(); commit(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); close(); }
    else if (e.key === 'Escape') { if (list) { e.stopPropagation(); close(); input.value = fmtTime(cur); } }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const lo = listFrom ? listFrom() + (durationFrom ? 15 : 0) : 0;
      const hi = lo + 1425;
      set(clamp(cur + (e.key === 'ArrowDown' ? 15 : -15), lo, hi));
      if (list) open();
    }
  });
  return {
    el: wrap,
    get value() { return cur; },
    set value(v) { cur = v; input.value = fmtTime(v); },
    refresh() { input.value = fmtTime(cur); },
  };
}

// ── Small controls ──────────────────────────────────────────────────────
function toggleSwitch(checked, onChange, label) {
  const input = h('input', { type: 'checkbox', checked, onchange: () => onChange(input.checked) });
  return h('label', { class: 'switch', title: label || '' }, input, h('span', { class: 'switch-track' }, h('span', { class: 'switch-thumb' })));
}

function selectBox(value, options, onChange, attrs = {}) {
  const sel = h('select', { class: 'input', ...attrs, onchange: () => onChange(sel.value) },
    options.map(([v, label]) => h('option', { value: String(v), selected: String(v) === String(value) }, label)));
  return sel;
}
