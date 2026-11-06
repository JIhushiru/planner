'use strict';
/* Study plans: the plan page, the day dialog, today's study card and the sidebar list. */

function afterDayTicked(plan, day) {
  const fin = Store.d.pomo && Store.d.pomo.finished;
  if (fin && fin.dayId === day.id) Store.d.pomo.finished = null;
}

function togglePlanDay(plan, day) {
  const done = !day.done;
  Store.commit(done ? `Ticked ${fmtShortMonthDay(day.date)}` : `Unticked ${fmtShortMonthDay(day.date)}`, () => {
    setPlanDayDone(day, done);
    if (done) afterDayTicked(plan, day);
  }, { toast: false });
  if (done && plan.days.every(d => d.done)) toast(`Every day of ${plan.short || plan.title} is ticked. Well done.`);
}

function togglePlanItem(plan, day, item) {
  const wasDone = day.done;
  Store.commit(item.done ? 'Item unticked' : 'Item ticked', () => {
    setPlanItemDone(day, item.id, !item.done);
    if (day.done && !wasDone) afterDayTicked(plan, day);
  }, { toast: false });
  if (day.done && !wasDone) {
    toast(plan.days.every(d => d.done) ? `Every day of ${plan.short || plan.title} is ticked. Well done.` : `${plan.short || plan.title}: ${fmtShortMonthDay(day.date)} done.`);
  }
}

/** time: undefined keeps the current time, null clears a per-day time, a number sets one. */
function movePlanDay(plan, day, date, time) {
  const timeChanged = time !== undefined && time !== planDayTime(plan, day);
  if (day.date === date && !timeChanged) { App.renderMain(); return; }
  Store.commit(`Moved “${day.title}” to ${fmtDateMed(date)}`, () => {
    day.date = date;
    if (time !== undefined) {
      if (time == null || time === plan.time) delete day.time;
      else day.time = time;
    }
  });
}

async function deletePlan(plan) {
  const ok = await confirmDialog({
    title: 'Remove this plan?',
    text: `“${plan.title}” and its ticks will be removed from Planner. Events such as an exam stay in your calendar. You can undo this right after.`,
    ok: 'Remove plan', danger: true,
  });
  if (!ok) return;
  App.state.view = Store.d.settings.view || 'week';
  Store.commit('Plan removed', d => { d.plans = d.plans.filter(p => p.id !== plan.id); });
}

/** What the plan builds up to: "Exam" by default, or a label such as "Project demo". */
function milestoneLabel(plan) { return (plan.exam && plan.exam.label) || 'Exam'; }

function daysLeftText(examDate, today = todayYmd(), short = false, label = 'Exam') {
  if (!examDate) return null;
  const left = diffDays(today, examDate);
  // Mid-sentence: "exam", but keep a leading acronym ("API demo").
  const name = /^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
  const tail = short ? ` to ${name}` : ` to the ${name}`;
  if (left > 1) return [h('b', null, left), ' days' + tail];
  if (left === 1) return [h('b', null, '1'), ' day' + tail];
  if (left === 0) return [h('b', null, `${label} day`)];
  return [`${label} finished`];
}

/** A plan day's checklist with its own tick boxes. */
function dayChecklist(plan, day, cls = '') {
  return h('ul', { class: 'checklist ' + cls }, day.items.map(item => h('li', { class: item.done ? 'done' : '' },
    h('button', {
      class: 'check' + (item.done ? ' on' : ''), title: item.done ? 'Mark not done' : 'Mark done',
      'aria-label': (item.done ? 'Untick: ' : 'Tick: ') + plainText(item.text),
      onclick: () => togglePlanItem(plan, day, item),
    }, icon('check', 11)),
    h('span', null, richText(item.text)))));
}

/** The day's content: its checklist if it has one, otherwise the main job and recall line. */
function dayBody(plan, day, { mainCls, recallCls, listCls, titleCls }) {
  if (day.items) {
    return [
      titleCls ? h('p', { class: titleCls }, day.title) : null,
      dayChecklist(plan, day, listCls),
    ];
  }
  return [
    h('p', { class: mainCls }, richText(day.main)),
    day.recall ? h('p', { class: recallCls }, h('b', null, 'Recall: '), richText(day.recall)) : null,
  ];
}

// ── Plan page ───────────────────────────────────────────────────────────
function renderPlanView(main) {
  const plan = planById(App.state.planId);
  if (!plan) { App.setView(Store.d.settings.view || 'week'); return; }
  const today = todayYmd();
  const prev = main.querySelector('.planview');
  const keepScroll = prev && !App.resetScroll ? prev.scrollTop : null;
  App.resetScroll = false;

  const days = planDaysSorted(plan);
  const doneCount = days.filter(d => d.done).length;
  const examDate = planExamDate(plan);
  const examEv = planExamEvent(plan);
  const todayDay = days.find(d => d.date === today);
  const firstPhase = plan.phases[0];
  const items = days.reduce((n, d) => n + (d.items ? d.items.length : 0), 0);
  const itemsDone = days.reduce((n, d) => n + (d.items ? d.items.filter(i => i.done).length : 0), 0);

  const label = milestoneLabel(plan);
  const eyebrow = examDate ? `${plan.short || plan.title} · ${label} on ${fmtDateLong(examDate)}` : plan.eyebrow;
  const wrap = h('div', { class: 'pv-wrap' },
    h('header', { class: 'pv-mast' },
      eyebrow ? h('p', { class: 'pv-eyebrow' }, eyebrow) : null,
      h('h1', { class: 'pv-title' }, plan.heading || plan.title),
      plan.lede ? h('p', { class: 'pv-lede' }, richText(plan.lede)) : null,
      h('div', { class: 'pv-stat' },
        examDate ? h('span', null, daysLeftText(examDate, today, false, label)) : null,
        h('span', null, h('b', null, doneCount), ` of ${days.length} days done`),
        items ? h('span', null, h('b', null, itemsDone), ` of ${items} items`) : null,
        todayDay ? h('button', { class: 'go', onclick: () => scrollPlanTo(today) }, 'Go to today') : null,
        (plan.links || []).map(l => h('a', { class: 'go ext', href: l.url, title: l.url }, l.label, icon('external', 11)))),
      planSettingsRow(plan)),
    h('ul', { class: 'pv-how', style: { '--n': plan.steps.length }, 'aria-label': 'How each day runs' }, plan.steps.map(s =>
      h('li', null, h('b', null, s.name, h('span', null, `${s.min} min`)), s.text))));

  const rows = new Map();
  for (const ph of plan.phases) {
    const pdays = days.filter(d => d.phase === ph.id);
    if (!pdays.length) continue;
    wrap.append(h('section', { class: 'pv-phase', style: { '--pc': ph.color } },
      h('div', { class: 'pv-phase-h' },
        h('h2', null, ph.title),
        h('p', { class: 'pv-rng' }, fmtSpan(pdays[0].date, pdays[pdays.length - 1].date)),
        ph.intro ? h('p', { class: 'pv-intro' }, ph.intro) : null),
      h('ol', { class: 'pv-days' }, pdays.map(d => { const row = planDayRow(plan, d, today); rows.set(d, row); return row; }))));
  }

  if (examDate) {
    const block = h('button', {
      class: 'pv-exam', title: examEv ? `Edit the ${label === 'Exam' ? 'exam' : label} event` : '',
      onclick: () => { if (examEv) openEditor({ occ: eventOcc(examEv, examEv.date) }); },
    },
    h('div', { class: 'pv-dt' }, h('span', { class: 'pv-wd' }, WEEKDAYS_SHORT[dowOf(examDate)]), h('span', { class: 'pv-dn' }, fmtShortMonthDay(examDate))),
    h('p', null, label,
      examEv && !examEv.allDay ? h('span', { class: 'pv-exam-time' }, ` · ${fmtRange(examEv.start, examEv.start + examEv.dur)}` + (examEv.location ? ` · ${examEv.location}` : '')) : null));
    // A milestone with study days after it (a report mid-plan) sits among the days, in date order.
    const before = days.filter(d => d.date <= examDate).pop();
    const studyAfter = days.some(d => d.date > examDate);
    if (studyAfter && before && rows.has(before)) rows.get(before).after(h('li', { class: 'pv-ms' }, block));
    else if (studyAfter && wrap.querySelector('.pv-phase')) wrap.querySelector('.pv-phase').before(block);
    else wrap.append(block);
  }
  if (plan.notes) wrap.append(h('p', { class: 'pv-fine' }, richText(plan.notes)));
  wrap.append(h('div', { class: 'pv-foot' },
    plan.source ? h('a', { class: 'ext', href: plan.source }, 'Open the original plan', icon('external', 11)) : h('span'),
    h('button', { class: 'btn ghost danger sm', onclick: () => deletePlan(plan) }, icon('trash', 14), 'Remove plan')));

  const view = h('div', { class: 'planview', style: { '--pc': firstPhase ? firstPhase.color : 'var(--accent)' } }, wrap);
  main.replaceChildren(view);
  if (keepScroll != null) view.scrollTop = keepScroll;
  else if (todayDay) {
    // Jump to today only when it would otherwise be out of sight; early on, the plan's header is more useful.
    const row = document.getElementById('pv-' + today);
    if (row && row.getBoundingClientRect().bottom > view.getBoundingClientRect().bottom - 40) scrollPlanTo(today, false);
  }
}

function scrollPlanTo(date, smooth = true) {
  const row = document.getElementById('pv-' + date);
  const view = $('#main .planview');
  if (!row || !view) return;
  const top = row.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop - 90;
  view.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
}

function planSettingsRow(plan) {
  const timed = plan.time != null;
  const parts = [
    selectBox(timed ? 'timed' : 'allday', [['allday', 'Show days as all-day items'], ['timed', 'Give study a daily time slot']], v => {
      Store.commit(v === 'timed' ? 'Study time set' : 'Study days shown as all-day', () => { plan.time = v === 'timed' ? (plan.time != null ? plan.time : 19 * 60) : null; }, { toast: false });
    }),
  ];
  if (timed) {
    const tf = timeField({ value: plan.time, onChange: v => Store.commit('Study time changed', () => { plan.time = clamp(v, 0, 1439); }, { toast: false }) });
    parts.push(tf.el, selectBox(plan.reminder == null ? '' : plan.reminder,
      [['', 'No reminder'], [0, 'Remind at start'], [5, '5 min before'], [10, '10 min before'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before']],
      v => Store.commit('Study reminder changed', () => { plan.reminder = v === '' ? null : +v; }, { toast: false })));
  }
  parts.push(h('label', { class: 'check-label' },
    h('input', { type: 'checkbox', checked: !plan.hidden, onchange: e => Store.commit(e.target.checked ? 'Plan shown in calendar' : 'Plan hidden from calendar', () => { plan.hidden = !e.target.checked; }, { toast: false }) }),
    'Show in calendar'));
  return h('div', { class: 'pv-settings' }, parts);
}

function planDayRow(plan, d, today) {
  const isToday = d.date === today;
  const time = planDayTime(plan, d);
  const steps = planSteps(plan, d);
  const prog = planDayProgress(d);
  return h('li', {
    class: 'pv-day' + (isToday ? ' today' : '') + (d.done ? ' done' : '') + (d.date < today && !d.done ? ' missed' : ''),
    id: 'pv-' + d.date,
  },
  h('button', { class: 'pv-dt', title: 'Open this day', onclick: () => openPlanDay(plan, d) },
    h('span', { class: 'pv-wd' }, WEEKDAYS_SHORT[dowOf(d.date)]),
    h('span', { class: 'pv-dn' }, fmtShortMonthDay(d.date)),
    isToday ? h('span', { class: 'pv-today' }, 'Today') : null,
    time != null ? h('span', { class: 'pv-time' }, fmtTime(time)) : null,
    prog && prog.done && !d.done ? h('span', { class: 'pv-prog' }, `${prog.done} of ${prog.total}`) : null),
  h('div', { class: 'pv-bd' },
    dayBody(plan, d, { mainCls: 'pv-mn', recallCls: 'pv-rc', listCls: 'pv-list', titleCls: 'pv-daytitle' }),
    isToday && !d.done ? h('div', { class: 'pv-actions' },
      h('button', { class: 'btn primary sm', onclick: () => Pomo.startSession(plan, d) }, icon('play', 12), `Start ${planDur(plan, d)}-min session`),
      h('span', { class: 'muted small' }, steps.map(s => `${s.name} ${s.min}`).join(' · '))) : null),
  h('button', {
    class: 'pv-tick' + (d.done ? ' on' : ''), title: d.done ? 'Mark not done' : (d.items ? 'Tick every item' : 'Mark this day done'),
    'aria-label': `Mark ${fmtMonthDay(d.date)} ${d.done ? 'not done' : 'done'}`,
    onclick: () => togglePlanDay(plan, d),
  }, icon('check', 15)));
}

// ── Day dialog ──────────────────────────────────────────────────────────
function openPlanDay(plan, day) {
  closePopover();
  const phase = planPhase(plan, day);
  const steps = planSteps(plan, day);
  const today = todayYmd();
  const sorted = planDaysSorted(plan);
  const index = sorted.findIndex(d => d.id === day.id) + 1;

  const dateIn = h('input', { type: 'date', class: 'input date-input', value: day.date });
  const titleIn = h('input', { class: 'input', value: day.title, maxlength: 120 });
  const mainIn = h('textarea', { class: 'input mono-ish', rows: day.items ? 7 : 5 }, day.items ? day.items.map(i => i.text).join('\n') : day.main);
  const recallIn = h('input', { class: 'input', value: day.recall || '' });
  const editBox = h('div', { class: 'pd-edit', hidden: true },
    h('label', { class: 'field' }, h('span', null, 'Short title (shown in the calendar)'), titleIn),
    h('label', { class: 'field' }, h('span', null, day.items ? 'Checklist (one item per line)' : 'Main job'), mainIn,
      h('small', { class: 'muted' }, 'Links: [text](https://…)   Bold: **text**   Italic: *text*   Subscript: ~text~')),
    day.items ? null : h('label', { class: 'field' }, h('span', null, 'Recall'), recallIn));

  const listHolder = h('div', { class: 'pd-body' });
  const drawBody = () => {
    const p = planDayProgress(day);
    listHolder.replaceChildren(
      h('div', { class: 'pd-meta' },
        h('span', { class: 'pd-phase' }, h('i'), phase.title),
        h('span', { class: 'muted' }, `Day ${index} of ${sorted.length}`),
        p ? h('span', { class: 'muted' }, `${p.done} of ${p.total} done`) : null,
        day.date === today ? h('span', { class: 'pd-today' }, 'Today') : null,
        day.done ? h('span', { class: 'pd-done' }, icon('check', 12), 'Done') : null),
      ...dayBody(plan, day, { mainCls: 'pd-main', recallCls: 'pd-recall', listCls: 'pd-list', titleCls: day.items ? 'pd-daytitle' : null }).filter(Boolean));
  };
  drawBody();

  const body = h('div', { class: 'plan-day', style: { '--pc': phase.color } },
    listHolder,
    h('ol', { class: 'pd-steps' }, steps.map(s => h('li', null, h('b', null, s.name), h('span', { class: 'muted' }, ` ${s.min} min`), s.text ? h('div', { class: 'small muted' }, s.text) : null))),
    h('div', { class: 'pd-move' }, icon('calendar', 15), h('span', null, 'Date'), dateIn,
      h('span', { class: 'muted small' }, 'Moving a day keeps the rest of the plan where it is.')),
    editBox);

  dateIn.addEventListener('change', () => {
    if (!isYmd(dateIn.value) || dateIn.value === day.date) return;
    m.close();
    movePlanDay(plan, day, dateIn.value);
  });

  const editBtn = h('button', { class: 'btn ghost', onclick: () => {
    editBox.hidden = !editBox.hidden;
    editBtn.classList.toggle('on', !editBox.hidden);
    saveBtn.hidden = editBox.hidden;
    if (!editBox.hidden) mainIn.focus();
  } }, icon('edit', 14), 'Edit text');
  const saveBtn = h('button', { class: 'btn primary', hidden: true, onclick: () => {
    const title = titleIn.value.trim() || day.title;
    m.close();
    Store.commit('Plan day updated', () => {
      day.title = title;
      if (day.items) {
        const lines = mainIn.value.split('\n').map(s => s.trim()).filter(Boolean);
        const old = day.items;
        day.items = lines.map((text, k) => {
          const same = old.find(i => i.text === text);
          return { id: same ? same.id : `${day.id}-${uid()}`, text, done: same ? same.done : false };
        });
        if (!day.items.length) { delete day.items; day.main = ''; }
        else day.done = day.items.every(i => i.done);
      } else {
        day.main = mainIn.value.trim();
        day.recall = recallIn.value.trim();
      }
    });
  } }, 'Save text');

  const m = openModal({
    title: `${plan.short || plan.title} · ${fmtDateLong(day.date)}`,
    className: 'plan-day-modal',
    body,
    footer: [
      editBtn,
      h('button', { class: 'btn ghost', onclick: () => { m.close(); App.openPlan(plan.id, day.date); } }, icon('book', 14), 'Open plan'),
      h('div', { class: 'spacer' }),
      saveBtn,
      h('button', { class: 'btn', onclick: () => { m.close(); togglePlanDay(plan, day); } }, icon('check', 14), day.done ? 'Mark not done' : (day.items ? 'Tick all' : 'Mark done')),
      !day.done ? h('button', { class: 'btn primary', onclick: () => { m.close(); Pomo.startSession(plan, day); } }, icon('play', 13), `Start ${planDur(plan, day)}-min session`) : null,
    ],
  });
  // Ticking items inside the dialog re-renders the app; keep the dialog's own list in step.
  const redraw = () => { if (!m.closed) drawBody(); };
  m.el.addEventListener('click', e => { if (e.target.closest('.check')) requestAnimationFrame(redraw); });
}

// ── Today's study card (right panel) ────────────────────────────────────
function renderStudyCard() {
  const card = $('#studyCard');
  if (!card) return;
  const today = todayYmd();
  const blocks = [];
  for (const plan of Store.d.plans) {
    const days = planDaysSorted(plan);
    if (!days.length) continue;
    const examDate = planExamDate(plan);
    const last = days[days.length - 1].date;
    const end = examDate && examDate > last ? examDate : last;
    if (today > end) continue;
    blocks.push(studyBlock(plan, days, today, examDate));
  }
  card.hidden = !blocks.length;
  card.replaceChildren(...blocks);
}

function toggleStudyCollapsed(planId) {
  const S = Store.d.settings;
  const set = new Set(S.collapsedStudy || []);
  if (set.has(planId)) set.delete(planId); else set.add(planId);
  S.collapsedStudy = [...set];
  Store.quiet();
  renderStudyCard();
}

function studyBlock(plan, days, today, examDate) {
  const todays = days.filter(d => d.date === today);
  const missed = days.filter(d => d.date < today && !d.done);
  const next = days.find(d => d.date > today);
  const st = Pomo.st || {};
  const collapsed = (Store.d.settings.collapsedStudy || []).includes(plan.id);
  const allDone = todays.length > 0 && todays.every(d => d.done);
  const label = milestoneLabel(plan);

  let summary = '';
  if (todays.length === 1) {
    const prog = planDayProgress(todays[0]);
    summary = todays[0].done ? 'Done for today' : todays[0].title + (prog ? ` · ${prog.done}/${prog.total}` : '');
  } else if (!todays.length) summary = examDate === today ? `${label} today` : 'No job today';

  const head = h('div', { class: 'card-h study-head' },
    h('button', { class: 'study-toggle', title: collapsed ? 'Show today’s job' : 'Hide', 'aria-expanded': String(!collapsed), onclick: () => toggleStudyCollapsed(plan.id) },
      icon(collapsed ? 'chevronRight' : 'chevronDown', 14),
      h('span', { class: 'card-title' }, plan.short || plan.title),
      collapsed && summary ? h('span', { class: 'study-sum' + (allDone ? ' ok' : '') }, summary) : null),
    h('div', { class: 'card-h-right' },
      // Once a mid-plan milestone has passed, the countdown has nothing left to say.
      examDate && examDate >= today && !collapsed ? h('span', { class: 'study-left' }, daysLeftText(examDate, today, true, label)) : null,
      h('button', { class: 'icon-btn sm', title: 'Open the plan', onclick: () => App.openPlan(plan.id, today) }, icon('book', 15))));
  if (collapsed) return h('div', { class: 'study-plan collapsed' }, head);

  const parts = [head];
  if (!todays.length) {
    if (examDate === today) parts.push(h('p', { class: 'study-empty' }, h('b', null, `${label} today.`), ' You have done the work. Good luck.'));
    else if (next) {
      parts.push(h('p', { class: 'study-empty' }, 'No study job today. Next: ',
        h('button', { class: 'linkish', onclick: () => openPlanDay(plan, next) }, `${relDay(next.date, today)} · ${next.title}`)));
    }
  }
  for (const d of todays) {
    const phase = planPhase(plan, d);
    const idx = days.indexOf(d) + 1;
    const prog = planDayProgress(d);
    const inSession = st.seq && st.seq.dayId === d.id;
    const finished = st.finished && st.finished.dayId === d.id && !d.done;
    const block = h('div', { class: 'study-day' + (d.done ? ' done' : '') + (finished ? ' finished' : ''), style: { '--pc': phase.color } },
      h('div', { class: 'study-meta' },
        h('span', { class: 'pd-phase' }, h('i'), phase.title),
        h('span', { class: 'muted' }, `Day ${idx} of ${days.length}`),
        prog && !d.done ? h('span', { class: 'muted' }, `${prog.done} of ${prog.total}`) : null));
    if (!d.done) block.append(...dayBody(plan, d, { mainCls: 'study-main', recallCls: 'study-recall', listCls: 'study-list', titleCls: 'study-title' }).filter(Boolean));
    else block.append(h('p', { class: 'study-title muted' }, d.title));
    const actions = h('div', { class: 'study-actions' });
    if (d.done) {
      actions.append(h('span', { class: 'study-done' }, icon('check', 14), 'Done for today'),
        h('button', { class: 'linkish small', onclick: () => togglePlanDay(plan, d) }, 'Undo'));
    } else if (inSession) {
      actions.append(h('span', { class: 'study-live' }, h('i'), `${st.seq.steps[st.seq.idx].name} · step ${st.seq.idx + 1} of ${st.seq.steps.length}`),
        h('button', { class: 'btn sm', onclick: () => togglePlanDay(plan, d) }, icon('check', 13), d.items ? 'Tick all' : 'Mark done'));
    } else {
      if (finished) actions.append(h('span', { class: 'study-finished' }, d.items ? 'Session finished. Tick what you got through.' : 'Session finished. Checked your work?'));
      actions.append(
        h('button', { class: 'btn sm ' + (finished ? '' : 'primary'), onclick: () => Pomo.startSession(plan, d) }, icon('play', 12), finished ? 'Again' : `Start ${planDur(plan, d)}-min session`),
        h('button', { class: 'btn sm ' + (finished ? 'primary' : ''), onclick: () => togglePlanDay(plan, d) }, icon('check', 13), d.items ? 'Tick all' : 'Mark done'));
    }
    block.append(actions);
    parts.push(block);
  }
  if (missed.length) {
    parts.push(h('button', { class: 'study-missed', onclick: () => App.openPlan(plan.id, missed[0].date) },
      `${plural(missed.length, 'earlier day')} not ticked yet`, icon('chevronRight', 14)));
  }
  return h('div', { class: 'study-plan' }, parts);
}

// ── Sidebar list ────────────────────────────────────────────────────────
function renderPlansList() {
  const box = $('#plansList');
  if (!box) return;
  box.closest('.side-sec').hidden = !Store.d.plans.length;
  box.replaceChildren(...Store.d.plans.map(p => {
    const total = p.days.length, done = p.days.filter(d => d.done).length;
    const on = App.state.view === 'plan' && App.state.planId === p.id;
    const color = (p.phases[0] && p.phases[0].color) || 'var(--accent)';
    return h('button', { class: 'plan-link' + (on ? ' on' : ''), style: { '--pc': color }, onclick: () => App.openPlan(p.id) },
      h('span', { class: 'plan-link-t' }, h('i', { class: 'plan-dot' }), h('span', null, p.title)),
      h('span', { class: 'plan-link-p' },
        h('span', { class: 'plan-bar' }, h('i', { style: { width: (total ? (done / total) * 100 : 0) + '%' } })),
        h('span', { class: 'plan-link-n' }, `${done}/${total}`)));
  }));
}
