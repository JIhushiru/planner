'use strict';
/* Right-panel cards (Now / Next, Tasks), their drag-to-reorder, and left-sidebar lists (Upcoming, Categories). */

// ── Reordering the right panel ──────────────────────────────────────────
const PANEL_DEFAULT_ORDER = ['now', 'health', 'weather', 'study', 'timer', 'tasks'];

function applyPanelOrder() {
  const panel = $('#panel');
  const saved = (Store.d.settings.panelOrder || []).filter(id => PANEL_DEFAULT_ORDER.includes(id));
  const order = [...saved, ...PANEL_DEFAULT_ORDER.filter(id => !saved.includes(id))];
  for (const id of order) {
    const slot = panel.querySelector(`.panel-slot[data-card="${id}"]`);
    if (slot) panel.append(slot);
  }
}
function savePanelOrder() {
  Store.d.settings.panelOrder = $$('#panel .panel-slot').map(s => s.dataset.card);
  Store.quiet();
}
function resetPanelOrder() {
  Store.d.settings.panelOrder = [];
  Store.quiet();
  applyPanelOrder();
}

/** Drag a card by its handle; or focus the handle and press Up / Down. */
function initPanelDrag() {
  const panel = $('#panel');
  panel.addEventListener('keydown', e => {
    const grip = e.target.closest('.card-grip');
    if (!grip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    e.stopPropagation();
    const slot = grip.closest('.panel-slot');
    const visible = $$('.panel-slot', panel).filter(s => s.offsetParent !== null);
    const i = visible.indexOf(slot);
    const other = visible[i + (e.key === 'ArrowUp' ? -1 : 1)];
    if (!other) return;
    if (e.key === 'ArrowUp') other.before(slot); else other.after(slot);
    grip.focus();
    savePanelOrder();
  });
  panel.addEventListener('pointerdown', e => {
    const grip = e.target.closest('.card-grip');
    if (!grip || e.button !== 0) return;
    e.preventDefault();
    const slot = grip.closest('.panel-slot');
    const rect = slot.getBoundingClientRect();
    const grabY = e.clientY - rect.top;
    const holder = h('div', { class: 'panel-holder', style: { height: rect.height + 'px' } });
    slot.after(holder);
    slot.classList.add('lifted');
    Object.assign(slot.style, { position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', zIndex: '300' });
    document.body.classList.add('is-dragging');
    App.dragging = true;
    let lastY = e.clientY, raf = 0;

    const place = () => {
      slot.style.top = (lastY - grabY) + 'px';
      const others = $$('.panel-slot', panel).filter(s => s !== slot && s.offsetParent !== null);
      const before = others.find(o => { const r = o.getBoundingClientRect(); return lastY < r.top + r.height / 2; });
      if (before) { if (holder.nextElementSibling !== before) panel.insertBefore(holder, before); }
      else if (panel.lastElementChild !== holder) panel.append(holder);
    };
    const scroll = () => {
      const pr = panel.getBoundingClientRect();
      const dy = lastY < pr.top + 40 ? -12 : lastY > pr.bottom - 40 ? 12 : 0;
      if (dy) { panel.scrollTop += dy; place(); }
      raf = requestAnimationFrame(scroll);
    };
    const move = ev => { lastY = ev.clientY; place(); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      cancelAnimationFrame(raf);
      holder.replaceWith(slot);
      slot.removeAttribute('style');
      slot.classList.remove('lifted');
      document.body.classList.remove('is-dragging');
      App.dragging = false;
      savePanelOrder();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    raf = requestAnimationFrame(scroll);
  });
}

// ── Now / Next ──────────────────────────────────────────────────────────
function renderNowCard() {
  const card = $('#nowCard');
  if (!card) return;
  const now = Date.now(), today = todayYmd();
  const occs = occurrences(addDays(today, -1), addDays(today, 1));
  occs.forEach(o => App.occByKey.set(o.key, o));
  const timed = occs.filter(o => !o.allDay).map(o => ({ o, s: tsOf(o.date, o.start), e: tsOf(o.date, o.start + o.dur) }));
  const current = timed.filter(x => x.s <= now && now < x.e).sort((a, b) => b.s - a.s).slice(0, 2);
  const next = timed.filter(x => x.s > now).sort((a, b) => a.s - b.s)[0];
  const allDay = occs.filter(o => o.allDay && o.kind === 'event' && dayNum(o.date) <= dayNum(today) && dayNum(today) < dayNum(o.date) + Math.round(o.dur / 1440));

  const d = new Date();
  const head = h('div', { class: 'card-h' },
    h('div', { class: 'card-title' }, 'Today'),
    h('div', { class: 'now-date' }, `${fmtDateMed(today)} · ${fmtTime(d.getHours() * 60 + d.getMinutes())}`));
  const parts = [head];

  for (const { o, s, e } of current) {
    const frac = clamp((now - s) / (e - s), 0, 1);
    parts.push(h('div', { class: 'now-item', style: { '--c': o.color } },
      h('div', { class: 'now-label' }, 'Now'),
      h('button', { class: 'now-title', onclick: () => openOcc(o) }, o.title || '(No title)'),
      h('div', { class: 'now-sub' }, fmtRange(o.start, o.start + o.dur), ' · ', `ends ${fmtIn(e - now)}`),
      h('div', { class: 'now-bar' }, h('i', { style: { width: frac * 100 + '%' } })),
      o.kind === 'event' ? h('button', {
        class: 'btn sm ghost now-focus', title: 'Start a focus timer for this',
        onclick: () => Pomo.focusOn({ label: o.title || 'Event' }),
      }, icon('target', 13), 'Focus') : null));
  }
  if (!current.length) {
    parts.push(h('div', { class: 'now-free' }, h('b', null, 'Free right now'),
      next && next.s - now < 86400000 ? ` until ${fmtTime(new Date(next.s).getHours() * 60 + new Date(next.s).getMinutes())}` : ''));
  }
  if (next) {
    parts.push(h('button', { class: 'next-item', style: { '--c': next.o.color }, onclick: () => openOcc(next.o) },
      h('span', { class: 'next-label' }, 'Next'),
      h('span', { class: 'next-title' }, next.o.title || '(No title)'),
      h('span', { class: 'next-when' }, `${next.o.date === today ? '' : relDay(next.o.date, today) + ' '}${fmtTime(next.o.start)} · ${fmtIn(next.s - now)}`)));
  } else if (!current.length) {
    parts.push(h('div', { class: 'muted small' }, 'Nothing else on the calendar today.'));
  }
  if (allDay.length) {
    parts.push(h('div', { class: 'now-allday' }, allDay.map(o => h('button', {
      class: 'mini-chip', style: { '--c': o.color }, onclick: () => openOcc(o),
    }, o.title || '(No title)'))));
  }
  if (!Store.d.events.length) {
    parts.push(h('div', { class: 'tip' }, icon('sparkle', 14), h('span', null, 'Drag across the calendar to add your first event, or press ', h('kbd', null, 'N'), '.')));
  }
  card.replaceChildren(...parts);
}

// ── Tasks ───────────────────────────────────────────────────────────────
function renderTasksCard() {
  const card = $('#tasksCard');
  if (!card) return;
  const st = App.state, today = todayYmd();
  const date = st.taskDate;
  const list = tasksOn(date);
  const overdue = date === today ? overdueTasks(today) : [];
  const doneCount = list.filter(t => t.done).length;

  const nav = delta => { st.taskDate = addDays(st.taskDate, delta); renderTasksCard(); };
  const input = h('input', { class: 'input', placeholder: `Add a task for ${relDay(date, today).toLowerCase() === 'today' ? 'today' : relDay(date, today)}…`, maxlength: 200 });
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const title = input.value.trim();
    if (!title) return;
    Store.commit('Task added', d => { d.tasks.push(normalizeTask({ id: uid('t'), title, date, created: Date.now() })); }, { toast: false });
    requestAnimationFrame(() => { const i = $('#tasksCard .task-add input'); if (i) i.focus(); });
  });

  fill(card,
    h('div', { class: 'card-h' },
      h('div', { class: 'card-title' }, 'Tasks'),
      h('div', { class: 'task-nav' },
        h('button', { class: 'icon-btn xs', title: 'Previous day', onclick: () => nav(-1) }, icon('chevronLeft', 14)),
        h('button', { class: 'task-date' + (date === today ? ' is-today' : ''), title: 'Back to today', onclick: () => { st.taskDate = today; renderTasksCard(); } }, relDay(date, today)),
        h('button', { class: 'icon-btn xs', title: 'Next day', onclick: () => nav(1) }, icon('chevronRight', 14)))),
    h('div', { class: 'task-add' }, icon('plus', 15), input),
    h('div', { class: 'task-list' },
      list.length ? list.map(t => taskRow(t)) : h('div', { class: 'empty small' }, date === today ? 'No tasks yet. Small, concrete steps work best.' : 'No tasks for this day.')),
    overdue.length ? h('div', { class: 'task-overdue' },
      h('div', { class: 'overdue-h' },
        h('span', null, `From earlier · ${overdue.length}`),
        h('button', { class: 'linkish small', onclick: () => Store.commit('Moved to today', () => overdue.forEach(t => { t.date = today; })) }, 'Move all to today')),
      overdue.map(t => taskRow(t, true))) : null,
    list.length ? h('div', { class: 'task-foot muted small' }, `${doneCount} of ${list.length} done`) : null);
}

function taskRow(t, showDate) {
  const titleEl = h('span', { class: 'task-title', title: 'Double-click to rename' }, t.title);
  titleEl.addEventListener('dblclick', () => {
    const inp = h('input', { class: 'input task-edit', value: t.title, maxlength: 200 });
    const done = save => {
      const v = inp.value.trim();
      if (save && v && v !== t.title) Store.commit('Task renamed', () => { t.title = v; }, { toast: false });
      else renderTasksCard();
    };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') done(true);
      else if (e.key === 'Escape') { e.stopPropagation(); done(false); }
    });
    inp.addEventListener('blur', () => done(true));
    titleEl.replaceWith(inp);
    inp.focus();
    inp.select();
  });
  const focused = Pomo.st && Pomo.st.taskId === t.id;
  return h('div', { class: 'task' + (t.done ? ' done' : '') + (focused ? ' focused' : '') },
    h('button', {
      class: 'check' + (t.done ? ' on' : ''), title: t.done ? 'Mark not done' : 'Mark done',
      onclick: () => Store.commit(t.done ? 'Task reopened' : 'Task done', () => { t.done = !t.done; t.doneAt = t.done ? Date.now() : null; }, { toast: false }),
    }, icon('check', 11)),
    titleEl,
    showDate ? h('span', { class: 'task-when' }, fmtShortMonthDay(t.date)) : null,
    t.pomos ? h('span', { class: 'task-pomos', title: `${t.pomos} focus session${t.pomos === 1 ? '' : 's'}` }, icon('tomato', 12, 'tomato'), t.pomos) : null,
    h('span', { class: 'task-actions' },
      !t.done ? h('button', { class: 'icon-btn xs', title: 'Focus on this task', onclick: () => Pomo.focusOn({ label: t.title, taskId: t.id }) }, icon('target', 14)) : null,
      h('button', { class: 'icon-btn xs', title: 'Delete task', onclick: () => Store.commit('Task deleted', d => { d.tasks = d.tasks.filter(x => x.id !== t.id); }) }, icon('x', 14))));
}

// ── Upcoming (next 7 days) ──────────────────────────────────────────────
function renderUpcoming() {
  const box = $('#upcoming');
  if (!box) return;
  const today = todayYmd();
  const from = addDays(today, 1), to = addDays(today, 7);
  const occs = occurrences(from, to).filter(o => o.kind === 'event' && o.date >= from)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (b.allDay - a.allDay) || a.start - b.start));
  occs.forEach(o => App.occByKey.set(o.key, o));
  if (!occs.length) { box.replaceChildren(h('div', { class: 'empty small' }, 'Nothing in the next 7 days.')); return; }
  const groups = new Map();
  for (const o of occs.slice(0, 14)) {
    if (!groups.has(o.date)) groups.set(o.date, []);
    groups.get(o.date).push(o);
  }
  box.replaceChildren(...[...groups].map(([date, items]) => h('div', { class: 'up-day' },
    h('button', { class: 'up-date', onclick: () => { App.state.date = date; App.state.taskDate = date; App.setView('day'); } }, relDay(date, today)),
    items.map(o => h('button', { class: 'up-item', style: { '--c': o.color }, onclick: () => openOcc(o) },
      h('i'),
      h('span', { class: 'up-time' }, o.allDay ? 'All day' : fmtTime(o.start)),
      h('span', { class: 'up-title' }, o.title || '(No title)'))))));
}

// ── Categories (show / hide) ────────────────────────────────────────────
function renderCategories() {
  const box = $('#catList');
  if (!box) return;
  const hidden = new Set(Store.d.hiddenCats);
  box.replaceChildren(...Store.d.categories.map(c => h('button', {
    class: 'cat-row' + (hidden.has(c.id) ? ' off' : ''), style: { '--c': c.color },
    title: hidden.has(c.id) ? 'Show in calendar' : 'Hide from calendar',
    onclick: () => Store.commit(hidden.has(c.id) ? `Showing ${c.name}` : `Hiding ${c.name}`, d => {
      d.hiddenCats = hidden.has(c.id) ? d.hiddenCats.filter(x => x !== c.id) : [...d.hiddenCats, c.id];
    }, { toast: false }),
  }, h('span', { class: 'cat-box' }, icon('check', 10)), h('span', null, c.name))));
}
