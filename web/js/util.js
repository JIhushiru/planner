'use strict';
/* Shared helpers: dates as 'YYYY-MM-DD' strings, times as minutes after midnight, formatting and DOM building. */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map(m => m.slice(0, 3));
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = WEEKDAYS.map(d => d.slice(0, 3));

const pad2 = n => (n < 10 ? '0' : '') + n;

// ── Dates ───────────────────────────────────────────────────────────────
function ymdOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function todayYmd() { return ymdOf(new Date()); }
function ymdParts(s) { return [+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10)]; }
function isYmd(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
/** Whole days since 1970-01-01, computed in UTC so daylight-saving changes never shift a date. */
function dayNum(s) { const [y, m, d] = ymdParts(s); return Math.round(Date.UTC(y, m - 1, d) / 86400000); }
function fromDayNum(n) {
  const d = new Date(n * 86400000);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}
function addDays(s, n) { return fromDayNum(dayNum(s) + n); }
function diffDays(a, b) { return dayNum(b) - dayNum(a); }
const dowOfNum = n => (((n % 7) + 7) + 4) % 7; // 1970-01-01 was a Thursday
function dowOf(s) { return dowOfNum(dayNum(s)); }
function startOfWeek(s, weekStart) { return addDays(s, -((dowOf(s) - weekStart + 7) % 7)); }
function startOfMonth(s) { return s.slice(0, 8) + '01'; }
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); } // m is 1-12
function addMonths(s, n) {
  let [y, m, d] = ymdParts(s);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = (((m - 1) % 12) + 12) % 12 + 1;
  d = Math.min(d, daysInMonth(y, m));
  return y + '-' + pad2(m) + '-' + pad2(d);
}
function isWeekend(s) { const d = dowOf(s); return d === 0 || d === 6; }
/** Local timestamp (ms) for a date plus minutes; minutes may run past midnight. */
function tsOf(s, min) { const [y, m, d] = ymdParts(s); return new Date(y, m - 1, d, 0, min).getTime(); }
function nowMinutes() { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }

// ── Formatting ──────────────────────────────────────────────────────────
const Fmt = { h12: false };

function fmtTime(min) {
  min = ((Math.round(min) % 1440) + 1440) % 1440;
  const hh = Math.floor(min / 60), mm = min % 60;
  if (Fmt.h12) return (hh % 12 || 12) + ':' + pad2(mm) + (hh < 12 ? ' AM' : ' PM');
  return pad2(hh) + ':' + pad2(mm);
}
function fmtRange(a, b) {
  if (Fmt.h12) {
    const sa = fmtTime(a), sb = fmtTime(b);
    if (sa.slice(-2) === sb.slice(-2)) return sa.slice(0, -3) + ' – ' + sb;
    return sa + ' – ' + sb;
  }
  return fmtTime(a) + ' – ' + fmtTime(b);
}
function fmtHour(hh) {
  if (Fmt.h12) return (hh % 12 || 12) + ' ' + (hh < 12 ? 'AM' : 'PM');
  return pad2(hh) + ':00';
}
function fmtDur(min) {
  min = Math.round(min);
  const hh = Math.floor(min / 60), mm = min % 60;
  if (!hh) return mm + ' min';
  return mm ? hh + 'h ' + mm + 'm' : hh + 'h';
}
/** mm:ss for the timer, rounding up so it never shows 0:00 while running. */
function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ':' + pad2(s % 60);
}
function fmtDateLong(s) { const d = dayParts(s); return `${WEEKDAYS[d.w]}, ${MONTHS[d.m]} ${d.d}`; }
function fmtDateMed(s) { const d = dayParts(s); return `${WEEKDAYS_SHORT[d.w]}, ${MONTHS_SHORT[d.m]} ${d.d}`; }
function fmtDateFull(s) { const d = dayParts(s); return `${WEEKDAYS[d.w]}, ${MONTHS[d.m]} ${d.d}, ${d.y}`; }
function fmtMonthDay(s) { const d = dayParts(s); return `${MONTHS[d.m]} ${d.d}`; }
function fmtShortMonthDay(s) { const d = dayParts(s); return `${MONTHS_SHORT[d.m]} ${d.d}`; }
function dayParts(s) { const [y, m, d] = ymdParts(s); return { y, m: m - 1, d, w: dowOf(s) }; }
/** "November 6 to 15" or "November 28 to December 3". */
function fmtSpan(a, b) {
  const A = dayParts(a), B = dayParts(b);
  if (a === b) return `${MONTHS[A.m]} ${A.d}`;
  if (A.y === B.y && A.m === B.m) return `${MONTHS[A.m]} ${A.d} to ${B.d}`;
  return `${MONTHS[A.m]} ${A.d} to ${MONTHS[B.m]} ${B.d}`;
}
function relDay(s, today = todayYmd()) {
  const diff = diffDays(today, s);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return fmtDateMed(s);
}
function fmtIn(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `in ${m} min`;
  const hh = Math.floor(m / 60), mm = m % 60;
  if (hh >= 24) { const dd = Math.round(hh / 24); return `in ${dd} day${dd === 1 ? '' : 's'}`; }
  return mm ? `in ${hh}h ${mm}m` : `in ${hh}h`;
}
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
/** "A", "A and B", "A, B and C". */
function andList(items) { return items.length < 3 ? items.join(' and ') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]; }

/** Parses what people type into a time box: 9, 930, 9:30, 21:30, 9pm, 9:30 am, 12a. Returns minutes or null. */
function parseTime(str) {
  if (str == null) return null;
  const s = String(str).trim().toLowerCase().replace(/\s+/g, '').replace(/\./g, ':');
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?(a|am|p|pm)?$/);
  if (!m) return null;
  let hh = +m[1];
  const mm = m[2] ? +m[2] : 0;
  const ap = m[3];
  if (mm > 59) return null;
  if (ap) {
    if (hh < 1 || hh > 12) return null;
    if (ap[0] === 'p' && hh !== 12) hh += 12;
    if (ap[0] === 'a' && hh === 12) hh = 0;
  }
  if (hh === 24 && mm === 0) return 1440;
  if (hh > 23) return null;
  return hh * 60 + mm;
}

// ── Misc ────────────────────────────────────────────────────────────────
function uid(prefix = '') { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function debounce(fn, ms) { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ── DOM ─────────────────────────────────────────────────────────────────
/** Tiny element builder: h('div', {class: 'x', onclick: fn, style: {'--c': red}}, 'text', child). */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const sk in v) {
          if (v[sk] == null) continue;
          if (sk.startsWith('--')) el.style.setProperty(sk, v[sk]); else el.style[sk] = v[sk];
        }
      } else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  appendKids(el, kids);
  return el;
}
function appendKids(el, kids) {
  for (const c of kids) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendKids(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
/** Replaces an element's contents, skipping null / false the way h() does (replaceChildren would print "null"). */
function fill(el, ...kids) {
  el.replaceChildren();
  appendKids(el, kids);
  return el;
}
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
function isTyping(e) {
  const t = e.target;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

/** Renders the small markup used in plan text: [text](https://url), **bold**, *italic*, ~subscript~. */
function richText(src) {
  const frag = document.createDocumentFragment();
  if (!src) return frag;
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|~([^~]+)~/g;
  let last = 0, m;
  while ((m = re.exec(src))) {
    if (m.index > last) frag.append(src.slice(last, m.index));
    if (m[1]) frag.append(h('a', { href: m[2], class: 'ext', title: m[2] }, m[1]));
    else if (m[3]) frag.append(h('b', null, m[3]));
    else if (m[4]) frag.append(h('i', null, m[4]));
    else if (m[5]) frag.append(h('sub', null, m[5]));
    last = re.lastIndex;
  }
  if (last < src.length) frag.append(src.slice(last));
  return frag;
}
function plainText(src) {
  return String(src || '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~([^~]+)~/g, '$1');
}
