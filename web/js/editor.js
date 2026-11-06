'use strict';
/* The event editor modal. */

function reminderOptions(allDay) {
  if (allDay) return [['', 'No reminder'], [0, `On the day at ${fmtTime(540)}`], [1440, `The day before at ${fmtTime(540)}`]];
  return [['', 'No reminder'], [0, 'At start time'], [5, '5 minutes before'], [10, '10 minutes before'], [15, '15 minutes before'],
    [30, '30 minutes before'], [60, '1 hour before'], [120, '2 hours before'], [1440, '1 day before']];
}

function presetOf(r, date) {
  if (!r) return 'none';
  if ((r.interval || 1) !== 1) return 'custom';
  if (r.freq === 'daily') return 'daily';
  if (r.freq === 'weekly') {
    const by = r.byDay && r.byDay.length ? [...r.byDay].sort() : [dowOf(date)];
    if (by.join() === '1,2,3,4,5') return 'weekdays';
    if (by.length === 1 && by[0] === dowOf(date)) return 'weekly';
    return 'custom';
  }
  if (r.freq === 'monthly') return 'monthly';
  if (r.freq === 'yearly') return 'yearly';
  return 'custom';
}

function defaultStartFor(date) {
  if (date !== todayYmd()) return 9 * 60;
  return Math.min(23 * 60, Math.ceil(nowMinutes() / 30) * 30);
}

function openEditor({ occ = null, draft = {} } = {}) {
  closePopover();
  const S = Store.d.settings;
  const ev = occ ? occ.ev : null;
  const f = ev ? {
    title: ev.title, date: occ.date, allDay: ev.allDay, start: ev.start, dur: ev.dur, days: ev.days || 1,
    cat: ev.cat, location: ev.location, notes: ev.notes, reminder: ev.reminder, repeat: ev.repeat ? { ...ev.repeat } : null,
  } : {
    title: draft.title || '', date: draft.date || App.state.date, allDay: !!draft.allDay,
    start: draft.start != null ? draft.start : defaultStartFor(draft.date || App.state.date),
    dur: draft.dur || S.defaultDur, days: 1,
    cat: draft.cat || (catById(S.lastCat) ? S.lastCat : defaultCatId()),
    location: '', notes: '', reminder: draft.allDay ? null : S.defaultReminder, repeat: null,
  };
  if (f.start + 15 > 1440) f.start = 1440 - 15;

  let preset = presetOf(f.repeat, f.date);
  const custom = {
    freq: f.repeat ? f.repeat.freq : 'weekly',
    interval: f.repeat ? f.repeat.interval || 1 : 1,
    byDay: f.repeat && f.repeat.byDay && f.repeat.byDay.length ? [...f.repeat.byDay] : [dowOf(f.date)],
  };
  let untilOn = !!(f.repeat && f.repeat.until);
  let until = (f.repeat && f.repeat.until) || addMonths(f.date, 1);

  // ── Fields ──
  const titleIn = h('input', { class: 'input title-input', placeholder: 'Add a title', value: f.title, maxlength: 200, autofocus: true });

  const catRow = h('div', { class: 'cat-pills' });
  const renderCats = () => catRow.replaceChildren(...Store.d.categories.map(c => h('button', {
    type: 'button', class: 'cat-pill' + (c.id === f.cat ? ' on' : ''), style: { '--c': c.color },
    onclick: () => { f.cat = c.id; renderCats(); },
  }, h('span', { class: 'dot' }), c.name)));
  renderCats();

  const dateIn = h('input', { type: 'date', class: 'input date-input', value: f.date });
  dateIn.addEventListener('change', () => {
    if (!isYmd(dateIn.value)) { dateIn.value = f.date; return; }
    f.date = dateIn.value;
    if (preset === 'weekly') custom.byDay = [dowOf(f.date)];
    renderRepeat();
    syncAllDayEnd();
  });

  const durHint = h('span', { class: 'hint' });
  const startField = timeField({
    value: f.start,
    onChange: v => { f.start = clamp(v, 0, 1440 - 15); startField.value = f.start; endField.value = f.start + f.dur; syncHint(); },
  });
  const endField = timeField({
    value: f.start + f.dur,
    listFrom: () => f.start,
    durationFrom: () => f.start,
    onChange: v => {
      let d = v - f.start;
      if (d <= 0) d += 1440;
      f.dur = clamp(d, 5, 1440);
      endField.value = f.start + f.dur;
      syncHint();
    },
  });
  function syncHint() {
    durHint.textContent = fmtDur(f.dur) + (f.start + f.dur > 1440 ? ' · ends next day' : '');
  }
  syncHint();

  const allDayEnd = h('input', { type: 'date', class: 'input date-input', value: addDays(f.date, f.days - 1) });
  allDayEnd.addEventListener('change', () => {
    if (!isYmd(allDayEnd.value)) return;
    f.days = Math.max(1, diffDays(f.date, allDayEnd.value) + 1);
    syncAllDayEnd();
  });
  function syncAllDayEnd() { allDayEnd.min = f.date; allDayEnd.value = addDays(f.date, f.days - 1); }
  syncAllDayEnd();

  const allDayBox = h('input', { type: 'checkbox', checked: f.allDay });
  const timeRow = h('div', { class: 'time-row' });
  function renderTimeRow() {
    timeRow.replaceChildren(...(f.allDay
      ? [h('span', { class: 'muted' }, 'to'), allDayEnd]
      : [startField.el, h('span', { class: 'muted' }, 'to'), endField.el, durHint]));
  }
  allDayBox.addEventListener('change', () => {
    f.allDay = allDayBox.checked;
    if (f.allDay && f.reminder != null && f.reminder !== 0 && f.reminder !== 1440) f.reminder = null;
    renderTimeRow();
    renderReminder();
  });
  renderTimeRow();

  // Repeat
  const repeatBox = h('div', { class: 'repeat-box' });
  function renderRepeat() {
    const wd = WEEKDAYS[dowOf(f.date)];
    const sel = selectBox(preset, [
      ['none', 'Does not repeat'], ['daily', 'Every day'], ['weekdays', 'Every weekday (Mon to Fri)'],
      ['weekly', `Weekly on ${wd}`], ['monthly', `Monthly on day ${ymdParts(f.date)[2]}`],
      ['yearly', `Annually on ${fmtMonthDay(f.date)}`], ['custom', 'Custom…'],
    ], v => {
      preset = v;
      if (v === 'custom' && custom.freq === 'weekly' && !custom.byDay.length) custom.byDay = [dowOf(f.date)];
      renderRepeat();
    });
    const parts = [sel];
    if (preset === 'custom') {
      const n = h('input', { type: 'number', class: 'input num', min: 1, max: 99, value: custom.interval });
      n.addEventListener('change', () => { custom.interval = clamp(Math.round(+n.value || 1), 1, 99); n.value = custom.interval; });
      const unit = selectBox(custom.freq, [['daily', 'day(s)'], ['weekly', 'week(s)'], ['monthly', 'month(s)'], ['yearly', 'year(s)']], v => { custom.freq = v; renderRepeat(); });
      parts.push(h('div', { class: 'repeat-custom' }, h('span', { class: 'muted' }, 'Every'), n, unit));
      if (custom.freq === 'weekly') {
        parts.push(h('div', { class: 'weekday-toggles' }, Array.from({ length: 7 }, (_, i) => {
          const dIdx = (S.weekStart + i) % 7;
          return h('button', {
            type: 'button', class: 'wd-toggle' + (custom.byDay.includes(dIdx) ? ' on' : ''), title: WEEKDAYS[dIdx],
            onclick: () => {
              custom.byDay = custom.byDay.includes(dIdx) ? custom.byDay.filter(x => x !== dIdx) : [...custom.byDay, dIdx];
              if (!custom.byDay.length) custom.byDay = [dowOf(f.date)];
              renderRepeat();
            },
          }, WEEKDAYS[dIdx].slice(0, 2));
        })));
      }
    }
    if (preset !== 'none') {
      const untilIn = h('input', { type: 'date', class: 'input date-input', value: until, min: f.date, disabled: !untilOn });
      untilIn.addEventListener('change', () => { if (isYmd(untilIn.value)) until = untilIn.value; });
      const endsSel = selectBox(untilOn ? 'on' : 'never', [['never', 'Never ends'], ['on', 'Ends on']], v => { untilOn = v === 'on'; renderRepeat(); });
      parts.push(h('div', { class: 'repeat-ends' }, endsSel, untilOn ? untilIn : null));
    }
    repeatBox.replaceChildren(...parts);
  }
  renderRepeat();

  const reminderWrap = h('div');
  function renderReminder() {
    reminderWrap.replaceChildren(selectBox(f.reminder == null ? '' : f.reminder, reminderOptions(f.allDay), v => { f.reminder = v === '' ? null : +v; }));
  }
  renderReminder();

  const locIn = h('input', { class: 'input', placeholder: 'Add a location or link', value: f.location, maxlength: 300 });
  const notesIn = h('textarea', { class: 'input', placeholder: 'Add notes', rows: 3 }, f.notes);

  function ruleNow() {
    let rule = null;
    switch (preset) {
      case 'daily': rule = { freq: 'daily', interval: 1 }; break;
      case 'weekdays': rule = { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5] }; break;
      case 'weekly': rule = { freq: 'weekly', interval: 1, byDay: [dowOf(f.date)] }; break;
      case 'monthly': rule = { freq: 'monthly', interval: 1 }; break;
      case 'yearly': rule = { freq: 'yearly', interval: 1 }; break;
      case 'custom':
        rule = { freq: custom.freq, interval: custom.interval };
        if (custom.freq === 'weekly') rule.byDay = [...custom.byDay].sort();
        break;
    }
    if (rule) {
      if (rule.freq === 'weekly') rule.wkst = S.weekStart;
      if (untilOn && until >= f.date) rule.until = until;
    }
    return rule;
  }

  function collect() {
    return {
      title: titleIn.value.trim(), date: f.date, allDay: f.allDay,
      start: f.start, dur: f.dur, days: f.allDay ? f.days : 1,
      cat: f.cat, location: locIn.value.trim(), notes: notesIn.value,
      reminder: f.reminder, repeat: ruleNow(),
    };
  }

  const row = (ic, ...content) => h('div', { class: 'form-row' }, h('div', { class: 'form-ic' }, icon(ic, 16)), h('div', { class: 'form-main' }, ...content));
  const body = h('div', { class: 'editor' },
    titleIn,
    catRow,
    row('clock',
      h('div', { class: 'date-row' }, dateIn, h('label', { class: 'check-label' }, allDayBox, 'All day')),
      timeRow),
    row('repeat', repeatBox),
    row('bell', reminderWrap),
    row('pin', locIn),
    row('notes', notesIn));

  const initial = JSON.stringify(collect());
  const dirty = () => JSON.stringify(collect()) !== initial;

  async function save() {
    const data = collect();
    if (data.repeat && data.repeat.until && data.repeat.until < data.date) data.repeat.until = data.date;
    S.lastCat = data.cat;
    if (!ev) {
      m.close('saved');
      Store.commit('Event added', d => { d.events.push(normalizeEvent({ id: uid('e'), ...data })); });
      return;
    }
    if (!dirty()) { m.close(); return; }
    if (ev.repeat) {
      const ruleChanged = JSON.stringify(normalizeRule(data.repeat)) !== JSON.stringify(normalizeRule(ev.repeat));
      const scope = await scopeDialog({ title: 'Save repeating event', verb: 'Save', allowOne: !ruleChanged });
      if (!scope) return;
      m.close('saved');
      Store.commit('Event updated', () => applyEventChange(occ, data, scope));
    } else {
      m.close('saved');
      Store.commit('Event updated', () => applyEventChange(occ, data, 'all'));
    }
  }

  async function remove() {
    if (ev.repeat) {
      const scope = await scopeDialog({ title: 'Delete repeating event', verb: 'Delete' });
      if (!scope) return;
      m.close('deleted');
      Store.commit('Event deleted', () => deleteOccurrence(occ, scope));
    } else {
      m.close('deleted');
      Store.commit('Event deleted', () => deleteOccurrence(occ, 'all'));
    }
  }

  const footer = [
    ev ? h('button', { class: 'btn danger', onclick: remove, title: 'Delete event' }, icon('trash', 15), 'Delete') : null,
    ev ? h('button', {
      class: 'btn ghost', title: 'Start a focus timer for this event',
      onclick: () => { m.close(); Pomo.focusOn({ label: ev.title || 'Event' }); },
    }, icon('target', 15), 'Focus') : null,
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: save }, ev ? 'Save' : 'Add event'),
  ];

  const m = openModal({
    title: ev ? 'Edit event' : 'New event',
    headExtra: ev && ev.repeat ? h('span', { class: 'head-note' }, icon('repeat', 13), describeRule(ev.repeat, ev.date)) : null,
    className: 'editor-modal',
    body,
    footer,
    canDismiss: () => !dirty(),
  });
  m.el.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.target === titleIn)) { e.preventDefault(); save(); }
  });
  return m;
}
