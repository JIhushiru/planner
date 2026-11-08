'use strict';
/* Day / week timeline, month grid, mini calendar and their drag interactions. */

const SNAP = 15;
const FIT_MIN_H = 20;   // below this, "fit the whole day" gives up and scrolls
let fitHourH = 0;       // px per hour that makes 24 hours fill the timeline (set while rendering)
/** Pixels per hour: the saved Ctrl+wheel zoom, or the fitted height when the whole day is shown at once. */
const hourH = () => (Store.d.settings.fitDay && fitHourH) || Store.d.settings.hourHeight;

/** Switches the day and week views between "whole day on screen" and scrolling. */
function toggleFitDay(on = !Store.d.settings.fitDay) {
  Store.d.settings.fitDay = on;
  Store.quiet();
  App.resetScroll = true;
  if (App.state.view === 'day' || App.state.view === 'week') App.renderMain();
}

function visibleDates() {
  const S = Store.d.settings, st = App.state;
  if (st.view === 'day') return [st.date];
  const start = startOfWeek(st.date, S.weekStart);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return S.showWeekends ? days : days.filter(d => !isWeekend(d));
}

function periodTitle() {
  const st = App.state;
  if (st.view === 'plan') { const p = planById(st.planId); return p ? p.title : 'Plan'; }
  if (st.view === 'health') return 'Daily health · ' + fmtDateFull(st.healthDate || todayYmd());
  if (st.view === 'day') return fmtDateFull(st.date);
  if (st.view === 'month') { const [y, m] = ymdParts(st.date); return `${MONTHS[m - 1]} ${y}`; }
  const ds = visibleDates();
  const a = dayParts(ds[0]), b = dayParts(ds[ds.length - 1]);
  if (a.y !== b.y) return `${MONTHS_SHORT[a.m]} ${a.d}, ${a.y} – ${MONTHS_SHORT[b.m]} ${b.d}, ${b.y}`;
  if (a.m !== b.m) return `${MONTHS_SHORT[a.m]} ${a.d} – ${MONTHS_SHORT[b.m]} ${b.d}, ${b.y}`;
  return `${MONTHS[a.m]} ${a.d} – ${b.d}, ${b.y}`;
}

function openOcc(occ) {
  if (occ.kind === 'plan') openPlanDay(occ.plan, occ.day);
  else if (occ.kind === 'workout') openWorkoutDialog(occ.date);
  else openEditor({ occ });
}

/** The tick on a plan day or workout block. */
function toggleOccDone(o) {
  if (o.kind === 'plan') togglePlanDay(o.plan, o.day);
  else if (o.kind === 'workout') toggleWorkoutDone(o.date);
}

async function changeOccurrence(occ, patch, label) {
  if (occ.ev.repeat) {
    const scope = await scopeDialog({ title: 'Change repeating event', verb: 'Save' });
    if (!scope) { App.renderMain(); return; }
    Store.commit(label, () => applyEventChange(occ, patch, scope));
  } else {
    Store.commit(label, () => Object.assign(occ.ev, patch));
  }
}

// ── Timeline (day and week) ─────────────────────────────────────────────
function renderTimeline(main, refit = true) {
  const dates = visibleDates();
  const S = Store.d.settings, H = hourH();
  const today = todayYmd();
  const prev = main.querySelector('.tl-scroll');
  const keepScroll = prev && !App.resetScroll ? prev.scrollTop : null;
  App.resetScroll = false;

  const occs = occurrences(addDays(dates[0], -1), dates[dates.length - 1]);
  occs.forEach(o => App.occByKey.set(o.key, o));
  const cols = dates.length;
  const root = h('div', { class: 'tl' + (cols === 1 ? ' tl-one' : ''), style: { '--ncols': cols, '--hour-h': H + 'px' } });
  const scroll = h('div', { class: 'tl-scroll' });

  // Sticky header: weekday names and all-day items.
  const fitBtn = h('button', {
    class: 'tl-fit' + (S.fitDay ? ' on' : ''), 'aria-pressed': String(!!S.fitDay),
    title: S.fitDay ? 'Showing the whole day. Click to scroll instead (F)' : 'Fit the whole day, 12 AM to midnight (F)',
    onclick: () => toggleFitDay(),
  }, '24h');
  const head = h('div', { class: 'tl-row tl-head' }, h('div', { class: 'tl-gutter tl-corner' }, fitBtn),
    dates.map(d => {
      const p = dayParts(d);
      return h('button', {
        class: 'tl-dayhead' + (d === today ? ' is-today' : '') + (d < today ? ' is-past' : ''),
        title: 'Open ' + fmtDateLong(d),
        onclick: () => { App.state.date = d; App.state.taskDate = d; App.setView('day'); },
      }, h('span', { class: 'dw' }, WEEKDAYS_SHORT[p.w]), h('span', { class: 'dn' }, p.d));
    }));
  const allday = h('div', { class: 'tl-row tl-allday' }, h('div', { class: 'tl-gutter tl-allday-label' }, 'all-day'),
    dates.map(d => alldayCell(d, occs)));
  const sticky = h('div', { class: 'tl-sticky' }, head, allday);

  const hours = h('div', { class: 'tl-hours' });
  for (let hr = 1; hr < 24; hr++) hours.append(h('div', { class: 'tl-hour', style: { top: hr * H + 'px' } }, fmtHour(hr)));
  const body = h('div', { class: 'tl-row tl-body', style: { height: 24 * H + 'px' } }, hours,
    dates.map(d => timelineColumn(d, occs, today)));
  body.addEventListener('pointerdown', onTimelinePointerDown);
  scroll.addEventListener('wheel', onTimelineWheel, { passive: false });

  scroll.append(sticky, body);
  root.append(scroll);
  main.replaceChildren(root);

  if (S.fitDay) {
    // Size the hours so 12 AM to midnight fills the space under the sticky header, then draw again at that size.
    const avail = scroll.clientHeight - sticky.offsetHeight - 1;
    const fit = Math.max(FIT_MIN_H, Math.floor(avail / 24 * 4) / 4);
    if (refit && avail > 0 && Math.abs(fit - H) >= 0.25) {
      fitHourH = fit;
      App.resetScroll = keepScroll == null;
      renderTimeline(main, false);
      if (keepScroll != null) main.querySelector('.tl-scroll').scrollTop = keepScroll;
      return;
    }
  }

  if (keepScroll != null) scroll.scrollTop = keepScroll;
  else {
    // Open on "now" (with 1.5 h of context above it) when today is visible, else on the usual start of the day.
    const targetMin = dates.includes(today) ? Math.max(0, nowMinutes() - 90) : S.dayStart * 60;
    scroll.scrollTop = targetMin / 60 * H;
  }
}

function alldayCell(date, occs) {
  const dn = dayNum(date);
  const items = occs.filter(o => o.allDay && dn >= dayNum(o.date) && dn < dayNum(o.date) + Math.max(1, Math.round(o.dur / 1440)))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'event' ? -1 : 1));
  const cell = h('div', {
    class: 'tl-allday-cell', dataset: { dropDate: date },
    ondblclick: e => { if (e.target === cell) openEditor({ draft: { date, allDay: true } }); },
  }, items.map(o => chipEl(o, date)));
  return cell;
}

function timelineColumn(date, occs, today) {
  const col = h('div', {
    class: 'tl-col' + (date === today ? ' is-today' : '') + (isWeekend(date) ? ' is-weekend' : ''),
    dataset: { date },
  });
  const segs = segmentsFor(date, occs);
  layoutColumns(segs);
  const now = Date.now();
  for (const s of segs) col.append(eventBlock(s, now));
  if (date === today) col.append(h('div', { class: 'now-line', style: { top: nowMinutes() / 60 * hourH() + 'px' } }));
  return col;
}

function segmentsFor(date, occs) {
  const d0 = dayNum(date) * 1440, d1 = d0 + 1440;
  const out = [];
  for (const o of occs) {
    if (o.allDay) continue;
    const a = dayNum(o.date) * 1440 + o.start, b = a + o.dur;
    if (b <= d0 || a >= d1) continue;
    out.push({ occ: o, date, start: Math.max(a, d0) - d0, end: Math.min(b, d1) - d0, cutTop: a < d0, cutBottom: b > d1 });
  }
  out.sort((x, y) => x.start - y.start || (y.end - y.start) - (x.end - x.start));
  return out;
}

/** Side-by-side layout for overlapping blocks: greedy columns within each overlapping cluster. */
function layoutColumns(segs) {
  let cluster = [], colEnds = [], clusterEnd = -1;
  const flush = () => { for (const s of cluster) s.cols = colEnds.length; cluster = []; colEnds = []; };
  for (const s of segs) {
    if (cluster.length && s.start >= clusterEnd) { flush(); clusterEnd = -1; }
    let placed = false;
    for (let i = 0; i < colEnds.length; i++) {
      if (colEnds[i] <= s.start) { s.col = i; colEnds[i] = s.end; placed = true; break; }
    }
    if (!placed) { s.col = colEnds.length; colEnds.push(s.end); }
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, s.end);
  }
  flush();
}

function eventBlock(seg, now) {
  const o = seg.occ, H = hourH();
  const len = seg.end - seg.start;
  const top = seg.start / 60 * H;
  const height = Math.max(len / 60 * H - 2, 16);
  const compact = len < 45 || height < 34;
  const endTs = tsOf(o.date, o.start + o.dur);
  const past = endTs < now;
  const checkable = o.kind === 'plan' || o.kind === 'workout';
  const timeText = fmtRange(o.start, o.start + o.dur);
  const title = o.title || '(No title)';
  const el = h('div', {
    class: 'ev' + (compact ? ' ev-compact' : '') + (past ? ' is-past' : '') + (checkable ? ' ev-plan' : '') + (o.done ? ' is-done' : '')
      + (seg.cutTop ? ' cut-top' : '') + (seg.cutBottom ? ' cut-bottom' : ''),
    dataset: { key: o.key, end: endTs },
    title: `${o.label || title}\n${timeText}${o.kind === 'event' && o.ev.location ? '\n' + o.ev.location : ''}`,
    style: {
      top: top + 'px', height: height + 'px', '--c': o.color,
      left: `calc(${(seg.col / seg.cols) * 100}% + 2px)`,
      width: `calc(${100 / seg.cols}% - ${seg.cols > 1 ? 3 : 6}px)`,
    },
  });
  if (checkable) {
    el.append(h('button', {
      class: 'ev-check' + (o.done ? ' on' : ''), title: o.done ? 'Mark not done' : 'Mark done',
      onpointerdown: e => e.stopPropagation(),
      onclick: e => { e.stopPropagation(); toggleOccDone(o); },
    }, icon('check', 11)));
  }
  if (compact) {
    el.append(h('div', { class: 'ev-line' }, h('span', { class: 'ev-title' }, title), h('span', { class: 'ev-time' }, fmtTime(o.start))));
  } else {
    el.append(h('div', { class: 'ev-title' }, title), h('div', { class: 'ev-time' }, timeText));
    if (o.kind === 'event' && o.ev.location && height > 52) el.append(h('div', { class: 'ev-loc' }, o.ev.location));
  }
  if (o.kind === 'event' && o.ev.repeat && !compact) el.append(icon('repeat', 11, 'ev-badge'));
  if (o.kind === 'event' && !seg.cutBottom) el.append(h('div', { class: 'ev-resize', title: 'Drag to change the end time' }));
  return el;
}

/** Click empty space to add an event; drag to choose its span; drag a block to move it; drag its bottom edge to resize. */
function onTimelinePointerDown(e) {
  if (e.button !== 0) return;
  const col = e.target.closest('.tl-col');
  if (!col || e.target.closest('.ev-check')) return;
  const scroller = col.closest('.tl-scroll');
  const evEl = e.target.closest('.ev');
  const occ = evEl ? App.occByKey.get(evEl.dataset.key) : null;
  if (evEl && !occ) return;
  // Workouts sit at the workout time from the Health page, so they open on click instead of dragging.
  const mode = !evEl ? 'create' : occ.kind === 'workout' ? 'none' : e.target.closest('.ev-resize') ? 'resize' : 'move';
  e.preventDefault();

  const H = hourH();
  const cols = $$('.tl-col', scroller);
  const startX = e.clientX, startY = e.clientY;
  const colDate = col.dataset.date;
  const minAt = (y, c) => clamp((y - c.getBoundingClientRect().top) / H * 60, 0, 1440);
  const snap = m => Math.round(m / SNAP) * SNAP;
  const colAt = x => {
    for (const c of cols) { const r = c.getBoundingClientRect(); if (x >= r.left && x < r.right) return c; }
    return x < cols[0].getBoundingClientRect().left ? cols[0] : cols[cols.length - 1];
  };
  const pStart = minAt(startY, col);
  const occAbs = occ ? dayNum(occ.date) * 1440 + occ.start : 0;
  const grab = occ ? dayNum(colDate) * 1440 + pStart - occAbs : 0;
  let moved = false, ghost = null, result = null, last = e, raf = 0;

  function placeGhost(c, start, len, label) {
    if (!ghost) {
      ghost = h('div', { class: 'ev ghost' + (occ && occ.kind === 'plan' ? ' ev-plan' : ''), style: { '--c': occ ? occ.color : 'var(--accent)' } },
        h('div', { class: 'ev-title' }, occ ? occ.title || '(No title)' : 'New event'), h('div', { class: 'ev-time' }));
    }
    if (ghost.parentNode !== c) c.append(ghost);
    ghost.style.top = start / 60 * H + 'px';
    ghost.style.height = Math.max(len / 60 * H - 2, 16) + 'px';
    ghost.querySelector('.ev-time').textContent = label;
  }

  function update(ev) {
    last = ev;
    if (mode === 'none') {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) >= 5) moved = true;
      return;
    }
    if (!moved) {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5) return;
      moved = true;
      document.body.classList.add('is-dragging', 'drag-' + mode);
      if (evEl) evEl.classList.add(mode === 'move' ? 'dragging' : 'resizing');
      App.dragging = true;
      tickScroll();
    }
    if (mode === 'create') {
      const a = snap(pStart), b = snap(minAt(ev.clientY, col));
      let s = Math.min(a, b), en = Math.max(a, b);
      if (en - s < SNAP) en = s + SNAP;
      if (en > 1440) { en = 1440; s = Math.min(s, 1440 - SNAP); }
      result = { date: colDate, start: s, dur: en - s };
      placeGhost(col, s, en - s, fmtRange(s, en));
    } else if (mode === 'move') {
      const c = colAt(ev.clientX);
      const nAbs = snap(dayNum(c.dataset.date) * 1440 + minAt(ev.clientY, c) - grab);
      const nd = fromDayNum(Math.floor(nAbs / 1440)), ns = ((nAbs % 1440) + 1440) % 1440;
      result = { date: nd, start: ns };
      const target = cols.find(x => x.dataset.date === nd) || c;
      placeGhost(target, ns, Math.min(occ.dur, 1440 - ns), fmtRange(ns, ns + occ.dur));
    } else {
      const endAbs = snap(dayNum(colDate) * 1440 + minAt(ev.clientY, col));
      const dur = Math.max(SNAP, endAbs - occAbs);
      result = { dur };
      const segTop = parseFloat(evEl.style.top) / H * 60;
      const endInCol = Math.min(1440, occAbs + dur - dayNum(colDate) * 1440);
      evEl.style.height = Math.max((endInCol - segTop) / 60 * H - 2, 16) + 'px';
      const t = evEl.querySelector('.ev-time');
      if (t) t.textContent = fmtRange(occ.start, occ.start + dur);
    }
  }

  function tickScroll() {
    raf = requestAnimationFrame(() => {
      const r = scroller.getBoundingClientRect();
      const top = r.top + (scroller.querySelector('.tl-sticky')?.offsetHeight || 0);
      let dy = 0;
      if (last.clientY < top + 28) dy = -Math.ceil((top + 28 - last.clientY) / 3);
      else if (last.clientY > r.bottom - 28) dy = Math.ceil((last.clientY - (r.bottom - 28)) / 3);
      if (dy) { scroller.scrollTop += clamp(dy, -24, 24); update(last); }
      tickScroll();
    });
  }

  function finish(commit) {
    window.removeEventListener('pointermove', update);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    cancelAnimationFrame(raf);
    document.body.classList.remove('is-dragging', 'drag-' + mode);
    App.dragging = false;
    if (ghost) ghost.remove();
    if (evEl) evEl.classList.remove('dragging', 'resizing');
    if (!commit) { App.renderMain(); return; }

    if (!moved) {
      if (mode === 'create') {
        const s = Math.min(Math.floor(pStart / 30) * 30, 1440 - 30);
        openEditor({ draft: { date: colDate, start: s, dur: Store.d.settings.defaultDur } });
      } else openOcc(occ);
      return;
    }
    if (!result) { App.renderMain(); return; }
    if (mode === 'create') { App.renderMain(); openEditor({ draft: result }); return; }
    if (occ.kind === 'plan') { movePlanDay(occ.plan, occ.day, result.date, occ.allDay ? null : result.start); return; }
    if (mode === 'move') {
      if (result.date !== occ.date || result.start !== occ.start) changeOccurrence(occ, { date: result.date, start: result.start }, 'Event moved');
      else App.renderMain();
    } else if (result.dur !== occ.dur) changeOccurrence(occ, { dur: result.dur }, 'Event resized');
    else App.renderMain();
  }
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  const onKey = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); finish(false); } };
  window.addEventListener('pointermove', update);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
}

/** Ctrl + mouse wheel zooms the timeline (hour height). */
function onTimelineWheel(e) {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const scroller = e.currentTarget;
  const H = hourH(), S = Store.d.settings;
  const next = clamp(Math.round(H * (e.deltaY < 0 ? 1.12 : 1 / 1.12)), 28, 160);
  if (S.fitDay) {
    // The whole day is already on screen: zooming out does nothing, zooming in switches to scrolling.
    if (e.deltaY >= 0) return;
    S.fitDay = false;
    toast('Zoomed in. Press F to fit the whole day again.');
  } else if (next === H) return;
  const body = scroller.querySelector('.tl-body');
  const anchorMin = (e.clientY - body.getBoundingClientRect().top) / H * 60;
  const offset = e.clientY - scroller.getBoundingClientRect().top;
  Store.d.settings.hourHeight = next;
  App.renderMain();
  const sc = $('#main .tl-scroll');
  const stickyH = sc.querySelector('.tl-sticky').offsetHeight;
  sc.scrollTop = anchorMin / 60 * next + stickyH - offset;
  saveSettingsSoon();
}
const saveSettingsSoon = debounce(() => Store.quiet(), 600);

// ── Chips (all-day lane and month grid) ─────────────────────────────────
function chipEl(o, cellDate) {
  const checkable = o.kind === 'plan' || o.kind === 'workout';
  const timed = !o.allDay;
  const el = h('div', {
    class: 'chip' + (checkable ? ' chip-plan' : '') + (timed ? ' chip-timed' : ' chip-allday') + (o.done ? ' is-done' : '')
      + (tsOf(o.date, o.start + o.dur) < Date.now() && !checkable ? ' is-past' : ''),
    dataset: { key: o.key, cell: cellDate },
    style: { '--c': o.color },
    title: (o.label || o.title || '(No title)') + (timed ? '\n' + fmtRange(o.start, o.start + o.dur) : '')
      + (checkable ? `\n${o.phase ? o.phase.title + ' · ' : ''}click for details, tick to mark done` : ''),
  });
  if (checkable) {
    el.append(h('button', {
      class: 'chip-check' + (o.done ? ' on' : ''), title: o.done ? 'Mark not done' : 'Mark done',
      onpointerdown: e => e.stopPropagation(),
      onclick: e => { e.stopPropagation(); toggleOccDone(o); },
    }, icon('check', 10)));
  } else if (timed) {
    el.append(h('span', { class: 'chip-dot' }));
  }
  if (timed) el.append(h('span', { class: 'chip-time' }, fmtTime(o.start)));
  el.append(h('span', { class: 'chip-title' }, o.title || '(No title)'));
  el.addEventListener('pointerdown', onChipPointerDown);
  return el;
}

function onChipPointerDown(e) {
  if (e.button !== 0) return;
  const chip = e.currentTarget;
  const occ = App.occByKey.get(chip.dataset.key);
  if (!occ) return;
  e.preventDefault();
  e.stopPropagation();
  const sx = e.clientX, sy = e.clientY;
  let moved = false, ghost = null, target = null;
  function move(ev) {
    if (occ.kind === 'workout') return; // workouts open on click; their time is set on the Health page
    if (!moved) {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;
      moved = true;
      ghost = chip.cloneNode(true);
      ghost.classList.add('chip-ghost');
      ghost.style.width = chip.offsetWidth + 'px';
      document.body.append(ghost);
      chip.classList.add('dragging');
      document.body.classList.add('is-dragging');
      App.dragging = true;
    }
    ghost.style.left = ev.clientX + 10 + 'px';
    ghost.style.top = ev.clientY + 8 + 'px';
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const cell = el && el.closest('[data-drop-date]');
    if (cell !== target) {
      if (target) target.classList.remove('drop-target');
      target = cell;
      if (target) target.classList.add('drop-target');
    }
  }
  function up() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('keydown', key, true);
    document.body.classList.remove('is-dragging');
    App.dragging = false;
    if (ghost) ghost.remove();
    chip.classList.remove('dragging');
    if (target) target.classList.remove('drop-target');
    if (!moved) { openOcc(occ); return; }
    if (!target) return;
    const delta = diffDays(chip.dataset.cell, target.dataset.dropDate);
    if (!delta) return;
    const nd = addDays(occ.date, delta);
    if (occ.kind === 'plan') movePlanDay(occ.plan, occ.day, nd, occ.day.time != null ? occ.day.time : undefined);
    else changeOccurrence(occ, { date: nd }, 'Event moved');
  }
  function key(ev) {
    if (ev.key !== 'Escape') return;
    ev.stopPropagation();
    target = null;
    moved = true;
    up();
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('keydown', key, true);
}

// ── Month ───────────────────────────────────────────────────────────────
function renderMonth(main) {
  const S = Store.d.settings, st = App.state, today = todayYmd();
  const first = startOfMonth(st.date);
  const [y, m] = ymdParts(first);
  const gridStart = startOfWeek(first, S.weekStart);
  const lastDay = `${y}-${pad2(m)}-${pad2(daysInMonth(y, m))}`;
  const rows = Math.ceil((diffDays(gridStart, lastDay) + 1) / 7);
  const days = Array.from({ length: rows * 7 }, (_, i) => addDays(gridStart, i));
  const occs = occurrences(addDays(gridStart, -1), days[days.length - 1]);
  occs.forEach(o => App.occByKey.set(o.key, o));

  const byDay = new Map(days.map(d => [d, []]));
  for (const o of occs) {
    const s = dayNum(o.date);
    const span = o.allDay ? Math.max(1, Math.round(o.dur / 1440)) : Math.floor((o.start + o.dur - 1) / 1440) + 1;
    for (let i = 0; i < span; i++) {
      const d = fromDayNum(s + i);
      if (byDay.has(d) && (o.allDay || i === 0)) byDay.get(d).push(o);
    }
  }
  const avail = (main.clientHeight || 600) - 34;
  const cellH = avail / rows;
  const cap = Math.max(1, Math.floor((cellH - 32) / 22));

  const head = h('div', { class: 'm-head' }, Array.from({ length: 7 }, (_, i) => h('div', null, WEEKDAYS_SHORT[(S.weekStart + i) % 7])));
  const grid = h('div', { class: 'm-grid', style: { '--rows': rows } });
  for (const d of days) {
    const p = dayParts(d);
    const items = byDay.get(d).sort((a, b) => (b.allDay - a.allDay) || (a.kind === 'plan') - (b.kind === 'plan') || a.start - b.start);
    const show = items.length > cap ? items.slice(0, cap - 1) : items;
    const cell = h('div', {
      class: 'm-cell' + (p.m !== m - 1 ? ' other' : '') + (d === today ? ' today' : '') + (isWeekend(d) ? ' weekend' : '') + (d < today ? ' past' : ''),
      dataset: { dropDate: d },
    },
    h('button', {
      class: 'm-num', title: 'Open ' + fmtDateLong(d),
      onclick: () => { st.date = d; st.taskDate = d; App.setView('day'); },
    }, p.d === 1 ? `${MONTHS_SHORT[p.m]} 1` : p.d),
    h('div', { class: 'm-items' },
      show.map(o => chipEl(o, d)),
      items.length > show.length ? h('button', {
        class: 'm-more', onclick: () => { st.date = d; st.taskDate = d; App.setView('day'); },
      }, `+${items.length - show.length} more`) : null));
    cell.addEventListener('dblclick', e => {
      if (e.target.closest('.chip, .m-num, .m-more')) return;
      openEditor({ draft: { date: d, start: 9 * 60, dur: S.defaultDur } });
    });
    grid.append(cell);
  }
  main.replaceChildren(h('div', { class: 'month' }, head, grid));
}

// ── Mini calendar ───────────────────────────────────────────────────────
function renderMiniCal() {
  const box = $('#miniCal');
  if (!box) return;
  const S = Store.d.settings, st = App.state, today = todayYmd();
  const month = st.miniMonth || startOfMonth(st.date);
  const [y, m] = ymdParts(month);
  const gridStart = startOfWeek(month, S.weekStart);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const busy = new Set(occurrences(days[0], days[41]).map(o => o.date));

  let rangeFrom = st.date, rangeTo = st.date;
  if (st.view === 'week') { const vd = visibleDates(); rangeFrom = vd[0]; rangeTo = vd[vd.length - 1]; }
  if (st.view === 'month' || st.view === 'plan' || st.view === 'health') { rangeFrom = rangeTo = null; }
  const selected = st.view === 'day' ? st.date : st.view === 'health' ? (st.healthDate || today) : null;

  const nav = delta => { st.miniMonth = addMonths(month, delta); renderMiniCal(); };
  box.replaceChildren(
    h('div', { class: 'mini-head' },
      h('span', null, `${MONTHS[m - 1]} ${y}`),
      h('span', null,
        h('button', { class: 'icon-btn sm', title: 'Previous month', onclick: () => nav(-1) }, icon('chevronLeft', 15)),
        h('button', { class: 'icon-btn sm', title: 'Next month', onclick: () => nav(1) }, icon('chevronRight', 15)))),
    h('div', { class: 'mini-grid' },
      Array.from({ length: 7 }, (_, i) => h('div', { class: 'mini-dw' }, WEEKDAYS[(S.weekStart + i) % 7].slice(0, 2))),
      days.map(d => {
        const inRange = rangeFrom && d >= rangeFrom && d <= rangeTo;
        return h('button', {
          class: 'mini-day' + (ymdParts(d)[1] !== m ? ' other' : '') + (d === today ? ' today' : '')
            + (inRange ? ' in-range' : '') + (d === selected ? ' selected' : '') + (busy.has(d) ? ' busy' : ''),
          onclick: () => {
            st.date = d;
            st.taskDate = d;
            st.miniMonth = null;
            if (st.view === 'health') st.healthDate = d;
            if (st.view === 'plan') st.view = Store.d.settings.view || 'week';
            App.render();
          },
        }, ymdParts(d)[2]);
      })));
}

/** Moves the red "now" line and fades finished blocks without a full re-render. */
function updateNowMarks() {
  const line = $('#main .now-line');
  if (line) line.style.top = nowMinutes() / 60 * hourH() + 'px';
  const now = Date.now();
  $$('#main .ev[data-end]').forEach(el => el.classList.toggle('is-past', +el.dataset.end < now && !el.classList.contains('ghost')));
}
