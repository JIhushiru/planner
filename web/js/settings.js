'use strict';
/* Settings dialog and the keyboard-shortcut sheet. Changes apply immediately. */

let settingsOnAutostart = null;
Host.on('autostart', msg => { if (settingsOnAutostart) settingsOnAutostart(msg); });

function openSettings(tab = 'general') {
  const S = Store.d.settings;
  const content = h('div', { class: 'set-content' });
  const nav = h('nav', { class: 'set-nav' });
  const tabs = [
    ['general', 'General', icon('settings', 15)],
    ['pomodoro', 'Focus timer', icon('tomato', 15, 'tomato')],
    ['categories', 'Categories', icon('dot', 15)],
    ['app', 'App and data', icon('folder', 15)],
  ];

  const apply = (fn, rerender = true) => {
    fn(S);
    Store.quiet();
    if (rerender) { Fmt.h12 = S.time12h; applyTheme(); App.render(); }
  };
  const row = (label, control, hint) => h('div', { class: 'set-row' },
    h('div', { class: 'set-label' }, h('div', null, label), hint ? h('div', { class: 'set-hint' }, hint) : null),
    h('div', { class: 'set-control' }, control));
  const num = (value, min, max, onChange, suffix) => {
    const i = h('input', { type: 'number', class: 'input num', min, max, value });
    i.addEventListener('change', () => {
      const v = clamp(Math.round(+i.value || min), min, max);
      i.value = v;
      onChange(v);
    });
    return h('span', { class: 'num-wrap' }, i, suffix ? h('span', { class: 'muted' }, suffix) : null);
  };

  const panes = {
    general: () => [
      row('Theme', selectBox(S.theme, [['system', 'Same as Windows'], ['light', 'Light'], ['dark', 'Dark (true black)']], v => apply(s => { s.theme = v; }))),
      row('Week starts on', selectBox(S.weekStart, [[0, 'Sunday'], [1, 'Monday'], [6, 'Saturday']], v => apply(s => { s.weekStart = +v; }))),
      row('Time format', selectBox(S.time12h ? '12' : '24', [['12', '12-hour (9:30 PM)'], ['24', '24-hour (21:30)']], v => apply(s => { s.time12h = v === '12'; }))),
      row('Show weekends in week view', toggleSwitch(S.showWeekends, v => apply(s => { s.showWeekends = v; }))),
      row('Day view opens at', selectBox(S.dayStart, Array.from({ length: 13 }, (_, i) => [i, fmtHour(i)]), v => apply(s => { s.dayStart = +v; }, false)),
        'Used when today is not on screen.'),
      row('Default event length', selectBox(S.defaultDur, [[15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours']], v => apply(s => { s.defaultDur = +v; }, false))),
      row('Default reminder', selectBox(S.defaultReminder == null ? '' : S.defaultReminder, reminderOptions(false), v => apply(s => { s.defaultReminder = v === '' ? null : +v; }, false))),
      row('Interface size', selectBox(S.zoom, [[0.9, '90%'], [1, '100%'], [1.1, '110%'], [1.25, '125%']], v => apply(s => { s.zoom = +v; Host.post({ type: 'zoom', factor: +v }); }, false))),
      row('Right panel order', h('button', { class: 'btn sm', onclick: () => { resetPanelOrder(); toast('Right panel back to the default order.'); } }, icon('reset', 13), 'Reset order'),
        'Hover a card and drag the handle at its top to move it.'),
      row('Timeline zoom', h('span', { class: 'muted small' }, 'Hold Ctrl and scroll over the day or week view.')),
    ],
    pomodoro: () => {
      const P = S.pomo;
      const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: P.volume, class: 'range' });
      vol.addEventListener('change', () => apply(s => { s.pomo.volume = +vol.value; }, false));
      return [
        row('Focus', num(P.focus, 1, 180, v => apply(s => { s.pomo.focus = v; }), 'min')),
        row('Short break', num(P.short, 1, 60, v => apply(s => { s.pomo.short = v; }), 'min')),
        row('Long break', num(P.long, 1, 90, v => apply(s => { s.pomo.long = v; }), 'min')),
        row('Long break after', num(P.longEvery, 2, 12, v => apply(s => { s.pomo.longEvery = v; }), 'focus sessions')),
        row('Start breaks automatically', toggleSwitch(P.autoBreak, v => apply(s => { s.pomo.autoBreak = v; }, false))),
        row('Start the next focus automatically', toggleSwitch(P.autoFocus, v => apply(s => { s.pomo.autoFocus = v; }, false))),
        row('Chime when a timer ends', toggleSwitch(P.sound, v => apply(s => { s.pomo.sound = v; }, false))),
        row('Chime volume', h('span', { class: 'range-wrap' }, vol,
          h('button', { class: 'btn sm', onclick: () => Host.chime('focusEnd', +vol.value) }, icon('play', 12), 'Test'))),
        row('Windows notification', toggleSwitch(P.notify, v => apply(s => { s.pomo.notify = v; }, false)), 'Shown when Planner is not the window in front.'),
        row('Study sessions', h('span', { class: 'muted small' }, 'Plans run their own steps (for example Recall 10, Main job 40, Check 10). Start one from a plan day.')),
      ];
    },
    categories: () => {
      const list = h('div', { class: 'cat-edit' });
      const draw = () => list.replaceChildren(...Store.d.categories.map(c => {
        const name = h('input', { class: 'input', value: c.name, maxlength: 40 });
        name.addEventListener('change', () => { const v = name.value.trim(); if (v) { c.name = v; Store.quiet(); App.render(); } else name.value = c.name; });
        const sw = h('button', { class: 'swatch big', style: { '--c': c.color }, title: 'Change colour' });
        sw.addEventListener('click', () => colorPicker(sw, c.color, col => { c.color = col; Store.quiet(); App.render(); draw(); }));
        const used = Store.d.events.filter(e => e.cat === c.id).length;
        return h('div', { class: 'cat-edit-row' }, sw, name,
          h('span', { class: 'muted small' }, plural(used, 'event')),
          h('button', {
            class: 'icon-btn sm', title: 'Delete category', disabled: Store.d.categories.length <= 1,
            onclick: async () => {
              const others = Store.d.categories.filter(x => x.id !== c.id);
              if (used) {
                const ok = await confirmDialog({ title: `Delete “${c.name}”?`, text: `${plural(used, 'event')} will move to “${others[0].name}”.`, ok: 'Delete', danger: true });
                if (!ok) return;
              }
              Store.commit(`Deleted category ${c.name}`, d => {
                d.events.forEach(e => { if (e.cat === c.id) e.cat = others[0].id; });
                d.categories = d.categories.filter(x => x.id !== c.id);
                d.hiddenCats = d.hiddenCats.filter(x => x !== c.id);
              });
              draw();
            },
          }, icon('trash', 14)));
      }));
      draw();
      return [
        list,
        h('button', {
          class: 'btn', onclick: () => {
            const used = new Set(Store.d.categories.map(c => c.color.toLowerCase()));
            const color = CAT_PALETTE.find(c => !used.has(c.toLowerCase())) || CAT_PALETTE[0];
            Store.d.categories.push({ id: uid('c'), name: 'New category', color });
            Store.quiet();
            App.render();
            draw();
            const inputs = $$('.cat-edit input', list);
            if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
          },
        }, icon('plus', 14), 'Add category'),
      ];
    },
    app: () => {
      const boot = App.boot || {};
      const auto = toggleSwitch(!!boot.autostart, v => Host.post({ type: 'setAutostart', enabled: v }));
      return [
        row('Keep running in the tray when closed', toggleSwitch(S.closeToTray, v => apply(s => { s.closeToTray = v; Host.post({ type: 'hostSettings', closeToTray: v }); }, false)),
          'Timers and reminders keep working. Quit from the tray icon.'),
        row('Start Planner with Windows', Host.native ? auto : h('span', { class: 'muted small' }, 'Available in the desktop app'), 'Starts quietly in the tray.'),
        row('Event reminders', toggleSwitch(S.notifyEvents, v => apply(s => { s.notifyEvents = v; }, false)), 'Windows notifications before events that have a reminder.'),
        h('div', { class: 'set-sep' }),
        row('Back up your planner', h('div', { class: 'btn-row' },
          h('button', { class: 'btn sm', onclick: () => exportData() }, icon('download', 14), 'Export…'),
          h('button', { class: 'btn sm', onclick: () => importData() }, icon('upload', 14), 'Import…'),
          Host.native ? h('button', { class: 'btn sm', onclick: () => Host.post({ type: 'openDataFolder' }) }, icon('folder', 14), 'Open folder') : null),
        'Planner also keeps a copy of each day in the backups folder.'),
        row('Data file', h('code', { class: 'path' }, boot.dataPath || '')),
        row('Version', h('span', { class: 'muted' }, `Planner ${boot.version || ''}`)),
        Host.native ? row('Quit Planner', h('button', { class: 'btn sm danger', onclick: () => Host.post({ type: 'quit' }) }, 'Quit')) : null,
      ];
    },
  };

  function show(name) {
    tab = name;
    $$('button', nav).forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    content.replaceChildren(...panes[name]().filter(Boolean));
  }
  tabs.forEach(([key, label, ic]) => nav.append(h('button', { dataset: { tab: key }, onclick: () => show(key) }, ic, label)));
  const m = openModal({
    title: 'Settings', className: 'settings-modal',
    body: h('div', { class: 'settings' }, nav, content),
    onClose: () => { settingsOnAutostart = null; },
  });
  settingsOnAutostart = msg => { App.boot.autostart = msg.enabled; if (tab === 'app') show('app'); };
  show(tab);
}

function exportData() {
  if (Host.native) { Host.post({ type: 'exportData' }); return; }
  const blob = new Blob([JSON.stringify(Store.d, null, 1)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `planner-backup-${todayYmd()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
}

function importData() {
  if (Host.native) { Host.post({ type: 'importData' }); return; }
  const input = h('input', { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (file) applyImport(await file.text(), file.name);
  });
  input.click();
}

async function applyImport(json, name) {
  let data;
  try { data = JSON.parse(json); } catch { toast('That file is not a Planner backup.'); return; }
  if (!data || typeof data !== 'object' || !Array.isArray(data.events) || !data.settings) { toast('That file is not a Planner backup.'); return; }
  const ok = await confirmDialog({
    title: 'Replace everything with this backup?',
    text: `Your current planner will be replaced by “${name || 'the backup'}” (${plural(data.events.length, 'event')}, ${plural((data.tasks || []).length, 'task')}). A copy of the current data is saved first.`,
    ok: 'Replace', danger: true,
  });
  if (!ok) return;
  Host.post({ type: 'snapshot', tag: 'before-import' });
  Pomo.reset();
  Store.d = normalizeData(data);
  Store.undoStack = [];
  // Never resume a timer from someone else's file; start idle.
  Store.d.pomo = { ...pomoDefaults(), ...(Store.d.pomo || {}), seq: null, status: 'idle', endAt: null, token: null, remaining: null };
  Store.persist();
  closeAllModals();
  Fmt.h12 = Store.d.settings.time12h;
  applyTheme();
  App.render();
  toast('Backup imported.');
}

function showShortcuts() {
  const keys = [
    ['T', 'Go to today'], ['D / W / M', 'Day, week or month view'], ['← / →', 'Previous / next period'],
    ['N', 'New event'], ['H', 'Daily health: medicines, water, workout, jogging weather'], ['P or Space', 'Start or pause the focus timer'], ['Ctrl + Z', 'Undo the last change'],
    ['Ctrl + ,', 'Settings'], ['[ / ]', 'Hide or show the side panels'], ['Ctrl + scroll', 'Zoom the day and week views'],
    ['Esc', 'Close a dialog or cancel a drag'], ['?', 'This list'],
  ];
  openModal({
    title: 'Keyboard shortcuts', className: 'small',
    body: h('div', { class: 'keys' }, keys.map(([k, v]) => h('div', { class: 'key-row' }, h('kbd', null, k), h('span', null, v)))),
  });
}
