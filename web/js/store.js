'use strict';
/* The data model: settings, categories, events (with repeat rules), tasks, study plans and the Pomodoro log. */

function detectWeekStart() {
  try {
    const loc = new Intl.Locale(navigator.language || 'en-US');
    const info = loc.getWeekInfo ? loc.getWeekInfo() : loc.weekInfo;
    if (info && info.firstDay) return info.firstDay % 7;
  } catch { /* older engines */ }
  return 1;
}
function detect12h() {
  try {
    const hc = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return hc === 'h12' || hc === 'h11';
  } catch { return false; }
}

function defaultSettings() {
  return {
    theme: 'system',          // system | light | dark
    weekStart: detectWeekStart(),
    time12h: detect12h(),
    dayStart: 7,              // hour the day and week views scroll to
    hourHeight: 48,           // px per hour in the timeline (Ctrl+wheel to zoom)
    defaultDur: 60,
    defaultReminder: 10,
    showWeekends: true,
    notifyEvents: true,
    closeToTray: true,
    zoom: 1,
    view: 'week',
    showSidebar: true,
    showPanel: true,
    collapsedCards: [],
    panelOrder: [],           // right-panel card order; empty = default
    // Jogging weather location: none until you pick a city on the weather card.
    weather: { name: '', region: '', country: '', lat: null, lon: null, enabled: true },
    pomo: { focus: 25, short: 5, long: 15, longEvery: 4, autoBreak: true, autoFocus: false, sound: true, volume: 0.7, notify: true },
  };
}

function defaultData() {
  return {
    version: 1,
    settings: defaultSettings(),
    categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
    events: [],
    tasks: [],
    plans: [],
    pomoLog: [],
    pomo: null,
    hiddenCats: [],
    seeded: [],
  };
}

const uniq = arr => [...new Set(arr)];

function normalizeRule(r) {
  if (!r || !['daily', 'weekly', 'monthly', 'yearly'].includes(r.freq)) return null;
  const out = { freq: r.freq, interval: Math.max(1, Math.round(+r.interval || 1)) };
  if (r.freq === 'weekly') {
    const by = Array.isArray(r.byDay) ? uniq(r.byDay.map(Number).filter(n => n >= 0 && n <= 6)).sort() : [];
    if (by.length) out.byDay = by;
    out.wkst = r.wkst == null ? 1 : +r.wkst;
  }
  if (isYmd(r.until)) out.until = r.until;
  return out;
}

function normalizeEvent(e) {
  const ev = {
    id: String(e.id || uid('e')),
    title: String(e.title || ''),
    date: e.date,
    allDay: !!e.allDay,
    start: clamp(Math.round(+e.start || 0), 0, 1439),
    dur: Math.max(5, Math.round(+e.dur || 60)),
    days: Math.max(1, Math.round(+e.days || 1)),
    cat: e.cat || null,
    location: String(e.location || ''),
    notes: String(e.notes || ''),
    repeat: normalizeRule(e.repeat),
    exceptions: Array.isArray(e.exceptions) ? e.exceptions.filter(isYmd) : [],
    reminder: e.reminder == null || e.reminder === '' ? null : Math.max(0, Math.round(+e.reminder)),
  };
  if (e.seriesId) ev.seriesId = String(e.seriesId);
  return ev;
}

function normalizeTask(t) {
  return {
    id: String(t.id || uid('t')),
    title: String(t.title || ''),
    date: isYmd(t.date) ? t.date : todayYmd(),
    done: !!t.done,
    doneAt: t.doneAt || null,
    pomos: Math.max(0, Math.round(+t.pomos || 0)),
    created: t.created || Date.now(),
  };
}

function normalizePlan(p) {
  const plan = { ...p };
  plan.id = String(p.id || uid('plan'));
  plan.title = String(p.title || 'Plan');
  plan.steps = Array.isArray(p.steps) && p.steps.length ? p.steps : [{ name: 'Study', min: 60, text: '' }];
  plan.phases = Array.isArray(p.phases) && p.phases.length ? p.phases : [{ id: 'p1', title: '', intro: '', color: '#8B5CF6' }];
  plan.days = (Array.isArray(p.days) ? p.days : []).filter(d => d && isYmd(d.date)).map(d => {
    const day = { ...d, id: String(d.id || uid('d')), done: !!d.done };
    if (Array.isArray(d.items)) {
      // Optional checklist: the day counts as done once every item is ticked.
      day.items = d.items.filter(i => i && i.text).map((i, k) => ({ id: String(i.id || `${day.id}-${k + 1}`), text: String(i.text), done: !!i.done }));
      if (day.items.length) day.done = day.items.every(i => i.done);
      else delete day.items;
    }
    return day;
  });
  plan.time = p.time == null ? null : clamp(Math.round(+p.time), 0, 1439);
  plan.reminder = p.reminder == null ? null : Math.max(0, Math.round(+p.reminder));
  plan.hidden = !!p.hidden;
  return plan;
}

function normalizeData(raw) {
  const def = defaultData();
  if (!raw || typeof raw !== 'object') { def.health = normalizeHealth(null); return def; }
  const d = { ...def, ...raw };
  d.settings = { ...def.settings, ...(raw.settings || {}) };
  d.settings.pomo = { ...def.settings.pomo, ...((raw.settings || {}).pomo || {}) };
  for (const k of ['events', 'tasks', 'categories', 'pomoLog', 'plans', 'hiddenCats', 'seeded']) {
    if (!Array.isArray(d[k])) d[k] = def[k];
  }
  if (!d.categories.length) d.categories = def.categories;
  d.events = d.events.filter(e => e && isYmd(e.date)).map(normalizeEvent);
  d.tasks = d.tasks.filter(t => t && t.title).map(normalizeTask);
  d.plans = d.plans.filter(p => p && typeof p === 'object').map(normalizePlan);
  d.health = normalizeHealth(raw.health);
  if (!d.settings.weather || typeof d.settings.weather.lat !== 'number') d.settings.weather = def.settings.weather;
  return d;
}

/** Adds bundled plans (and their events) the first time this data file meets them. Returns the added titles. */
function applySeeds(d) {
  const added = [];
  for (const seed of SEED_PLANS) {
    if (d.seeded.includes(seed.id)) continue;
    const plan = structuredClone(seed);
    const events = plan.seedEvents || [];
    delete plan.seedEvents;
    if (!d.plans.some(p => p.id === plan.id)) d.plans.push(normalizePlan(plan));
    for (const ev of events) {
      if (ev.cat && !d.categories.some(c => c.id === ev.cat)) {
        const def = DEFAULT_CATEGORIES.find(c => c.id === ev.cat);
        if (def) d.categories.push({ ...def });
      }
      if (!d.events.some(e => e.id === ev.id)) d.events.push(normalizeEvent(ev));
    }
    d.seeded.push(seed.id);
    added.push(seed.title);
  }
  return added;
}

const Store = {
  d: null,
  undoStack: [],
  justSeeded: [],

  init(boot) {
    const fresh = !boot.data;
    this.healthNew = !boot.data || !boot.data.health;
    this.d = normalizeData(boot.data);
    this.justSeeded = applySeeds(this.d);
    if (fresh || this.justSeeded.length || this.healthNew) this.persist();
  },

  persist() { Host.save(JSON.stringify(this.d, null, 1)); },

  snapshot() {
    const { events, tasks, categories, plans, hiddenCats, health } = this.d;
    return JSON.stringify({ events, tasks, categories, plans, hiddenCats, health });
  },

  /** An undoable change: snapshot, apply, save, re-render, and offer Undo. */
  commit(label, fn, opts = {}) {
    const snap = this.snapshot();
    const result = fn(this.d);
    const entry = { label, snap };
    this.undoStack.push(entry);
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.persist();
    App.render();
    if (label && opts.toast !== false) toast(label, { action: 'Undo', onAction: () => this.undo(entry) });
    return result;
  },

  /** A change that is saved but not undoable (settings, timer state). */
  quiet(fn) {
    const result = fn ? fn(this.d) : undefined;
    this.persist();
    return result;
  },

  /** Undoes the latest change. From a toast, `entry` must still be the latest, or newer changes would be lost too. */
  undo(entry) {
    if (entry && this.undoStack[this.undoStack.length - 1] !== entry) {
      toast('Newer changes were made since then. Press Ctrl+Z to step back one change at a time.');
      return;
    }
    const u = this.undoStack.pop();
    if (!u) { toast('Nothing to undo'); return; }
    Object.assign(this.d, JSON.parse(u.snap));
    this.persist();
    closeAllModals();
    App.render();
    clearToasts();
    toast('Undone: ' + u.label.charAt(0).toLowerCase() + u.label.slice(1));
  },
};

// ── Categories ──────────────────────────────────────────────────────────
function catById(id) { return Store.d.categories.find(c => c.id === id) || null; }
function catColor(id) { const c = catById(id); return c ? c.color : '#8A8F9C'; }
function defaultCatId() {
  const c = catById('c-personal') || Store.d.categories[0];
  return c ? c.id : null;
}

// ── Repeat rules ────────────────────────────────────────────────────────
function occursOn(ev, dn) {
  const start = dayNum(ev.date);
  if (dn < start) return false;
  const r = ev.repeat;
  if (!r) return dn === start;
  if (r.until && dn > dayNum(r.until)) return false;
  const iv = Math.max(1, r.interval || 1);
  let hit = false;
  switch (r.freq) {
    case 'daily':
      hit = (dn - start) % iv === 0;
      break;
    case 'weekly': {
      const by = r.byDay && r.byDay.length ? r.byDay : [dowOfNum(start)];
      if (!by.includes(dowOfNum(dn))) return false;
      if (iv === 1) { hit = true; break; }
      const ws = r.wkst == null ? 1 : r.wkst;
      const w0 = start - ((dowOfNum(start) - ws + 7) % 7);
      const w1 = dn - ((dowOfNum(dn) - ws + 7) % 7);
      hit = ((w1 - w0) / 7) % iv === 0;
      break;
    }
    case 'monthly': {
      const [y0, m0, d0] = ymdParts(ev.date), [y1, m1, d1] = ymdParts(fromDayNum(dn));
      hit = d1 === d0 && ((y1 - y0) * 12 + (m1 - m0)) % iv === 0;
      break;
    }
    case 'yearly': {
      const [y0, m0, d0] = ymdParts(ev.date), [y1, m1, d1] = ymdParts(fromDayNum(dn));
      hit = m1 === m0 && d1 === d0 && (y1 - y0) % iv === 0;
      break;
    }
  }
  return hit && !(ev.exceptions && ev.exceptions.length && ev.exceptions.includes(fromDayNum(dn)));
}

function describeRule(r, date) {
  if (!r) return 'Does not repeat';
  const iv = r.interval || 1;
  const every = (one, many) => (iv === 1 ? `Every ${one}` : `Every ${iv} ${many}`);
  let s;
  switch (r.freq) {
    case 'daily': s = every('day', 'days'); break;
    case 'weekly': {
      const by = r.byDay && r.byDay.length ? r.byDay : [dowOf(date)];
      const names = by.join() === '1,2,3,4,5' ? 'weekdays' : by.map(i => WEEKDAYS_SHORT[i]).join(', ');
      s = (iv === 1 ? 'Weekly' : `Every ${iv} weeks`) + ' on ' + names;
      break;
    }
    case 'monthly': s = (iv === 1 ? 'Monthly' : `Every ${iv} months`) + ` on day ${ymdParts(date)[2]}`; break;
    case 'yearly': s = (iv === 1 ? 'Annually' : `Every ${iv} years`) + ` on ${fmtMonthDay(date)}`; break;
    default: s = 'Repeats';
  }
  if (r.until) s += `, until ${fmtShortMonthDay(r.until)}`;
  return s;
}

// ── Occurrences: everything that lands on the calendar between two dates ──
function eventOcc(ev, date) {
  return {
    kind: 'event', ev, key: ev.id + '@' + date, date,
    allDay: !!ev.allDay,
    start: ev.allDay ? 0 : ev.start,
    dur: ev.allDay ? (ev.days || 1) * 1440 : ev.dur,
    color: catColor(ev.cat),
    title: ev.title,
  };
}

function expandEvents(from, to) {
  const out = [], f = dayNum(from), t = dayNum(to);
  for (const ev of Store.d.events) {
    const span = ev.allDay ? (ev.days || 1) - 1 : Math.floor((ev.start + ev.dur - 1) / 1440);
    const s = dayNum(ev.date);
    if (s > t) continue;
    if (!ev.repeat) {
      if (s + span >= f) out.push(eventOcc(ev, ev.date));
      continue;
    }
    const until = ev.repeat.until ? dayNum(ev.repeat.until) : Infinity;
    const lo = Math.max(s, f - span), hi = Math.min(t, until);
    for (let dn = lo; dn <= hi; dn++) if (occursOn(ev, dn)) out.push(eventOcc(ev, fromDayNum(dn)));
  }
  return out;
}

function planSteps(plan, day) { return day && Array.isArray(day.steps) && day.steps.length ? day.steps : plan.steps; }
function planDur(plan, day) { return planSteps(plan, day).reduce((a, s) => a + (+s.min || 0), 0) || 60; }
function planPhase(plan, day) { return plan.phases.find(p => p.id === day.phase) || plan.phases[0]; }
function planById(id) { return Store.d.plans.find(p => p.id === id) || null; }
function planDaysSorted(plan) { return [...plan.days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)); }
function planExamEvent(plan) { return plan.exam && plan.exam.eventId ? Store.d.events.find(e => e.id === plan.exam.eventId) || null : null; }
function planExamDate(plan) { const ev = planExamEvent(plan); return ev ? ev.date : (plan.exam && plan.exam.date) || null; }
function planDayTime(plan, day) { return day.time != null ? day.time : plan.time; }

/** Checklist progress for a plan day, or null when the day has no checklist. */
function planDayProgress(day) {
  if (!day.items || !day.items.length) return null;
  return { done: day.items.filter(i => i.done).length, total: day.items.length };
}
/** Ticks or unticks a whole day (and every item on its checklist). */
function setPlanDayDone(day, done) {
  day.done = done;
  day.doneAt = done ? Date.now() : null;
  if (day.items) day.items.forEach(i => { i.done = done; });
}
/** Ticks one checklist item; the day follows once all of its items agree. */
function setPlanItemDone(day, itemId, done) {
  const item = day.items && day.items.find(i => i.id === itemId);
  if (!item) return;
  item.done = done;
  const all = day.items.every(i => i.done);
  if (all !== day.done) { day.done = all; day.doneAt = all ? Date.now() : null; }
}

function planOcc(plan, day) {
  const phase = planPhase(plan, day);
  const time = planDayTime(plan, day);
  return {
    kind: 'plan', plan, day, phase,
    key: 'plan:' + plan.id + ':' + day.id,
    date: day.date,
    allDay: time == null,
    start: time == null ? 0 : time,
    dur: time == null ? 1440 : planDur(plan, day),
    color: (phase && phase.color) || '#8B5CF6',
    title: day.title,
    label: (plan.short ? plan.short + ' · ' : '') + day.title,
    done: !!day.done,
  };
}

function expandPlans(from, to) {
  const out = [];
  for (const plan of Store.d.plans) {
    if (plan.hidden) continue;
    for (const day of plan.days) if (day.date >= from && day.date <= to) out.push(planOcc(plan, day));
  }
  return out;
}

function occurrences(from, to) {
  const hidden = new Set(Store.d.hiddenCats);
  const evs = expandEvents(from, to).filter(o => !hidden.has(o.ev.cat));
  return evs.concat(expandPlans(from, to), expandWorkouts(from, to));
}

// ── Changing events (with repeat-series rules) ──────────────────────────
/** Moves a repeat rule along with its series when the series is shifted by `delta` days. */
function shiftRule(rule, delta, fromEditor) {
  const r = { ...rule };
  if (!delta || fromEditor) return r;
  if (r.until) r.until = addDays(r.until, delta);
  if (r.freq === 'weekly' && r.byDay && r.byDay.length) r.byDay = uniq(r.byDay.map(x => (((x + delta) % 7) + 7) % 7)).sort();
  return r;
}

/**
 * Applies `patch` to one occurrence. For a repeating event, scope is
 * 'one' (detach just this day), 'following' (split the series here) or 'all'.
 */
function applyEventChange(occ, patch, scope) {
  const d = Store.d, ev = occ.ev;
  if (!ev.repeat) {
    Object.assign(ev, patch);
    if (!ev.repeat) ev.exceptions = [];
    return ev;
  }

  if (scope === 'one') {
    ev.exceptions = uniq([...(ev.exceptions || []), occ.date]);
    const copy = Object.assign(structuredClone(ev), { id: uid('e'), seriesId: ev.id, date: occ.date, exceptions: [] }, patch, { repeat: null });
    d.events.push(copy);
    return copy;
  }

  const delta = patch.date ? diffDays(occ.date, patch.date) : 0;
  const fromEditor = Object.prototype.hasOwnProperty.call(patch, 'repeat');
  const rule = fromEditor ? patch.repeat : ev.repeat;

  if (scope === 'following' && occ.date !== ev.date) {
    const next = Object.assign(structuredClone(ev), patch, { id: uid('e'), date: addDays(occ.date, delta) });
    next.repeat = rule ? shiftRule(rule, delta, fromEditor) : null;
    next.exceptions = next.repeat ? (ev.exceptions || []).filter(x => x >= occ.date).map(x => addDays(x, delta)) : [];
    delete next.seriesId;
    ev.repeat = { ...ev.repeat, until: addDays(occ.date, -1) };
    ev.exceptions = (ev.exceptions || []).filter(x => x < occ.date);
    d.events.push(next);
    return next;
  }

  // All events: keep the series together, shifting it if this occurrence moved to another day.
  const newDate = addDays(ev.date, delta);
  const newRule = rule ? shiftRule(rule, delta, fromEditor) : null;
  const oldExceptions = ev.exceptions || [];
  Object.assign(ev, patch, { date: newDate, repeat: newRule });
  ev.exceptions = newRule ? oldExceptions.map(x => addDays(x, delta)) : [];
  return ev;
}

function deleteOccurrence(occ, scope) {
  const d = Store.d, ev = occ.ev;
  if (!ev.repeat || scope === 'all' || (scope === 'following' && occ.date === ev.date)) {
    d.events = d.events.filter(e => e !== ev && !(ev.repeat && e.seriesId === ev.id));
    return;
  }
  if (scope === 'one') {
    ev.exceptions = uniq([...(ev.exceptions || []), occ.date]);
    return;
  }
  ev.repeat = { ...ev.repeat, until: addDays(occ.date, -1) };
  ev.exceptions = (ev.exceptions || []).filter(x => x < occ.date);
}

// ── Tasks ───────────────────────────────────────────────────────────────
function taskOrder(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.done) return (a.doneAt || 0) - (b.doneAt || 0);
  return (a.created || 0) - (b.created || 0);
}
function tasksOn(date) { return Store.d.tasks.filter(t => t.date === date).sort(taskOrder); }
function overdueTasks(today) { return Store.d.tasks.filter(t => !t.done && t.date < today).sort((a, b) => (a.date < b.date ? -1 : 1)); }
