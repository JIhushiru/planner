'use strict';
/* Daily health UI: the right-panel card, the Health page, the workout dialog and the editors. */

const HealthUI = { editingMeds: false, editingProgram: false };

// ── Shared bits ─────────────────────────────────────────────────────────
function collapsibleHead(key, title, collapsed, ...right) {
  return h('div', { class: 'card-h study-head' },
    h('button', {
      class: 'study-toggle', 'aria-expanded': String(!collapsed), title: collapsed ? 'Show' : 'Hide',
      onclick: () => toggleCardCollapsed(key),
    }, icon(collapsed ? 'chevronRight' : 'chevronDown', 14), h('span', { class: 'card-title' }, title)),
    h('div', { class: 'card-h-right' }, ...right));
}

function toggleCardCollapsed(key) {
  const S = Store.d.settings;
  const set = new Set(S.collapsedCards || []);
  if (set.has(key)) set.delete(key); else set.add(key);
  S.collapsedCards = [...set];
  Store.quiet();
  renderHealthCard();
  renderWeatherCard();
}

let flaskSeq = 0;
/** A drawn bottle: `level` 0..1 is how full it is; `mark` (0..1) draws a dashed line for a part-bottle goal. */
function flaskSvg(level, mark, height) {
  const id = 'fl' + (++flaskSeq);
  const top = 9, body = 35;
  const fillH = body * clamp(level, 0, 1);
  const markY = mark != null ? top + body * (1 - mark) : null;
  const wrap = document.createElement('span');
  wrap.className = 'flask';
  wrap.innerHTML = `<svg viewBox="0 0 26 46" width="${Math.round(height * 26 / 46)}" height="${height}" aria-hidden="true">
    <defs><clipPath id="${id}"><rect x="2" y="${top}" width="22" height="${body}" rx="6"/></clipPath></defs>
    <rect class="fl-cap" x="7.5" y="1.5" width="11" height="5.5" rx="2"/>
    <rect class="fl-body" x="2" y="${top}" width="22" height="${body}" rx="6"/>
    <rect class="fl-fill" x="2" y="${top + body - fillH}" width="22" height="${fillH}" clip-path="url(#${id})"/>
    ${markY != null ? `<line class="fl-mark" x1="3" x2="23" y1="${markY}" y2="${markY}"/>` : ''}
    <rect class="fl-line" x="2" y="${top}" width="22" height="${body}" rx="6"/>
  </svg>`;
  return wrap;
}

function minutesOfTs(ts) { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); }

// ── Actions ─────────────────────────────────────────────────────────────
function toggleDose(date, key, taken) {
  Store.commit(taken ? 'Medicine taken' : 'Medicine unticked', () => setDoseTaken(date, key, taken), { toast: false });
}
function takeGroup(date, group) {
  Store.commit('Medicines taken', () => group.doses.forEach(d => { if (!d.taken) setDoseTaken(date, d.key, true); }), { toast: false });
}
function changeWater(date, delta) {
  Store.commit(delta > 0 ? 'Water added' : 'Water removed', () => setWater(date, waterOn(date) + delta), { toast: false });
}
/** Clicking bottle k fills up to k; clicking the last full one empties it again. */
function clickFlask(date, k) {
  const v = waterOn(date) === k ? k - 1 : k;
  Store.commit('Water changed', () => setWater(date, v), { toast: false });
}
function afterWorkoutComplete(date) {
  const fin = Store.d.pomo && Store.d.pomo.finished;
  if (fin && fin.kind === 'workout' && fin.date === date) Store.d.pomo.finished = null;
}
function toggleWorkoutItem(date, itemId, on) {
  const was = workoutLog(date).done;
  Store.commit(on ? 'Exercise ticked' : 'Exercise unticked', () => {
    setWorkoutItem(date, itemId, on);
    if (workoutLog(date).done) afterWorkoutComplete(date);
  }, { toast: false });
  if (!was && workoutLog(date).done) toast('Workout done. Nice work.');
}
function toggleWorkoutDone(date) {
  const done = !workoutLog(date).done;
  Store.commit(done ? 'Workout done' : 'Workout reopened', () => {
    setWorkoutDone(date, done);
    if (done) afterWorkoutComplete(date);
  }, { toast: false });
}
function startAddingMedicine() {
  HealthUI.editingMeds = true;
  Store.commit('Medicine added', d => { d.health.meds.push({ id: uid('med'), name: 'New medicine', dose: '', note: '', times: [480] }); }, { toast: false });
  if (App.state.view !== 'health') App.openHealth('hv-meds');
  requestAnimationFrame(() => { const inputs = $$('.med-row .med-fields input:first-child'); const last = inputs[inputs.length - 1]; if (last) { last.focus(); last.select(); } });
}

// ── Blocks shared by the card and the page ──────────────────────────────
function medsBlock(date, full) {
  const groups = doseGroups(date);
  const mp = medProgress(date);
  const isToday = date === todayYmd(), now = nowMinutes();
  const head = h('div', { class: 'hb-h' },
    h('span', { class: 'hb-title' }, icon('pill', 14), 'Medicines'),
    h('span', { class: 'hb-meta' }, mp.total ? (mp.taken === mp.total ? 'All taken' : `${mp.taken} of ${mp.total} taken`) : ''));
  if (!groups.length) {
    return h('div', { class: 'hb' }, head,
      h('p', { class: 'hb-hint' }, 'No medicines yet. Add the ones you take each day to get a checklist and reminders.'),
      h('button', { class: 'btn sm', onclick: () => startAddingMedicine() }, icon('plus', 13), 'Add medicine'));
  }
  return h('div', { class: 'hb hb-meds' + (full ? ' full' : '') }, head, groups.map(g => {
    const left = g.doses.filter(d => !d.taken);
    const due = isToday && left.length > 0 && now >= g.time;
    return h('div', { class: 'dose-group' },
      h('div', { class: 'dose-time' + (due ? ' due' : '') },
        h('span', null, fmtTime(g.time), due ? ' · due now' : (!left.length ? ' · done' : '')),
        left.length > 1 ? h('button', { class: 'linkish small', onclick: () => takeGroup(date, g) }, 'Take all') : null),
      h('div', { class: 'dose-list' }, g.doses.map(d => h('button', {
        class: 'dose' + (d.taken ? ' on' : ''),
        title: (d.taken ? `Taken at ${fmtTime(minutesOfTs(d.taken))}. Click to undo.` : 'Mark as taken') + (d.med.note ? `\n${d.med.note}` : ''),
        'aria-pressed': String(!!d.taken),
        onclick: () => toggleDose(date, d.key, !d.taken),
      },
      h('span', { class: 'check' + (d.taken ? ' on' : '') }, icon('check', 10)),
      h('span', { class: 'dose-text' },
        h('span', { class: 'dose-name' }, d.med.name),
        d.med.dose ? h('span', { class: 'dose-dose' }, d.med.dose) : null),
      full && d.med.note ? h('span', { class: 'dose-note' }, d.med.note) : null))));
  }));
}

function waterBlock(date, full) {
  const goal = waterGoal(date, Weather.maxFeels(date));
  const have = waterOn(date);
  const n = Math.max(1, Math.ceil(goal.flasks - 1e-9));
  const isToday = date === todayYmd();
  const flasks = [];
  for (let i = 0; i < n; i++) {
    const cap = Math.min(1, goal.flasks - i);
    flasks.push(h('button', {
      class: 'flask-btn', title: `Set to ${fmtFlasks(i + 1)} ${waterUnit(i + 1)}`, 'aria-label': `Set water to ${fmtFlasks(i + 1)} ${waterUnit(i + 1)}`,
      onclick: () => clickFlask(date, i + 1),
    }, flaskSvg(clamp(have - i, 0, 1), cap < 1 ? cap : null, full ? 64 : 42)));
  }
  let hint = null;
  if (isToday) {
    const next = waterCheckpoints(goal.flasks).find(cp => have < cp.target && nowMinutes() < cp.time + 60);
    const left = goal.flasks - have;
    hint = have >= goal.flasks ? 'Goal reached. Keep sipping if it is hot.'
      : next ? `Aim for ${fmtFlasks(next.target)} by ${fmtTime(next.time)}.` : `${fmtFlasks(left)} ${waterUnit(left)} to go.`;
  }
  return h('div', { class: 'hb hb-water' + (full ? ' full' : '') },
    h('div', { class: 'hb-h' },
      h('span', { class: 'hb-title' }, icon('droplet', 14), 'Water'),
      h('span', { class: 'hb-meta' }, `${fmtFlasks(have)} of ${fmtFlasks(goal.flasks)} ${waterUnit(goal.flasks)} · ${fmtLitres(have)}`)),
    h('div', { class: 'water-row' },
      h('div', { class: 'flasks' }, flasks, have > n ? h('span', { class: 'flask-over' }, '+' + fmtFlasks(have - n)) : null),
      h('div', { class: 'water-btns' },
        h('button', { class: 'btn sm', title: 'Remove a quarter', disabled: have <= 0, onclick: () => changeWater(date, -0.25) }, '−¼'),
        h('button', { class: 'btn sm', onclick: () => changeWater(date, 0.25) }, '+¼'),
        h('button', { class: 'btn sm', onclick: () => changeWater(date, 0.5) }, '+½'),
        h('button', { class: 'btn sm primary', onclick: () => changeWater(date, 1) }, '+1'))),
    hint ? h('div', { class: 'hb-hint' }, hint) : null,
    full && goal.parts.length > 1 ? h('div', { class: 'hb-hint' }, 'Today’s goal: ' + goal.parts.map(p => `${p.label} ${fmtFlasks(p.amount)}`).join(' + ')) : null);
}

function workoutBlock(date, full) {
  const w = workoutFor(date);
  const head = (meta) => h('div', { class: 'hb-h' }, h('span', { class: 'hb-title' }, icon('activity', 14), 'Workout'), h('span', { class: 'hb-meta' }, meta));
  if (!w) return h('div', { class: 'hb' }, head(''), h('p', { class: 'hb-hint' }, `The program starts on ${fmtDateMed(Store.d.health.workout.start)}.`));
  const wp = workoutProgress(date);
  const st = Pomo.st || {};
  const inSession = st.seq && st.seq.kind === 'workout' && st.seq.date === date;
  const finished = st.finished && st.finished.kind === 'workout' && st.finished.date === date && !wp.complete;
  if (w.type === 'rest' && !w.custom) {
    return h('div', { class: 'hb hb-work' }, head(`Week ${w.week}`), h('p', { class: 'hb-line' }, h('b', null, 'Rest day.'), ' An easy walk is fine. Keep up your water.'));
  }
  const parts = [
    head(wp.complete ? 'Done' : `${wp.done} of ${wp.total}`),
    h('p', { class: 'hb-line' }, h('b', null, w.title),
      h('span', { class: 'muted' }, (w.min ? ` · ${w.min} min` : '') + ` · week ${w.week}` + (w.custom ? '' : `, ${w.phase.name.toLowerCase()}`))),
  ];
  if (w.type === 'jog' && Weather.data) {
    const s = jogSummary(Date.now());
    if (s.best) parts.push(h('p', { class: 'hb-hint' }, `${s.label}: ${s.hero}.`));
  }
  if (full) parts.push(workoutChecklist(date, w));
  const actions = h('div', { class: 'study-actions' });
  if (wp.complete) {
    actions.append(h('span', { class: 'study-done' }, icon('check', 14), 'Workout done'), h('button', { class: 'linkish small', onclick: () => toggleWorkoutDone(date) }, 'Undo'));
  } else if (inSession) {
    actions.append(h('span', { class: 'study-live', style: { '--pc': HEALTH_COLORS.workout } }, h('i'), `${st.seq.steps[st.seq.idx].name} · step ${st.seq.idx + 1} of ${st.seq.steps.length}`),
      h('button', { class: 'btn sm', onclick: () => openWorkoutDialog(date) }, 'Checklist'));
  } else {
    if (finished) actions.append(h('span', { class: 'study-finished' }, 'Workout finished. Tick what you did.'));
    if (date === todayYmd() && w.steps.length) actions.append(h('button', { class: 'btn sm ' + (finished ? '' : 'primary'), onclick: () => Pomo.startWorkout(date) }, icon('play', 12), finished ? 'Again' : 'Start workout'));
    if (!full) actions.append(h('button', { class: 'btn sm', onclick: () => openWorkoutDialog(date) }, 'Checklist'));
    actions.append(h('button', { class: 'btn sm ' + (finished ? 'primary' : 'ghost'), onclick: () => toggleWorkoutDone(date) }, icon('check', 13), 'Done'));
  }
  parts.push(actions);
  return h('div', { class: 'hb hb-work' + (full ? ' full' : '') }, parts);
}

function workoutChecklist(date, w) {
  const log = workoutLog(date);
  if (!w.items.length) return h('p', { class: 'hb-hint' }, 'No exercises in this workout yet.');
  return h('ul', { class: 'checklist hb-list' }, w.items.map(it => {
    const on = !!log.items[it.id];
    return h('li', { class: on ? 'done' : '' },
      h('button', { class: 'check' + (on ? ' on' : ''), 'aria-label': (on ? 'Untick: ' : 'Tick: ') + it.text, onclick: () => toggleWorkoutItem(date, it.id, !on) }, icon('check', 11)),
      h('span', null, it.text));
  }));
}

// ── Right-panel card ────────────────────────────────────────────────────
function healthSummary(date) {
  const mp = medProgress(date), goal = waterGoal(date, Weather.maxFeels(date)), w = workoutFor(date), wp = workoutProgress(date);
  const parts = [];
  if (mp.total) parts.push(`Meds ${mp.taken}/${mp.total}`);
  parts.push(`Water ${fmtFlasks(waterOn(date))}/${fmtFlasks(goal.flasks)}`);
  if (w && w.type !== 'rest') parts.push(wp.complete ? 'workout done' : w.short);
  return parts.join(' · ');
}

function renderHealthCard() {
  const card = $('#healthCard');
  if (!card || !Store.d.health) return;
  const date = todayYmd();
  const collapsed = (Store.d.settings.collapsedCards || []).includes('health');
  const head = collapsibleHead('health', 'Health', collapsed,
    h('button', { class: 'icon-btn sm', title: 'Open Daily health', onclick: () => App.openHealth() }, icon('heart', 15)));
  if (collapsed) {
    head.querySelector('.study-toggle').append(h('span', { class: 'study-sum' }, healthSummary(date)));
    fill(card, head);
    return;
  }
  // Medicines only appear in the card once there are some (not everyone takes any).
  fill(card, head, Store.d.health.meds.length ? medsBlock(date, false) : null, waterBlock(date, false), workoutBlock(date, false));
}

function renderHealthLink() {
  const box = $('#healthLink');
  if (!box || !Store.d.health) return;
  fill(box, h('button', { class: 'plan-link health-link' + (App.state.view === 'health' ? ' on' : ''), onclick: () => App.openHealth() },
    h('span', { class: 'plan-link-t' }, icon('heart', 14), h('span', null, 'Daily health')),
    h('span', { class: 'health-mini' }, healthSummary(todayYmd()))));
}

// ── Workout dialog ──────────────────────────────────────────────────────
function openWorkoutDialog(date) {
  closePopover();
  const w = workoutFor(date);
  if (!w) return;
  const body = h('div', { class: 'plan-day' });
  const draw = () => {
    const wp = workoutProgress(date);
    fill(body,
      h('div', { class: 'pd-meta' },
        h('span', { class: 'pd-phase', style: { '--pc': HEALTH_COLORS.workout } }, h('i'), w.custom ? `Week ${w.week}` : `Week ${w.week} · ${w.phase.name}`),
        w.steps.length ? h('span', { class: 'muted' }, `${w.min} min`) : null,
        h('span', { class: 'muted' }, `${wp.done} of ${wp.total} done`)),
      workoutChecklist(date, w),
      w.steps.length ? h('p', { class: 'muted small' }, 'Timer: ' + summarizeSteps(w.steps)) : null,
      h('p', { class: 'muted small' }, 'Stop if you feel chest pain, dizziness or unusual muscle pain.'));
  };
  draw();
  const m = openModal({
    title: `${w.title} · ${fmtDateLong(date)}`, className: 'plan-day-modal', body,
    footer: [
      h('button', { class: 'btn ghost', onclick: () => { m.close(); openRoutineEditor(w.type); } }, icon('edit', 14), 'Edit workout'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => { m.close(); toggleWorkoutDone(date); } }, icon('check', 14), workoutLog(date).done ? 'Mark not done' : 'Tick all'),
      date === todayYmd() && w.steps.length ? h('button', { class: 'btn primary', onclick: () => { m.close(); Pomo.startWorkout(date); } }, icon('play', 13), 'Start workout') : null,
    ],
  });
  m.el.addEventListener('click', e => { if (e.target.closest('.check')) requestAnimationFrame(() => { if (!m.closed) draw(); }); });
}

/** "Warm-up 5 · Strength 25 · Cool-down 5" or "Warm-up 4 · 6 × (20 s hard + 40 s easy) · Cool-down 4". */
function summarizeSteps(steps) {
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.round) {
      const b = steps[i + 1] && steps[i + 1].round === s.round && steps[i + 1].name !== s.name ? steps[i + 1] : null;
      const fmt = x => (x.min < 1 ? `${Math.round(x.min * 60)} s` : `${+x.min.toFixed(1)} min`) + ' ' + x.name.toLowerCase();
      out.push(`${s.rounds} × (${fmt(s)}${b ? ' + ' + fmt(b) : ''})`);
      while (i + 1 < steps.length && steps[i + 1].round) i++;
    } else out.push(`${s.name} ${+s.min.toFixed(1)}`);
  }
  return out.join(' · ');
}

// ── Workout editor ──────────────────────────────────────────────────────
/** Edit (or create, with id null) a workout: its name, checklist and timer steps. */
function openRoutineEditor(id) {
  closePopover();
  const WS = Store.d.health.workout;
  const isNew = !id;
  const builtin = !isNew && BUILTIN_ROUTINES.some(r => r.id === id);
  const week = workoutWeek(todayYmd(), WS.start) > 0 ? workoutWeek(todayYmd(), WS.start) : 1;
  const r = isNew ? { title: 'My workout', short: 'My workout', items: [{ text: 'Warm-up 5 min' }], steps: [{ name: 'Warm-up', min: 5 }, { name: 'Workout', min: 20 }, { name: 'Cool-down', min: 5 }] } : routineAt(id, week);
  const titleIn = h('input', { class: 'input', value: r.title, maxlength: 60 });
  const shortIn = h('input', { class: 'input', value: r.short || r.title, maxlength: 24 });
  const itemsIn = h('textarea', { class: 'input', rows: 8 }, r.items.map(i => i.text).join('\n'));
  const stepsIn = h('textarea', { class: 'input mono-ish', rows: 5 }, stepsToText(r.steps));
  const err = h('p', { class: 'form-error', hidden: true });
  const body = h('div', { class: 'pd-edit' },
    builtin && !WS.custom[id] ? h('p', { class: 'muted small' }, 'This built-in workout steps up every two weeks. Saving your own version freezes it as you write it; Reset brings the automatic version back.') : null,
    h('label', { class: 'field' }, h('span', null, 'Name'), titleIn),
    h('label', { class: 'field' }, h('span', null, 'Short name (calendar)'), shortIn),
    h('label', { class: 'field' }, h('span', null, 'Checklist, one exercise per line'), itemsIn),
    h('label', { class: 'field' }, h('span', null, 'Timer, one step per line'), stepsIn,
      h('small', { class: 'muted' }, 'Minutes or seconds: "Warm-up 5", "Plank 45s". Intervals: "6 x 20s Hard / 40s Easy" or "8 x 1 Jog / 2 Walk". Leave empty for no timer.')),
    err);
  const save = () => {
    const parsed = parseStepsText(stepsIn.value);
    if (parsed.error) { err.textContent = 'Could not read the timer. ' + parsed.error; err.hidden = false; return; }
    const title = titleIn.value.trim() || 'Workout';
    const routine = {
      title, short: shortIn.value.trim() || title, user: !builtin,
      items: itemsIn.value.split('\n').map(s => s.trim()).filter(Boolean),
      steps: parsed.steps,
    };
    const newId = id || uid('w');
    m.close();
    Store.commit(isNew ? `Added ${title}` : `Saved ${title}`, () => { WS.custom[newId] = routine; });
  };
  const m = openModal({
    title: isNew ? 'New workout' : `Edit ${r.title}`, className: 'plan-day-modal', body,
    footer: [h('div', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, 'Save')],
  });
}

function resetRoutine(id) {
  Store.commit('Workout reset to default', () => { delete Store.d.health.workout.custom[id]; });
}
async function deleteRoutine(id) {
  const WS = Store.d.health.workout;
  const c = WS.custom[id];
  const used = WS.week.filter(x => x === id).length;
  const ok = await confirmDialog({
    title: `Delete “${c.title}”?`,
    text: used ? `It is on ${plural(used, 'day')} of your week; those days become rest days.` : 'It is not on your week right now.',
    ok: 'Delete', danger: true,
  });
  if (!ok) return;
  Store.commit(`Deleted ${c.title}`, () => {
    delete WS.custom[id];
    WS.week = WS.week.map(x => (x === id ? 'rest' : x));
  });
}

function programEditor() {
  const WS = Store.d.health.workout;
  const routines = routineList();
  const ws = Store.d.settings.weekStart;
  const days = h('div', { class: 'wk-edit' }, Array.from({ length: 7 }, (_, i) => {
    const dow = (ws + i) % 7;
    return h('label', { class: 'wk-edit-day' }, h('span', { class: 'wk-dw' }, WEEKDAYS_SHORT[dow]),
      selectBox(WS.week[dow], routines.map(r => [r.id, r.short]), v => Store.commit(`${WEEKDAYS[dow]}: ${routines.find(r => r.id === v).short}`, () => { WS.week[dow] = v; }, { toast: false })));
  }));
  const list = h('div', { class: 'routine-list' }, routines.map(r => {
    const x = routineAt(r.id, Math.max(1, workoutWeek(todayYmd(), WS.start)));
    return h('div', { class: 'routine-row' },
      h('div', { class: 'routine-main' },
        h('b', null, r.title),
        h('span', { class: 'muted small' }, [x.items.length ? plural(x.items.length, 'exercise') : 'No checklist', x.steps.length ? summarizeSteps(x.steps) : 'no timer'].join(' · '),
          r.builtin && r.edited ? ' · edited' : '', !r.builtin ? ' · yours' : '')),
      h('div', { class: 'routine-tools' },
        h('button', { class: 'btn sm', onclick: () => openRoutineEditor(r.id) }, icon('edit', 13), 'Edit'),
        r.builtin && r.edited ? h('button', { class: 'btn sm ghost', title: 'Back to the automatic version', onclick: () => resetRoutine(r.id) }, icon('reset', 13), 'Reset') : null,
        !r.builtin ? h('button', { class: 'icon-btn sm', title: `Delete ${r.title}`, onclick: () => deleteRoutine(r.id) }, icon('trash', 14)) : null));
  }));
  return h('div', { class: 'program-edit' },
    h('h3', { class: 'hv-h3' }, 'Your week'),
    days,
    h('h3', { class: 'hv-h3' }, 'Workouts'),
    list,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn sm', onclick: () => openRoutineEditor(null) }, icon('plus', 13), 'Add workout'),
      h('button', {
        class: 'btn sm ghost', onclick: async () => {
          const ok = await confirmDialog({ title: 'Restore the default program?', text: 'Your week goes back to the default schedule and every edited or added workout is removed. Ticks you already made are kept.', ok: 'Restore', danger: true });
          if (ok) Store.commit('Program restored', () => { WS.week = WORKOUT_WEEK.slice(); WS.custom = {}; });
        },
      }, icon('reset', 13), 'Restore default program')));
}

// ── Health page ─────────────────────────────────────────────────────────
function renderHealthView(main) {
  const date = App.state.healthDate || todayYmd();
  const isToday = date === todayYmd();
  const prev = main.querySelector('.healthview');
  const keepScroll = prev && !App.resetScroll ? prev.scrollTop : null;
  App.resetScroll = false;

  const mp = medProgress(date), goal = waterGoal(date, Weather.maxFeels(date)), w = workoutFor(date), wp = workoutProgress(date);
  const wrap = h('div', { class: 'pv-wrap hv-wrap' },
    h('header', { class: 'pv-mast' },
      h('p', { class: 'pv-eyebrow' }, 'Daily health'),
      h('h1', { class: 'pv-title' }, isToday ? 'Today' : relDay(date)),
      h('div', { class: 'pv-stat' },
        mp.total ? h('span', null, h('b', null, `${mp.taken}/${mp.total}`), ' medicines') : null,
        h('span', null, h('b', null, `${fmtFlasks(waterOn(date))}/${fmtFlasks(goal.flasks)}`), ` ${waterUnit(goal.flasks)} of water`),
        w ? h('span', null, w.type === 'rest' && !w.custom ? 'Rest day' : [h('b', null, wp.complete ? 'Done' : `${wp.done}/${wp.total}`), ` ${w.short}`]) : null,
        !isToday ? h('button', { class: 'go', onclick: () => App.goToday() }, 'Back to today') : null)),
    medsSection(date),
    waterSection(date),
    workoutSection(date),
    weatherSection(),
    historySection(date),
    notesSection());

  const view = h('div', { class: 'planview healthview' }, wrap);
  main.replaceChildren(view);
  if (keepScroll != null) view.scrollTop = keepScroll;
  if (App.healthScrollTo) {
    const el = document.getElementById(App.healthScrollTo);
    App.healthScrollTo = null;
    if (el) view.scrollTop = el.offsetTop - 20;
  }
}

function sectionHead(title, ic, ...tools) {
  return h('div', { class: 'hv-sec-h' }, h('h2', null, icon(ic, 18), title), tools.length ? h('div', { class: 'hv-sec-tools' }, ...tools) : null);
}

function medsSection(date) {
  const H = Store.d.health;
  const sec = h('section', { class: 'hv-sec', id: 'hv-meds' },
    sectionHead('Medicines', 'pill',
      H.meds.length ? h('label', { class: 'check-label' }, h('input', { type: 'checkbox', checked: H.medReminders, onchange: e => Store.commit('Medicine reminders changed', () => { H.medReminders = e.target.checked; }, { toast: false }) }), 'Reminders') : null,
      H.meds.length || HealthUI.editingMeds ? h('button', { class: 'btn sm' + (HealthUI.editingMeds ? ' primary' : ''), onclick: () => { HealthUI.editingMeds = !HealthUI.editingMeds; App.renderMain(); } }, icon(HealthUI.editingMeds ? 'check' : 'edit', 13), HealthUI.editingMeds ? 'Done' : 'Edit') : null));
  if (HealthUI.editingMeds) sec.append(medEditor());
  else sec.append(medsBlock(date, true));
  if (H.meds.length) sec.append(h('p', { class: 'muted small' }, 'Times here are reminders only. Keep them matched to your prescription.'));
  return sec;
}

function medEditor() {
  const H = Store.d.health;
  const list = h('div', { class: 'med-edit' });
  const save = (label, fn) => Store.commit(label, fn, { toast: false });
  H.meds.forEach(med => {
    const name = h('input', { class: 'input', value: med.name, placeholder: 'Name', maxlength: 60 });
    name.addEventListener('change', () => { const v = name.value.trim(); if (v) save('Medicine renamed', () => { med.name = v; }); else name.value = med.name; });
    const dose = h('input', { class: 'input', value: med.dose, placeholder: 'Dose, e.g. 10 mg', maxlength: 30 });
    dose.addEventListener('change', () => save('Dose changed', () => { med.dose = dose.value.trim(); }));
    const note = h('input', { class: 'input', value: med.note, placeholder: 'Note, e.g. with food', maxlength: 60 });
    note.addEventListener('change', () => save('Note changed', () => { med.note = note.value.trim(); }));
    const times = h('div', { class: 'med-times' }, med.times.map((t, i) => {
      const tf = timeField({
        value: t,
        onChange: v => save('Time changed', () => { med.times[i] = clamp(v % 1440, 0, 1439); med.times = uniq(med.times).sort((a, b) => a - b); }),
      });
      return h('span', { class: 'med-time' }, tf.el,
        med.times.length > 1 ? h('button', { class: 'icon-btn xs', title: 'Remove this time', onclick: () => save('Time removed', () => { med.times.splice(i, 1); }) }, icon('x', 12)) : null);
    }),
    h('button', { class: 'btn sm ghost', title: 'Take it more than once a day', onclick: () => save('Time added', () => { med.times = uniq([...med.times, Math.min(1380, med.times[med.times.length - 1] + 12 * 60)]).sort((a, b) => a - b); }) }, icon('plus', 12), 'Time'));
    list.append(h('div', { class: 'med-row' },
      h('div', { class: 'med-fields' }, name, dose, note),
      times,
      h('button', { class: 'icon-btn sm', title: `Remove ${med.name}`, onclick: () => save(`Removed ${med.name}`, d => { d.health.meds = d.health.meds.filter(x => x.id !== med.id); }) }, icon('trash', 14))));
  });
  list.append(h('button', { class: 'btn sm', onclick: () => startAddingMedicine() }, icon('plus', 13), 'Add medicine'));
  return list;
}

function waterSection(date) {
  const W = Store.d.health.water;
  const save = (label, fn) => Store.commit(label, fn, { toast: false });
  const goalIn = h('input', { type: 'number', class: 'input num', min: 0.5, max: 8, step: 0.5, value: W.goal });
  goalIn.addEventListener('change', () => save('Water goal changed', () => { W.goal = clamp(roundQuarter(+goalIn.value || 3), 0.5, 8); }));
  const sizeIn = h('input', { type: 'number', class: 'input num', min: 100, max: 3000, step: 5, value: W.flaskMl });
  sizeIn.addEventListener('change', () => save('Container size changed', () => { W.flaskMl = clamp(Math.round(+sizeIn.value || FLASK_ML), 100, 3000); }));
  const unitIn = h('input', { class: 'input unit-in', value: W.unit, maxlength: 20, placeholder: 'flask' });
  unitIn.addEventListener('change', () => save('Container renamed', () => { W.unit = unitIn.value.trim() || 'flask'; }));
  const oz = Math.round(W.flaskMl / 29.574);
  return h('section', { class: 'hv-sec', id: 'hv-water' },
    sectionHead('Water', 'droplet',
      h('label', { class: 'check-label' }, h('input', { type: 'checkbox', checked: W.reminders, onchange: e => save('Water reminders changed', () => { W.reminders = e.target.checked; }) }), 'Reminders')),
    waterBlock(date, true),
    h('div', { class: 'hv-settings' },
      h('label', null, 'Container', unitIn),
      h('label', null, 'Size', sizeIn, `mL (${oz} oz)`),
      h('label', null, 'Daily base', goalIn, waterUnit(W.goal)),
      h('label', { class: 'check-label' }, h('input', { type: 'checkbox', checked: !!W.workoutExtra, onchange: e => save('Water goal changed', () => { W.workoutExtra = e.target.checked ? 0.5 : 0; }) }), '+½ on workout days'),
      h('label', { class: 'check-label' }, h('input', { type: 'checkbox', checked: !!W.hotExtra, onchange: e => save('Water goal changed', () => { W.hotExtra = e.target.checked ? 0.5 : 0; }) }), '+½ on hot days')),
    h('p', { class: 'muted small' }, `Your base is about ${fmtLitres(W.goal, W.flaskMl)} a day. A common guide is about 35 mL per kg of body weight, more in heat or when training. Spread it out: a third by 11 AM, two thirds by 3 PM, the rest by 7 PM. Follow your doctor if you have been told to limit fluids.`));
}

function workoutSection(date) {
  const WS = Store.d.health.workout;
  const save = (label, fn) => Store.commit(label, fn, { toast: false });
  const w = workoutFor(date);
  const timeF = timeField({ value: WS.time, onChange: v => save('Workout time changed', () => { WS.time = clamp(v % 1440, 0, 1439); }) });
  const startIn = h('input', { type: 'date', class: 'input date-input', value: WS.start });
  startIn.addEventListener('change', () => { if (isYmd(startIn.value)) save('Program start changed', () => { WS.start = startIn.value; }); });

  const ws = startOfWeek(date, Store.d.settings.weekStart);
  const week = h('div', { class: 'wk-strip' }, Array.from({ length: 7 }, (_, i) => {
    const d = addDays(ws, i), x = workoutFor(d), done = x && workoutLog(d).done;
    return h('button', {
      class: 'wk-day' + (d === date ? ' on' : '') + (done ? ' done' : '') + (x && x.type === 'rest' ? ' rest' : ''),
      title: x ? `${fmtDateLong(d)}: ${x.title}${done ? ' (done)' : ''}` : 'Before the program starts',
      onclick: () => { App.state.healthDate = d; App.renderMain(); App.renderHeader(); },
    },
    h('span', { class: 'wk-dw' }, WEEKDAYS_SHORT[dowOf(d)]),
    h('span', { class: 'wk-type' }, x ? x.short : '–'),
    h('span', { class: 'wk-done', 'aria-hidden': 'true' }, done ? '✓' : ''));
  }));

  const cur = w ? w.phase : null;
  const phases = h('ol', { class: 'phase-list' }, WORKOUT_PHASES.map(p => h('li', { class: cur === p ? 'on' : '' },
    h('b', null, p.to ? `Weeks ${p.from}–${p.to} · ${p.name}` : `Week ${p.from} on · ${p.name}`),
    h('span', null, `Hang ${p.hang} · negatives ${p.neg} · HIIT ${p.rounds} × ${p.on}/${p.off} s · ${p.jog.reps > 1 ? `jog ${p.jog.on} / walk ${p.jog.off} min × ${p.jog.reps}` : `easy jog ${p.jog.on} min`}`),
    cur === p ? h('span', { class: 'phase-here' }, 'You are here') : null)));

  return h('section', { class: 'hv-sec', id: 'hv-work' },
    sectionHead('Exercise', 'activity',
      h('label', { class: 'check-label' }, h('input', { type: 'checkbox', checked: WS.reminders, onchange: e => save('Workout reminders changed', () => { WS.reminders = e.target.checked; }) }), 'Reminder'),
      h('label', { class: 'check-label' }, h('input', { type: 'checkbox', checked: WS.showInCalendar, onchange: e => save('Calendar setting changed', () => { WS.showInCalendar = e.target.checked; }) }), 'In calendar'),
      h('button', { class: 'btn sm' + (HealthUI.editingProgram ? ' primary' : ''), onclick: () => { HealthUI.editingProgram = !HealthUI.editingProgram; App.renderMain(); } },
        icon(HealthUI.editingProgram ? 'check' : 'edit', 13), HealthUI.editingProgram ? 'Done' : 'Edit program')),
    HealthUI.editingProgram ? programEditor() : null,
    workoutBlock(date, true),
    h('h3', { class: 'hv-h3' }, 'This week'),
    week,
    h('h3', { class: 'hv-h3' }, 'How the default program builds'),
    h('p', { class: 'muted small' }, 'Three strength days work toward a first pull-up: hangs grow your grip, scapular pulls teach the first inch, and slow negatives build strength for the whole rep. Two HIIT days and one walk-jog day burn fat without wrecking recovery. Built-in workouts step up every two weeks; workouts you edit stay as you wrote them.'),
    phases,
    h('div', { class: 'hv-settings' },
      h('label', null, 'Workout time', timeF.el),
      h('label', null, 'Week 1 started', startIn)));
}

function historySection(date) {
  const rows = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(date, -i);
    const mp = medProgress(d), goal = waterGoal(d, Weather.maxFeels(d)), have = waterOn(d), w = workoutFor(d), done = w && workoutLog(d).done;
    rows.push(h('tr', { class: d === date ? 'on' : '' },
      h('th', null, relDay(d)),
      h('td', null, mp.total ? (mp.taken === mp.total ? `✓ all ${mp.total}` : `${mp.taken} of ${mp.total}`) : '–'),
      h('td', null, `${fmtFlasks(have)} of ${fmtFlasks(goal.flasks)}${have >= goal.flasks ? ' ✓' : ''}`),
      h('td', null, !w ? '–' : w.type === 'rest' && !w.custom ? 'Rest' : `${done ? '✓ ' : ''}${w.short}`)));
  }
  return h('section', { class: 'hv-sec', id: 'hv-history' },
    sectionHead('Last 7 days', 'calendar'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'hv-table' },
      h('thead', null, h('tr', null, h('th', null, 'Day'), h('th', null, 'Medicines'), h('th', null, `Water (${waterUnit(2)})`), h('th', null, 'Workout'))),
      h('tbody', null, rows))));
}

function notesSection() {
  return h('section', { class: 'hv-sec hv-notes', id: 'hv-notes' },
    sectionHead('Before you start', 'bell'),
    h('ul', null,
      h('li', null, 'Check with your doctor before starting HIIT, especially if you take regular medicine.'),
      h('li', null, 'Drink before and after workouts, and lose weight slowly: about 0.5 kg a week.'),
      h('li', null, 'Fat loss comes mostly from eating a little less with enough protein. The training keeps your muscle and builds strength.'),
      // Notes that fit one person's medicines live in seed.local.js.
      LOCAL_HEALTH_NOTES.map(t => h('li', null, t))));
}
