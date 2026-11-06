'use strict';
/*
 * Daily health: medicines, water and the workout program. Pure rules and data only (no DOM),
 * so tests can run it under Node. The UI lives in health.js, the forecast in weather.js.
 */

const HEALTH_COLORS = { meds: '#9085E9', water: '#3987E5', workout: '#1BAF7A' };
const FLASK_ML = 1005; // a 34 oz Aquaflask

/**
 * Defaults for a new user. Medicines start empty (everyone adds their own); water and the
 * workout program start with sensible defaults that can all be changed on the Health page.
 */
function defaultHealth() {
  return {
    meds: [],
    medLog: {},
    medReminders: true,
    water: { flaskMl: FLASK_ML, unit: 'flask', goal: 3, workoutExtra: 0.5, hotExtra: 0.5, reminders: true },
    waterLog: {},
    workout: {
      start: todayYmd(), time: 18 * 60, reminders: true, showInCalendar: true, log: {},
      week: WORKOUT_WEEK.slice(), // routine id per weekday (0 = Sunday)
      custom: {},                 // edited built-in routines and the user's own, by id
    },
  };
}

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** Keeps the last ~4 months of a date-keyed log so data.json stays small. */
function pruneLog(log, keepDays = 120) {
  const out = {};
  if (!isPlainObject(log)) return out;
  const cutoff = addDays(todayYmd(), -keepDays);
  for (const k of Object.keys(log)) if (isYmd(k) && k >= cutoff) out[k] = log[k];
  return out;
}

function normalizeHealth(h) {
  const def = defaultHealth();
  if (!isPlainObject(h)) return def;
  const meds = Array.isArray(h.meds) ? h.meds.filter(m => m && String(m.name || '').trim()).map(m => ({
    id: String(m.id || uid('med')),
    name: String(m.name).trim(),
    dose: String(m.dose || '').trim(),
    note: String(m.note || '').trim(),
    times: uniq((Array.isArray(m.times) && m.times.length ? m.times : [480]).map(t => clamp(Math.round(+t || 0), 0, 1439))).sort((a, b) => a - b),
  })) : def.meds;
  const workout = { ...def.workout, ...(isPlainObject(h.workout) ? h.workout : {}) };
  if (!isYmd(workout.start)) workout.start = def.workout.start;
  workout.time = clamp(Math.round(+workout.time || 0), 0, 1439);
  workout.log = pruneLog(workout.log);
  workout.custom = {};
  if (isPlainObject(h.workout && h.workout.custom)) {
    for (const [id, r] of Object.entries(h.workout.custom)) {
      if (!isPlainObject(r) || !String(r.title || '').trim()) continue;
      workout.custom[id] = {
        title: String(r.title).trim(),
        short: String(r.short || r.title).trim(),
        user: !!r.user,
        items: (Array.isArray(r.items) ? r.items : []).map(String).map(s => s.trim()).filter(Boolean),
        steps: (Array.isArray(r.steps) ? r.steps : []).filter(s => s && s.name && +s.min > 0)
          .map(s => ({ name: String(s.name), min: +s.min, ...(s.round ? { round: +s.round, rounds: +s.rounds } : {}) })),
      };
    }
  }
  const known = new Set([...BUILTIN_ROUTINES.map(r => r.id), ...Object.keys(workout.custom)]);
  const week = Array.isArray(h.workout && h.workout.week) && h.workout.week.length === 7 ? h.workout.week : WORKOUT_WEEK;
  workout.week = week.map(id => (known.has(id) ? id : 'rest'));
  const water = { ...def.water, ...(isPlainObject(h.water) ? h.water : {}) };
  water.goal = clamp(+water.goal || 3, 0.5, 8);
  water.flaskMl = clamp(Math.round(+water.flaskMl || FLASK_ML), 100, 3000);
  water.unit = String(water.unit || 'flask').trim().slice(0, 20) || 'flask';
  return {
    meds,
    medLog: pruneLog(h.medLog),
    medReminders: h.medReminders !== false,
    water,
    waterLog: pruneLog(h.waterLog),
    workout,
  };
}

// ── Medicines ───────────────────────────────────────────────────────────
function medLabel(med) { return med.dose ? `${med.name} ${med.dose}` : med.name; }
function doseKey(med, time) { return `${med.id}@${time}`; }

/** Today's doses grouped by reminder time: [{ time, doses: [{ med, key, taken }] }]. */
function doseGroups(date) {
  const H = Store.d.health, log = H.medLog[date] || {};
  const byTime = new Map();
  for (const med of H.meds) {
    for (const t of med.times) {
      if (!byTime.has(t)) byTime.set(t, []);
      const key = doseKey(med, t);
      byTime.get(t).push({ med, key, taken: log[key] || null });
    }
  }
  return [...byTime].sort((a, b) => a[0] - b[0]).map(([time, doses]) => ({ time, doses }));
}
function medProgress(date) {
  let taken = 0, total = 0;
  for (const g of doseGroups(date)) for (const d of g.doses) { total++; if (d.taken) taken++; }
  return { taken, total };
}
function setDoseTaken(date, key, taken) {
  const H = Store.d.health;
  const day = { ...(H.medLog[date] || {}) };
  if (taken) day[key] = Date.now(); else delete day[key];
  if (Object.keys(day).length) H.medLog[date] = day; else delete H.medLog[date];
}

// ── Water ───────────────────────────────────────────────────────────────
const roundQuarter = n => Math.round(n * 4) / 4;
function waterOn(date) { return +(Store.d.health.waterLog[date] || 0); }
function setWater(date, flasks) {
  const v = clamp(roundQuarter(flasks), 0, 12);
  if (v) Store.d.health.waterLog[date] = v; else delete Store.d.health.waterLog[date];
}
/** "1½", "2¼", "3" — quarters of a flask read better as fractions. */
function fmtFlasks(n) {
  const whole = Math.floor(n + 1e-9), frac = Math.round((n - whole) * 4);
  const f = ['', '¼', '½', '¾'][frac] || '';
  return (whole || !f ? String(whole) : '') + f;
}
/** The container's name, "flask" / "flasks" by default; plural for anything but exactly one. */
function waterUnit(n) {
  const u = (Store.d.health && Store.d.health.water.unit) || 'flask';
  return n === 1 ? u : /(s|sh|ch|x)$/i.test(u) ? u + 'es' : u + 's';
}
function fmtLitres(flasks, flaskMl = Store.d.health.water.flaskMl) {
  return (flasks * flaskMl / 1000).toFixed(1) + ' L';
}
/**
 * The day's goal: the base, plus half a flask on workout days and half on hot days
 * (feels-like 33 °C or more). `maxFeels` comes from the forecast when there is one.
 */
function waterGoal(date, maxFeels = null) {
  const W = Store.d.health.water;
  const parts = [{ label: 'Daily base', amount: W.goal }];
  const w = workoutFor(date);
  if (w && w.type !== 'rest' && W.workoutExtra) parts.push({ label: `Workout day (${w.short})`, amount: W.workoutExtra });
  if (maxFeels != null && maxFeels >= 33 && W.hotExtra) parts.push({ label: `Hot day (feels up to ${Math.round(maxFeels)}°C)`, amount: W.hotExtra });
  return { flasks: parts.reduce((a, p) => a + p.amount, 0), parts };
}
/** Spread the goal over the day: a third by 11 AM, two thirds by 3 PM, all of it by 7 PM. */
function waterCheckpoints(goal) {
  return [
    { time: 11 * 60, target: roundQuarter(goal / 3) },
    { time: 15 * 60, target: roundQuarter((goal * 2) / 3) },
    { time: 19 * 60, target: goal },
  ];
}

// ── Workout program ─────────────────────────────────────────────────────
// The default week. Index = weekday (0 = Sunday). Users can change it on the Health page.
const WORKOUT_WEEK = ['rest', 'A', 'hiit', 'B', 'jog', 'A', 'hiitcore'];
const BUILTIN_ROUTINES = [
  { id: 'A', title: 'Strength A + pull-ups', short: 'Strength A' },
  { id: 'B', title: 'Strength B + pull-ups', short: 'Strength B' },
  { id: 'hiit', title: 'HIIT intervals', short: 'HIIT' },
  { id: 'hiitcore', title: 'HIIT + core', short: 'HIIT + core' },
  { id: 'jog', title: 'Walk-jog intervals', short: 'Walk-jog' },
  { id: 'rest', title: 'Rest day', short: 'Rest' },
];
const WORKOUT_PHASES = [
  { from: 1, to: 2, name: 'Foundation', hang: '3 × 15–30 s', scap: '3 × 6–8', neg: '3 × 3, lowering for 3 s', flex: '3 × 5–10 s',
    push: '3 × 6–10 (hands on a bed or table if needed)', squat: '3 × 12–15', plank: '3 × 20–30 s', rounds: 6, on: 20, off: 40, jog: { on: 1, off: 2, reps: 8 } },
  { from: 3, to: 4, name: 'Build', hang: '3 × 30–45 s', scap: '3 × 8–10', neg: '3 × 4, lowering for 5 s', flex: '3 × 10–15 s',
    push: '3 × 8–12', squat: '3 × 15–20', plank: '3 × 30–45 s', rounds: 8, on: 30, off: 30, jog: { on: 2, off: 2, reps: 7 } },
  { from: 5, to: 6, name: 'Strength', attempt: true, hang: '3 × 45–60 s', scap: '3 × 10', neg: '4 × 4, lowering for 5–8 s', flex: '3 × 15–20 s',
    push: '4 × 10–12', squat: '4 × 15–20', plank: '3 × 45–60 s', rounds: 10, on: 30, off: 30, jog: { on: 3, off: 1, reps: 7 } },
  { from: 7, to: null, name: 'First pull-up', attempt: true, hang: '3 × 60 s', scap: '3 × 10–12', neg: '4 × 5, lowering for 8 s', flex: '3 × 20–30 s',
    push: '4 × 12–15', squat: '4 × 20', plank: '3 × 60 s', rounds: 10, on: 40, off: 20, jog: { on: 20, off: 0, reps: 1 } },
];

function workoutWeek(date, start) { return Math.floor(diffDays(start, date) / 7) + 1; }
function workoutPhase(week) {
  return WORKOUT_PHASES.find(p => week >= p.from && (p.to == null || week <= p.to)) || WORKOUT_PHASES[0];
}

/** Builds one day of the program: title, checklist items and timer steps. */
function buildWorkout(type, ph, week) {
  const warm = { id: 'warm', text: 'Warm-up 5 min: arm circles, 10 squats, 5 inchworms, 1 min of easy jumping jacks' };
  const tryOne = ph.attempt ? [{ id: 'try', text: 'Try 1 strict pull-up first, while you are fresh' }] : [];
  const strengthSteps = [
    { name: 'Warm-up', min: 5, text: 'Arm circles, squats, inchworms, easy jumping jacks.' },
    { name: 'Strength', min: 25, text: 'Work down the checklist. Rest 60–90 s between sets.' },
    { name: 'Cool-down', min: 5, text: 'Stretch chest, lats, hips and hamstrings.' },
  ];
  const intervals = (count, on, off, hard, easy) => {
    const steps = [];
    for (let r = 1; r <= count; r++) {
      steps.push({ name: hard, min: on, round: r, rounds: count, text: '' });
      if (off > 0) steps.push({ name: easy, min: off, round: r, rounds: count, text: '' });
    }
    return steps;
  };
  const hiitSteps = (extra) => [
    { name: 'Warm-up', min: 4, text: 'March in place, easy jumping jacks, arm swings.' },
    ...intervals(ph.rounds, ph.on / 60, ph.off / 60, 'Hard', 'Easy'),
    ...(extra || []),
    { name: 'Cool-down', min: 4, text: 'Walk, then stretch.' },
  ];
  const hiitItems = [
    { id: 'warm', text: 'Warm-up 4 min: march in place, easy jumping jacks, arm swings' },
    { id: 'int', text: `${ph.rounds} rounds of ${ph.on} s hard, ${ph.off} s easy. Rotate fast squats, mountain climbers, step-back burpees and high knees` },
  ];
  const sum = steps => Math.round(steps.reduce((a, s) => a + s.min, 0));
  let w;
  switch (type) {
    case 'A':
      w = { title: 'Strength A + pull-ups', short: 'Strength A', steps: strengthSteps, items: [warm, ...tryOne,
        { id: 'hang', text: `Dead hang ${ph.hang}` },
        { id: 'scap', text: `Scapular pulls ${ph.scap}: hang, then pull your shoulder blades down without bending your arms` },
        { id: 'neg', text: `Negative pull-ups ${ph.neg}: jump or step up to chin over the bar, then lower as slowly as you can` },
        { id: 'push', text: `Push-ups ${ph.push}` },
        { id: 'squat', text: `Squats ${ph.squat}` },
        { id: 'plank', text: `Plank ${ph.plank}` }] };
      break;
    case 'B':
      w = { title: 'Strength B + pull-ups', short: 'Strength B', steps: strengthSteps, items: [warm, ...tryOne,
        { id: 'flex', text: `Flexed-arm hang ${ph.flex}: jump to chin over the bar and hold` },
        { id: 'hang', text: `Dead hang ${ph.hang}` },
        { id: 'row', text: 'Backpack rows 3 × 10–12: hinge at the hips and pull a loaded backpack to your ribs' },
        { id: 'lunge', text: 'Reverse lunges 3 × 10 each leg' },
        { id: 'bridge', text: 'Glute bridges 3 × 15' },
        { id: 'bug', text: 'Dead bugs 3 × 10 each side' }] };
      break;
    case 'hiit':
      w = { title: 'HIIT intervals', short: 'HIIT', steps: hiitSteps(), items: [...hiitItems,
        { id: 'cool', text: 'Cool-down 4 min: walk, then stretch' },
        { id: 'steps', text: 'Walk enough today to pass 8,000 steps' }] };
      break;
    case 'hiitcore':
      w = { title: 'HIIT + core', short: 'HIIT + core',
        steps: hiitSteps([{ name: 'Core', min: 6, text: 'Plank 40 s, side plank 20 s each side, 10 dead bugs each side. Twice.' }]),
        items: [...hiitItems,
          { id: 'core', text: 'Core, twice through: plank 40 s, side plank 20 s each side, 10 dead bugs each side' },
          { id: 'cool', text: 'Cool-down 4 min: walk, then stretch' }] };
      break;
    case 'jog': {
      const j = ph.jog;
      const main = j.reps > 1 ? intervals(j.reps, j.on, j.off, 'Jog', 'Walk') : [{ name: 'Jog', min: j.on, text: 'Easy pace: you can still talk.' }];
      w = { title: j.reps > 1 ? 'Walk-jog intervals' : 'Easy jog', short: j.reps > 1 ? 'Walk-jog' : 'Easy jog',
        steps: [{ name: 'Walk', min: 5, text: 'Brisk walk to warm up, then leg swings and ankle circles.' }, ...main, { name: 'Cool-down', min: 5, text: 'Walk, then stretch calves, quads and hamstrings.' }],
        items: [
          { id: 'weather', text: 'Check the jogging weather and go at the best time' },
          { id: 'warm', text: 'Warm-up: walk 5 min, then leg swings and ankle circles' },
          { id: 'int', text: j.reps > 1 ? `${j.reps} rounds: jog ${j.on} min easy, walk ${j.off} min` : `Jog ${j.on} min at an easy pace (you can still talk)` },
          { id: 'cool', text: 'Cool-down: walk 5 min, then stretch calves, quads and hamstrings' }] };
      break;
    }
    default:
      w = { title: 'Rest day', short: 'Rest', steps: [], items: [
        { id: 'rest', text: 'Rest. An easy walk is fine' },
        { id: 'water', text: 'Keep up your water' }] };
  }
  return { type, week, phase: ph, ...w, min: sum(w.steps) };
}

/** A routine the user wrote or edited: fixed checklist and timer steps (no automatic progression). */
function buildCustomWorkout(id, c, week) {
  const steps = c.steps.map(s => ({ ...s, text: s.text || '' }));
  return {
    type: id, custom: true, user: !!c.user, week, phase: workoutPhase(week),
    title: c.title, short: c.short || c.title,
    items: c.items.map((text, i) => ({ id: 'c' + (i + 1), text })),
    steps, min: Math.round(steps.reduce((a, s) => a + s.min, 0)),
  };
}

function workoutFor(date) {
  const W = Store.d.health.workout;
  if (!isYmd(date) || date < W.start) return null;
  const week = workoutWeek(date, W.start);
  const id = (W.week && W.week[dowOf(date)]) || WORKOUT_WEEK[dowOf(date)];
  if (W.custom && W.custom[id]) return buildCustomWorkout(id, W.custom[id], week);
  return buildWorkout(BUILTIN_ROUTINES.some(r => r.id === id) ? id : 'rest', workoutPhase(week), week);
}

/** Every routine the week can use: the built-ins (edited or not) and the user's own. */
function routineList() {
  const W = Store.d.health.workout;
  const out = BUILTIN_ROUTINES.map(r => {
    const c = W.custom[r.id];
    return { id: r.id, title: c ? c.title : r.title, short: c ? c.short : r.short, builtin: true, edited: !!c };
  });
  for (const [id, c] of Object.entries(W.custom)) if (c.user) out.push({ id, title: c.title, short: c.short, builtin: false, edited: true });
  return out;
}

/** A routine as it would run in a given week (used to prefill the editor). */
function routineAt(id, week) {
  const W = Store.d.health.workout;
  if (W.custom[id]) return buildCustomWorkout(id, W.custom[id], week);
  return buildWorkout(id, workoutPhase(week), week);
}

// Timer steps as editable text, one per line: "Warm-up 5", "Plank 45s", "6 x 20s Hard / 40s Easy".
function fmtStepLen(min) {
  const s = Math.round(min * 60);
  if (s < 60 || s % 60) return s + 's';
  return String(s / 60);
}
function stepsToText(steps) {
  const lines = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.round) {
      const next = steps[i + 1] && steps[i + 1].round === s.round && steps[i + 1].name !== s.name ? steps[i + 1] : null;
      lines.push(`${s.rounds} x ${fmtStepLen(s.min)} ${s.name}` + (next ? ` / ${fmtStepLen(next.min)} ${next.name}` : ''));
      while (i + 1 < steps.length && steps[i + 1].round) i++;
    } else lines.push(`${s.name} ${fmtStepLen(s.min)}`);
  }
  return lines.join('\n');
}
/** Parses the timer text. Returns { steps } or { error } naming the line that could not be read. */
function parseStepsText(text) {
  const toMin = (v, unit) => (/^s/i.test(unit || '') ? +v / 60 : +v);
  const steps = [];
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const iv = line.match(/^(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(s|sec|m|min)?\s+([^/]+?)\s*(?:\/\s*(\d+(?:\.\d+)?)\s*(s|sec|m|min)?\s+(.+))?$/i);
    if (iv) {
      const rounds = +iv[1], onMin = toMin(iv[2], iv[3]), offMin = iv[5] ? toMin(iv[5], iv[6]) : 0;
      if (rounds < 1 || rounds > 50 || onMin <= 0) return { error: `Line ${n + 1}: "${line}"` };
      for (let r = 1; r <= rounds; r++) {
        steps.push({ name: iv[4].trim(), min: onMin, round: r, rounds });
        if (offMin > 0) steps.push({ name: iv[7].trim(), min: offMin, round: r, rounds });
      }
      continue;
    }
    const st = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*(s|sec|m|min)?$/i);
    if (st && toMin(st[2], st[3]) > 0) { steps.push({ name: st[1].trim(), min: toMin(st[2], st[3]) }); continue; }
    return { error: `Line ${n + 1}: "${line}"` };
  }
  if (steps.length > 120) return { error: 'That is more than 120 timer steps.' };
  return { steps };
}
function workoutLog(date) { return Store.d.health.workout.log[date] || { items: {}, done: false }; }
function workoutProgress(date) {
  const w = workoutFor(date);
  if (!w) return null;
  const log = workoutLog(date);
  return { done: w.items.filter(i => log.items[i.id]).length, total: w.items.length, complete: !!log.done };
}
function setWorkoutItem(date, itemId, on) {
  const w = workoutFor(date);
  if (!w) return;
  const W = Store.d.health.workout;
  const log = { items: { ...workoutLog(date).items }, done: false };
  if (on) log.items[itemId] = true; else delete log.items[itemId];
  log.done = w.items.every(i => log.items[i.id]);
  W.log[date] = log;
}
function setWorkoutDone(date, done) {
  const w = workoutFor(date);
  if (!w) return;
  const items = {};
  if (done) w.items.forEach(i => { items[i.id] = true; });
  Store.d.health.workout.log[date] = { items, done };
}

/** Workout blocks for the calendar (rest days are left out). */
function expandWorkouts(from, to) {
  const H = Store.d.health;
  if (!H || !H.workout.showInCalendar || Store.d.hiddenCats.includes('c-health')) return [];
  const out = [];
  for (let dn = dayNum(from); dn <= dayNum(to); dn++) {
    const date = fromDayNum(dn);
    const w = workoutFor(date);
    if (!w || w.type === 'rest') continue;
    out.push({
      kind: 'workout', key: 'workout:' + date, date, workout: w,
      allDay: false, start: H.workout.time, dur: Math.max(15, w.min),
      color: HEALTH_COLORS.workout, title: w.short, label: `Workout · ${w.title}`,
      done: !!workoutLog(date).done,
    });
  }
  return out;
}

// ── Reminders handed to the host ────────────────────────────────────────
function healthReminders(now = Date.now()) {
  const H = Store.d.health, today = todayYmd(), items = [];
  if (H.medReminders) {
    for (const date of [today, addDays(today, 1)]) {
      for (const g of doseGroups(date)) {
        const missing = g.doses.filter(d => !d.taken);
        if (!missing.length) continue;
        const at = tsOf(date, g.time);
        const names = missing.map(d => medLabel(d.med) + (d.med.note ? ` (${d.med.note.toLowerCase()})` : '')).join(', ');
        items.push({ key: `med:${date}:${g.time}`, at, title: `Medicines · ${fmtTime(g.time)}`, body: names });
        items.push({ key: `med-again:${date}:${g.time}`, at: at + 60 * 60000, title: 'Medicines still to take', body: names });
      }
    }
  }
  if (H.water.reminders) {
    const goal = waterGoal(today, typeof Weather !== 'undefined' ? Weather.maxFeels(today) : null).flasks;
    const have = waterOn(today);
    for (const cp of waterCheckpoints(goal)) {
      if (have >= cp.target) continue;
      items.push({
        key: `water:${today}:${cp.time}`, at: tsOf(today, cp.time - 60), title: 'Water',
        body: `You're at ${fmtFlasks(have)} of ${fmtFlasks(goal)} ${waterUnit(goal)}. Aim for ${fmtFlasks(cp.target)} by ${fmtTime(cp.time)}.`,
      });
    }
  }
  if (H.workout.reminders) {
    const w = workoutFor(today);
    if (w && w.type !== 'rest' && !workoutLog(today).done) {
      items.push({ key: `workout:${today}`, at: tsOf(today, H.workout.time), title: `Workout · ${w.title}`, body: `${w.min} minutes. Open Planner to start the timer.` });
    }
  }
  return items.filter(r => r.at >= now - 60000);
}
