'use strict';
/*
 * Pomodoro timer plus step-by-step study sessions from plans (Recall 10 -> Main job 40 -> Check 10).
 * The end of every phase is scheduled with the host, so the chime and notification arrive on time
 * even while the window is hidden in the tray.
 */

const POMO_MODES = {
  focus: { label: 'Focus', color: 'var(--focus)' },
  short: { label: 'Short break', color: 'var(--short)' },
  long: { label: 'Long break', color: 'var(--long)' },
};
const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

function pomoDefaults() {
  return {
    mode: 'focus', status: 'idle', endAt: null, remaining: null, token: null, startedAt: null,
    cycle: 0, cycleDate: todayYmd(), seq: null, label: '', taskId: null, finished: null,
  };
}

const Pomo = {
  els: null,
  lastSec: null,
  lastStatus: '',
  lastPushed: '',

  get st() { return Store.d.pomo; },

  init() {
    Store.d.pomo = { ...pomoDefaults(), ...(Store.d.pomo || {}) };
    const st = this.st;
    if (st.seq && !(Array.isArray(st.seq.steps) && st.seq.steps[st.seq.idx])) st.seq = null;
    if (st.status === 'running') {
      if (st.endAt > Date.now()) this.arm();
      else this.complete(true); // it ended while Planner was closed
    }
    Host.on('timerFired', m => { if (this.st.status === 'running' && m.token === this.st.token) this.complete(false); });
    Host.on('pomo', m => { if (m.action === 'toggle') this.toggle(); else if (m.action === 'skip') this.skip(); });
    setInterval(() => this.tick(), 250);
  },

  // ── State ──
  duration() {
    const st = this.st, P = Store.d.settings.pomo;
    // Sequence steps may be seconds long (interval training), so only guard against zero.
    if (st.seq) return Math.max(5 / 60, +st.seq.steps[st.seq.idx].min || 1) * 60000;
    return Math.max(1, +P[st.mode] || 1) * 60000;
  },
  remaining() {
    const st = this.st;
    if (st.status === 'running') return Math.max(0, st.endAt - Date.now());
    if (st.status === 'paused') return st.remaining;
    return this.duration();
  },
  phaseName() { const st = this.st; return st.seq ? st.seq.steps[st.seq.idx].name : POMO_MODES[st.mode].label; },
  save() { Store.quiet(); },

  // ── Actions ──
  start() {
    const st = this.st;
    if (st.status === 'running') return;
    const rem = st.status === 'paused' && st.remaining > 0 ? st.remaining : this.duration();
    if (st.status === 'idle') st.startedAt = Date.now();
    Object.assign(st, { status: 'running', endAt: Date.now() + rem, remaining: rem, token: uid('pomo'), finished: null });
    this.arm();
    this.save();
    this.render();
  },
  pause() {
    const st = this.st;
    if (st.status !== 'running') return;
    Host.cancelTimer(st.token);
    Object.assign(st, { status: 'paused', remaining: Math.max(1000, st.endAt - Date.now()), endAt: null });
    this.save();
    this.render();
  },
  toggle() { if (this.st.status === 'running') this.pause(); else this.start(); },
  reset() {
    const st = this.st;
    if (st.token) Host.cancelTimer(st.token);
    Object.assign(st, { status: 'idle', endAt: null, token: null, startedAt: null, remaining: null });
    this.save();
    this.render();
  },
  async setMode(mode) {
    const st = this.st;
    if (st.mode === mode && !st.seq) return;
    if (st.status !== 'idle') {
      const ok = await confirmDialog({ title: 'Stop the running timer?', text: `The ${this.phaseName().toLowerCase()} timer is still going. Switch to ${POMO_MODES[mode].label.toLowerCase()}?`, ok: 'Switch' });
      if (!ok) return;
    }
    if (st.token) Host.cancelTimer(st.token);
    Object.assign(st, { seq: null, mode, status: 'idle', endAt: null, token: null, startedAt: null, remaining: null });
    this.save();
    App.renderPanels();
  },
  skip() {
    const st = this.st;
    if (st.token) Host.cancelTimer(st.token);
    this.advance(false, false);
  },
  endSession() {
    const st = this.st;
    if (st.token) Host.cancelTimer(st.token);
    Object.assign(st, { seq: null, mode: 'focus', status: 'idle', endAt: null, token: null, startedAt: null, remaining: null });
    this.save();
    App.renderPanels();
  },
  complete(whileAway) {
    const st = this.st;
    if (st.status !== 'running') return;
    this.log(whileAway ? st.endAt : Date.now());
    this.advance(true, whileAway);
  },

  /** Moves to the next phase. Completed phases may auto-start the next one; skips never start a break by themselves. */
  advance(completed, whileAway) {
    const st = this.st, P = Store.d.settings.pomo;
    const wasRunning = st.status === 'running';
    Object.assign(st, { status: 'idle', endAt: null, token: null, startedAt: null, remaining: null });

    if (st.seq) {
      st.seq.idx++;
      if (st.seq.idx >= st.seq.steps.length) {
        const kind = st.seq.kind || 'study';
        st.finished = { kind, planId: st.seq.planId, dayId: st.seq.dayId, date: st.seq.date, title: st.seq.title, at: Date.now() };
        Object.assign(st, { seq: null, mode: 'focus' });
        this.save();
        App.renderPanels();
        if (completed && !whileAway) toast(kind === 'workout' ? 'Workout complete. Tick off what you did.' : 'Study session complete. Tick the day when you have checked your work.');
        return;
      }
      if (wasRunning && !whileAway) { this.start(); App.renderPanels(); return; }
      this.save();
      this.render();
      return;
    }

    if (st.mode === 'focus') {
      if (completed) {
        if (st.cycleDate !== todayYmd()) st.cycle = 0;
        st.cycle = (st.cycle || 0) + 1;
        st.cycleDate = todayYmd();
      }
      st.mode = completed && st.cycle % Math.max(1, P.longEvery) === 0 ? 'long' : 'short';
      if (completed && !whileAway && P.autoBreak) { this.start(); return; }
    } else {
      if (st.mode === 'long') st.cycle = 0;
      st.mode = 'focus';
      if (completed && !whileAway && P.autoFocus) { this.start(); return; }
    }
    this.save();
    this.render();
  },

  /** Starts a step-by-step sequence (study session or workout), asking first if a timer is running. */
  async beginSequence(seq) {
    const st = this.st;
    if (st.status !== 'idle') {
      const ok = await confirmDialog({ title: 'Replace the running timer?', text: `A timer is running. Start ${seq.kind === 'workout' ? 'the workout' : 'the study session'} instead?`, ok: 'Start' });
      if (!ok) return;
      if (st.token) Host.cancelTimer(st.token);
    }
    st.seq = seq;
    Object.assign(st, { status: 'idle', label: '', taskId: null, finished: null });
    this.start();
    App.renderPanels();
  },

  startSession(plan, day) {
    const phase = planPhase(plan, day);
    return this.beginSequence({
      kind: 'study', planId: plan.id, dayId: day.id,
      title: `${plan.short || plan.title} · ${fmtShortMonthDay(day.date)}`,
      color: (phase && phase.color) || null,
      steps: planSteps(plan, day).map(s => ({ name: s.name, min: s.min, text: s.text || '' })),
      idx: 0,
    });
  },

  startWorkout(date) {
    const w = workoutFor(date);
    if (!w || !w.steps.length) return;
    return this.beginSequence({
      kind: 'workout', date,
      title: `Workout · ${w.short}`,
      color: HEALTH_COLORS.workout,
      steps: w.steps.map(s => ({ name: s.name, min: s.min, text: s.text || '', round: s.round || 0, rounds: s.rounds || 0 })),
      idx: 0,
    });
  },

  async focusOn({ label = '', taskId = null }) {
    const st = this.st;
    if (st.seq) {
      const ok = await confirmDialog({ title: 'End the study session?', text: 'A study session is in progress. End it and start a focus timer instead?', ok: 'End session' });
      if (!ok) return;
      this.endSession();
    }
    st.label = label;
    st.taskId = taskId;
    if (st.mode === 'focus' && st.status !== 'idle') { this.save(); this.render(); return; }
    if (st.token) Host.cancelTimer(st.token);
    Object.assign(st, { mode: 'focus', status: 'idle', endAt: null, token: null, remaining: null });
    this.start();
    App.renderPanels();
  },
  clearTarget() { Object.assign(this.st, { label: '', taskId: null }); this.save(); this.render(); },

  arm() {
    const st = this.st, P = Store.d.settings.pomo;
    const a = this.alarmText();
    Host.timer({ token: st.token, at: st.endAt, title: a.title, body: a.body, sound: P.sound ? a.sound : 'none', volume: P.volume, notify: P.notify && a.notify !== false });
  },

  alarmText() {
    const st = this.st, P = Store.d.settings.pomo;
    if (st.seq) {
      const cur = st.seq.steps[st.seq.idx], next = st.seq.steps[st.seq.idx + 1];
      const len = m => (m < 1 ? `${Math.round(m * 60)} s` : `${+m.toFixed(1)} min`);
      // Interval steps (under 2 minutes) only chime; a Windows notification every 30 s would be noise.
      const quick = cur.min < 2 || (next && next.min < 2);
      if (next) {
        const round = next.round ? ` (round ${next.round} of ${next.rounds})` : '';
        return { title: `${cur.name} done`, body: `Next: ${next.name}${round}, ${len(next.min)}. ${next.text || ''}`.trim(), sound: 'step', notify: !quick };
      }
      if (st.seq.kind === 'workout') return { title: 'Workout complete', body: `${st.seq.title}. Tick off what you did in Planner.`, sound: 'done' };
      return { title: 'Study session complete', body: `${st.seq.title}. Tick the day in Planner once you have checked your work.`, sound: 'done' };
    }
    if (st.mode === 'focus') {
      const longNext = ((st.cycle || 0) + 1) % Math.max(1, P.longEvery) === 0;
      return { title: 'Focus session complete', body: longNext ? `Take a long break: ${P.long} minutes.` : `Take a short break: ${P.short} minutes.`, sound: 'focusEnd' };
    }
    return { title: 'Break is over', body: `Ready for ${P.focus} minutes of focus?`, sound: 'breakEnd' };
  },

  log(at) {
    const st = this.st;
    if (!st.seq && st.mode !== 'focus') return;
    if (st.seq && st.seq.kind === 'workout') return; // workouts are tracked on the Health page, not as focus time
    const task = !st.seq && st.taskId ? Store.d.tasks.find(t => t.id === st.taskId) : null;
    const step = st.seq ? st.seq.steps[st.seq.idx] : null;
    Store.d.pomoLog.push({
      date: ymdOf(new Date(at)), at, min: Math.round(this.duration() / 60000),
      label: st.seq ? `${st.seq.title} · ${step.name}` : (task ? task.title : st.label || ''),
      taskId: task ? task.id : null, planId: st.seq ? st.seq.planId : null,
    });
    if (task) task.pomos = (task.pomos || 0) + 1;
    if (Store.d.pomoLog.length > 6000) Store.d.pomoLog.splice(0, Store.d.pomoLog.length - 6000);
  },

  stats() {
    const today = todayYmd(), weekStart = startOfWeek(today, Store.d.settings.weekStart);
    let count = 0, todayMin = 0, weekMin = 0;
    for (const e of Store.d.pomoLog) {
      if (e.date === today) { todayMin += e.min; if (!e.planId) count++; }
      if (e.date >= weekStart && e.date <= today) weekMin += e.min;
    }
    return { count, todayMin, weekMin };
  },

  // ── Rendering ──
  tick() {
    const st = this.st;
    if (!st) return;
    // Safety net in case the host's alarm message never arrives.
    if (st.status === 'running' && Date.now() > st.endAt + 2500) { this.complete(false); return; }
    const rem = this.remaining();
    const sec = Math.ceil(rem / 1000);
    if (sec === this.lastSec && st.status === this.lastStatus) return;
    this.lastSec = sec;
    this.lastStatus = st.status;
    this.paint(rem);
    this.pushStatus(rem);
  },

  paint(rem) {
    if (!this.els) return;
    const dur = this.duration();
    this.els.time.textContent = fmtClock(rem);
    const frac = this.st.status === 'idle' ? 0 : clamp(1 - rem / dur, 0, 1);
    this.els.prog.setAttribute('stroke-dashoffset', String(RING_C * frac));
  },

  pushStatus(rem) {
    const st = this.st;
    const active = st.status !== 'idle';
    const name = this.phaseName();
    const clock = fmtClock(rem);
    const paused = st.status === 'paused' ? ' (paused)' : '';
    const s = {
      title: active ? `${clock} ${name}${paused}` : '',
      tooltip: active ? `Planner: ${name}, ${clock} left${paused}` : 'Planner',
      state: st.status === 'running' ? 'normal' : st.status === 'paused' ? 'paused' : 'none',
      value: active ? clamp(1 - rem / this.duration(), 0, 1) : 0,
      running: st.status === 'running',
      active,
      menuLabel: st.status === 'running' ? 'Pause timer' : st.status === 'paused' ? 'Resume timer' : st.seq ? 'Start study step' : `Start ${name.toLowerCase()}`,
    };
    const json = JSON.stringify(s);
    if (json === this.lastPushed) return;
    this.lastPushed = json;
    Host.status(s);
  },

  render() {
    const card = $('#pomoCard');
    if (!card || !this.st) return;
    const st = this.st, seq = st.seq;
    card.style.setProperty('--mode-c', seq ? seq.color || 'var(--accent)' : POMO_MODES[st.mode].color);
    card.classList.toggle('is-running', st.status === 'running');

    const head = h('div', { class: 'card-h' },
      h('div', { class: 'card-title' }, seq ? (seq.kind === 'workout' ? 'Workout' : 'Study session') : 'Focus timer'),
      h('button', { class: 'icon-btn sm', title: 'Timer settings', onclick: () => openSettings('pomodoro') }, icon('settings', 15)));

    let top;
    if (seq && seq.steps.length > 4) {
      // Many short steps (intervals): one segmented bar instead of a box per step.
      const cur = seq.steps[seq.idx];
      top = h('div', { class: 'steps-compact' },
        h('div', { class: 'sc-row' }, h('b', null, cur.name),
          h('span', { class: 'muted' }, cur.round ? `round ${cur.round} of ${cur.rounds}` : `step ${seq.idx + 1} of ${seq.steps.length}`)),
        h('div', { class: 'sc-bar', 'aria-hidden': 'true' }, seq.steps.map((s, i) =>
          h('i', { class: i < seq.idx ? 'done' : i === seq.idx ? 'cur' : '', style: { flexGrow: String(s.min) } }))));
    } else if (seq) {
      top = h('div', { class: 'steps' }, seq.steps.map((s, i) => h('div', {
        class: 'step' + (i < seq.idx ? ' done' : i === seq.idx ? ' cur' : ''),
      }, h('b', null, s.name), h('span', null, s.min + ' min'))));
    } else {
      top = h('div', { class: 'seg seg-full' }, Object.entries(POMO_MODES).map(([k, v]) =>
        h('button', { class: st.mode === k ? 'on' : '', onclick: () => this.setMode(k) }, v.label)));
    }

    const time = h('div', { class: 'pomo-time' });
    const ring = h('div', {
      class: 'pomo-ring',
      html: `<svg viewBox="0 0 120 120" aria-hidden="true"><circle class="track" cx="60" cy="60" r="${RING_R}"/><circle class="prog" cx="60" cy="60" r="${RING_R}" stroke-dasharray="${RING_C}" stroke-dashoffset="0"/></svg>`,
    });
    const P = Store.d.settings.pomo;
    const dots = seq ? null : h('div', { class: 'pomo-dots', title: `${st.cycle % Math.max(1, P.longEvery)} of ${P.longEvery} before a long break` },
      Array.from({ length: Math.max(1, P.longEvery) }, (_, i) => h('i', { class: i < (st.cycle % Math.max(1, P.longEvery)) ? 'on' : '' })));
    ring.append(h('div', { class: 'pomo-center' },
      time,
      h('div', { class: 'pomo-label' }, this.phaseName() + (st.status === 'paused' ? ' · paused' : '')),
      dots));

    let target;
    if (seq) {
      const step = seq.steps[seq.idx];
      target = h('div', { class: 'pomo-target seq' }, h('b', null, seq.title), step.text ? h('div', null, step.text) : null);
    } else if (st.taskId || st.label) {
      const task = st.taskId ? Store.d.tasks.find(t => t.id === st.taskId) : null;
      target = h('div', { class: 'pomo-target' },
        icon('target', 14),
        h('span', { class: 'grow' }, 'Focusing on ', h('b', null, task ? task.title : st.label)),
        h('button', { class: 'icon-btn xs', title: 'Clear', onclick: () => this.clearTarget() }, icon('x', 13)));
    } else {
      target = h('div', { class: 'pomo-target muted' }, 'Tip: press ', icon('target', 13), ' on a task to focus on it.');
    }

    const running = st.status === 'running';
    const controls = h('div', { class: 'pomo-controls' },
      h('button', {
        class: 'icon-btn round', title: seq ? 'End session' : 'Reset',
        onclick: () => (seq ? this.endSession() : this.reset()),
      }, icon(seq ? 'stop' : 'reset', 17)),
      h('button', { class: 'pomo-main', onclick: () => this.toggle() },
        icon(running ? 'pause' : 'play', 16),
        running ? 'Pause' : st.status === 'paused' ? 'Resume' : seq ? `Start ${seq.steps[seq.idx].name}` : 'Start'),
      h('button', { class: 'icon-btn round', title: seq ? 'Skip to the next step' : 'Skip to the next phase', onclick: () => this.skip() }, icon('skip', 17)));

    const s = this.stats();
    const stats = h('div', { class: 'pomo-stats' },
      h('span', null, icon('tomato', 13, 'tomato'), ` ${s.count} today · ${fmtDur(s.todayMin)} focused`),
      h('span', null, `Week ${fmtDur(s.weekMin)}`));

    card.replaceChildren(head, top, ring, target, controls, stats);
    this.els = { time, prog: ring.querySelector('.prog') };
    this.lastSec = null;
    this.tick();
  },
};
