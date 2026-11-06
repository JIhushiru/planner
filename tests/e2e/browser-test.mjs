// Serves the web UI, opens it in headless Edge and records errors + screenshots.
// Usage: node browser-test.mjs <webDir> <outDir> [scenario]
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { connect, sleep, waitForJson, screenshot } from './cdp.mjs';

const [webArg, outDir, scenario = 'basic'] = process.argv.slice(2);
const webDir = path.resolve(webArg);
fs.mkdirSync(outDir, { recursive: true });
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // Sample plans stand in for a personal seed.local.js, so runs never depend on (or show) one.
  const file = p === '/js/seed.local.js' ? path.join(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..', 'fixtures', 'plans.js')
    : path.join(webDir, p === '/' ? 'index.html' : p);
  if ((p !== '/js/seed.local.js' && !file.startsWith(webDir + path.sep)) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const dbg = 9000 + Math.floor(Math.random() * 500);
const profile = path.join(outDir, 'profile-' + Date.now());
const proc = spawn(edge, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

const errors = [];
const results = [];
try {
  const targets = await waitForJson(dbg);
  const page = targets.find(t => t.type === 'page');
  const c = await connect(page.webSocketDebuggerUrl);
  c.on(msg => {
    if (msg.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 1500));
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) errors.push('CONSOLE ' + msg.params.type + ': ' + msg.params.args.map(a => a.value ?? a.description).join(' '));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push('LOG ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
  });
  await c.send('Runtime.enable');
  await c.send('Log.enable');
  await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const dark = scenario.includes('dark');
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  // Pin "today" to the plan's first day at 2:20 PM so the screenshots are meaningful.
  const fakeNow = new Date(2026, 10, 6, 14, 20, 0).getTime();
  // __travel(ms) moves the fake clock later in a scenario (then re-render).
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { let off = ${fakeNow} - Date.now(); const D = Date; class FD extends D { constructor(...a) { if (a.length === 0) super(D.now() + off); else super(...a); } static now() { return D.now() + off; } } window.Date = FD; window.__travel = t => { off = t - D.now(); }; })();` });
  await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
  await sleep(1500);
  const shot = async name => { await sleep(350); await screenshot(c, path.join(outDir, name + '.png'), fs); };
  await shot('01-week');

  const steps = {
    async views() {
      await c.evaluate(`App.setView('day')`); await shot('02-day');
      await c.evaluate(`App.setView('month')`); await shot('03-month');
      await c.evaluate(`App.openPlan('plan-exam')`); await shot('04-plan');
      await c.evaluate(`App.setView('week')`);
    },
    async editor() {
      await c.evaluate(`openEditor({ draft: { date: '2026-11-06', start: 600, dur: 90 } })`); await shot('05-editor');
      await c.evaluate(`document.querySelector('.title-input').value = 'Weekly lecture'; document.querySelector('.repeat-box select').value = 'weekly'; document.querySelector('.repeat-box select').dispatchEvent(new Event('change'));`);
      await shot('06-editor-repeat');
      await c.evaluate(`[...document.querySelectorAll('.modal-f .btn.primary')].pop().click()`);
      await shot('07-after-add');
    },
    async session() {
      await c.evaluate(`Pomo.startSession(planById('plan-exam'), planById('plan-exam').days[0])`);
      await shot('08-session');
      await c.evaluate(`openPlanDay(planById('plan-exam'), planById('plan-exam').days[0])`); await shot('09-planday');
      await c.evaluate(`closeAllModals(); openSettings('pomodoro')`); await shot('10-settings');
      await c.evaluate(`closeAllModals()`);
    },
  };
  const mouse = (type, x, y, buttons = 0) => c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
  const drag = async (x1, y1, x2, y2, n = 8) => {
    await mouse('mouseMoved', x1, y1);
    await mouse('mousePressed', x1, y1, 1);
    for (let i = 1; i <= n; i++) await mouse('mouseMoved', x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n, 1);
    await mouse('mouseReleased', x2, y2);
    await sleep(300);
  };
  const key = async (k, code, vk, modifiers = 0) => {
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers, text: modifiers ? undefined : k.length === 1 ? k : undefined });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await sleep(200);
  };
  const expect = (name, got, want) => results.push(`${JSON.stringify(got) === JSON.stringify(want) ? 'PASS' : 'FAIL'} ${name}: got ${JSON.stringify(got)}${JSON.stringify(got) === JSON.stringify(want) ? '' : ' want ' + JSON.stringify(want)}`);
  const rectOf = sel => c.evaluate(`(() => { const el = ${sel}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const evBlock = title => `[...document.querySelectorAll('#main .ev')].find(x => x.textContent.includes(${JSON.stringify(title)}))`;
  const findEv = title => c.evaluate(`(() => { const e = Store.d.events.find(e => e.title === ${JSON.stringify(title)}); return e ? { date: e.date, start: e.start, dur: e.dur } : null; })()`);

  steps.drag = async () => {
    const H = await c.evaluate('Store.d.settings.hourHeight');
    await c.evaluate(`App.state.date = '2026-11-06'; App.resetScroll = true; App.setView('week')`);
    await sleep(300);
    await c.evaluate(`document.querySelector('.tl-scroll').scrollTop = 8 * ${H}`);
    await sleep(150);
    const col = d => rectOf(`document.querySelector('.tl-col[data-date="${d}"]')`);

    let r = await col('2026-11-04');
    await drag(r.x + r.w / 2, r.y + 10 * H + 3, r.x + r.w / 2, r.y + 11.5 * H - 3);
    const ed = await c.evaluate(`({ open: !!document.querySelector('.editor'), start: document.querySelectorAll('.time-input')[0]?.value, end: document.querySelectorAll('.time-input')[1]?.value })`);
    expect('drag across empty time opens the editor with that span', ed, { open: true, start: '10:00 AM', end: '11:30 AM' });
    await c.evaluate(`document.querySelector('.title-input').value = 'Dragged'; [...document.querySelectorAll('.modal-f .btn.primary')].pop().click()`);
    await sleep(300);
    expect('event created', await findEv('Dragged'), { date: '2026-11-04', start: 600, dur: 90 });

    let b = await rectOf(evBlock('Dragged'));
    r = await col('2026-11-05');
    await drag(b.x + b.w / 2, b.y + 10, r.x + r.w / 2, b.y + 10 + 3 * H);
    expect('drag a block to the next day, 3 h later', await findEv('Dragged'), { date: '2026-11-05', start: 780, dur: 90 });

    b = await rectOf(evBlock('Dragged'));
    await drag(b.x + b.w / 2, b.y + b.h - 2, b.x + b.w / 2, b.y + b.h - 2 + 0.5 * H);
    expect('drag the bottom edge to resize', await findEv('Dragged'), { date: '2026-11-05', start: 780, dur: 120 });

    await key('z', 'KeyZ', 90, 2);
    expect('Ctrl+Z undoes the resize', await findEv('Dragged'), { date: '2026-11-05', start: 780, dur: 90 });

    // Repeating event: dragging one occurrence asks which ones to change.
    await c.evaluate(`Store.commit('x', d => d.events.push(normalizeEvent({ id: 'rep', title: 'Weekly class', date: '2026-10-30', start: 9*60, dur: 60, cat: 'c-class', repeat: { freq: 'weekly', byDay: [5] } })), { toast: false })`);
    await c.evaluate(`document.querySelector('.tl-scroll').scrollTop = 8 * ${H}`);
    await sleep(150);
    b = await rectOf(evBlock('Weekly class'));
    await drag(b.x + b.w / 2, b.y + 8, b.x + b.w / 2, b.y + 8 + H);
    expect('scope dialog appears', await c.evaluate(`[...document.querySelectorAll('.radio span')].map(s => s.textContent)`), ['This event', 'This and following events', 'All events']);
    await c.evaluate(`[...document.querySelectorAll('.modal-f .btn.primary')].pop().click()`);
    await sleep(300);
    expect('"This event" detaches only Nov 6', await c.evaluate(`(() => { const s = Store.d.events.find(e => e.id === 'rep'); const copy = Store.d.events.find(e => e.seriesId === 'rep'); return [s.exceptions, copy && copy.date, copy && copy.start, s.start]; })()`), [['2026-11-06'], '2026-11-06', 600, 540]);

    // Month view: drag a plan day, tick another.
    await c.evaluate(`App.setView('month')`);
    await sleep(300);
    const chip = await rectOf(`document.querySelector('.m-cell[data-drop-date="2026-11-07"] .chip-plan')`);
    const cell = await rectOf(`document.querySelector('.m-cell[data-drop-date="2026-11-09"]')`);
    await drag(chip.x + chip.w / 2 + 10, chip.y + chip.h / 2, cell.x + cell.w / 2, cell.y + cell.h - 18);
    expect('drag a plan day to another date', await c.evaluate(`planById('plan-exam').days.find(d => d.id === 'd02').date`), '2026-11-09');
    await key('z', 'KeyZ', 90, 2);
    expect('undo the plan move', await c.evaluate(`planById('plan-exam').days.find(d => d.id === 'd02').date`), '2026-11-07');
    const chk = await rectOf(`document.querySelector('.m-cell[data-drop-date="2026-11-06"] .chip-check')`);
    await mouse('mouseMoved', chk.x + 6, chk.y + 6);
    await mouse('mousePressed', chk.x + 6, chk.y + 6, 1);
    await mouse('mouseReleased', chk.x + 6, chk.y + 6);
    await sleep(300);
    expect('tick a plan day from the calendar', await c.evaluate(`planById('plan-exam').days[0].done`), true);
    await shot('11-month-after');

    // Keyboard shortcuts.
    await c.evaluate(`document.activeElement && document.activeElement.blur()`);
    await key('d', 'KeyD', 68);
    expect('D opens day view', await c.evaluate('App.state.view'), 'day');
    await key('n', 'KeyN', 78);
    expect('N opens a new event', await c.evaluate(`!!document.querySelector('.editor')`), true);
    await key('Escape', 'Escape', 27);
    expect('Esc closes it', await c.evaluate(`!!document.querySelector('.editor')`), false);
    await key('m', 'KeyM', 77);
    expect('M opens month view', await c.evaluate('App.state.view'), 'month');
    await key('ArrowRight', 'ArrowRight', 39);
    expect('Right arrow moves a month', await c.evaluate('App.state.date.slice(0, 7)'), '2026-12');
    await key('t', 'KeyT', 84);
    expect('T returns to today', await c.evaluate('App.state.date'), '2026-11-06');
    await key('p', 'KeyP', 80);
    expect('P starts the focus timer', await c.evaluate('Pomo.st.status'), 'running');
    await key('p', 'KeyP', 80);
    expect('P pauses it', await c.evaluate('Pomo.st.status'), 'paused');
  };

  steps.flows = async () => {
    const ff = async ms => { await c.evaluate(`Pomo.st.endAt = Date.now() + 300; Pomo.arm();`); await sleep(ms); };
    // Classic Pomodoro: focus completes, gets logged, short break starts by itself.
    await c.evaluate(`Pomo.reset(); Pomo.start();`);
    await ff(1200);
    expect('focus completes, is logged and the break starts', await c.evaluate(`[Pomo.st.mode, Pomo.st.status, Store.d.pomoLog.length, Pomo.st.cycle]`), ['short', 'running', 1, 1]);
    await ff(1200);
    expect('break ends and waits for you (auto-start focus is off)', await c.evaluate(`[Pomo.st.mode, Pomo.st.status]`), ['focus', 'idle']);

    // Study session: three steps flow into each other, then ask to tick the day.
    await c.evaluate(`Pomo.startSession(planById('plan-exam'), planById('plan-exam').days[0])`);
    await sleep(300);
    expect('session starts on Recall', await c.evaluate(`[Pomo.st.seq.steps[Pomo.st.seq.idx].name, Pomo.st.status, Math.round(Pomo.remaining() / 60000)]`), ['Recall', 'running', 10]);
    await ff(1000);
    expect('then Main job, 40 min', await c.evaluate(`[Pomo.st.seq.steps[Pomo.st.seq.idx].name, Pomo.st.status, Math.round(Pomo.remaining() / 60000)]`), ['Main job', 'running', 40]);
    await ff(1000);
    await ff(1200);
    expect('session finished, prompts to tick the day', await c.evaluate(`[Pomo.st.seq, Pomo.st.finished && Pomo.st.finished.dayId, !!document.querySelector('.study-finished')]`), [null, 'd01', true]);
    expect('all three steps logged as study time', await c.evaluate(`Store.d.pomoLog.filter(e => e.planId).map(e => e.min)`), [10, 40, 10]);
    await shot('12-session-finished');

    // Tasks.
    await c.evaluate(`(() => { const i = document.querySelector('.task-add input'); i.value = 'Email advisor'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await sleep(200);
    expect('task added for today', await c.evaluate(`Store.d.tasks.map(t => [t.title, t.date, t.done])`), [['Email advisor', '2026-11-06', false]]);
    await c.evaluate(`document.querySelector('#tasksCard .task .check').click()`);
    expect('task ticked', await c.evaluate(`Store.d.tasks[0].done`), true);
    await c.evaluate(`Store.commit('t', d => d.tasks.push(normalizeTask({ id: 'old', title: 'Old reading', date: '2026-11-04' })), { toast: false })`);
    expect('unfinished earlier task carried into today', await c.evaluate(`[...document.querySelectorAll('.task-overdue .task-title')].map(x => x.textContent)`), ['Old reading']);
    await c.evaluate(`Pomo.reset(); Pomo.focusOn({ label: 'Old reading', taskId: 'old' })`);
    await sleep(200);
    expect('focus on a task starts a focus timer for it', await c.evaluate(`[Pomo.st.mode, Pomo.st.status, Pomo.st.taskId]`), ['focus', 'running', 'old']);
    await ff(1200);
    expect('finished focus session counts on the task', await c.evaluate(`Store.d.tasks.find(t => t.id === 'old').pomos`), 1);

    // Reminders handed to the host.
    await c.evaluate(`window.__rem = []; Host.reminders = items => { window.__rem = items; };`);
    await c.evaluate(`Store.commit('e', d => d.events.push(normalizeEvent({ id: 'r1', title: 'Office hours', date: '2026-11-06', start: 16 * 60, dur: 60, reminder: 15, cat: 'c-class' })), { toast: false }); scheduleReminders();`);
    expect('event reminder 15 min before', await c.evaluate(`window.__rem.filter(r => r.title === 'Office hours').map(r => new Date(r.at).toTimeString().slice(0, 5))`), ['15:45']);
    await c.evaluate(`Store.commit('p', () => { planById('plan-exam').time = 19 * 60; }, { toast: false }); scheduleReminders();`);
    expect('timed plan reminds 10 min before each unticked day', await c.evaluate(`window.__rem.filter(r => r.title.startsWith('Course A')).map(r => [r.title, new Date(r.at).toTimeString().slice(0, 5)])`),
      [['Course A · Chapter 1 statements', '18:50'], ['Course A · Chapter 1 proofs', '18:50'], ['Course A · Chapter 2 statements', '18:50']]);
    await c.evaluate(`App.setView('day')`);
    await shot('13-timed-plan-day');

    // Undo from a stale toast must not undo something else.
    await c.evaluate(`clearToasts(); Store.commit('First change', d => { d.events.push(normalizeEvent({ id: 'u1', title: 'U1', date: '2026-11-06', start: 600, dur: 30 })); }); Store.commit('Second change', d => { d.events.push(normalizeEvent({ id: 'u2', title: 'U2', date: '2026-11-06', start: 700, dur: 30 })); });`);
    await c.evaluate(`[...document.querySelectorAll('.toast')].find(t => t.textContent.includes('First change')).querySelector('button').click()`);
    expect('stale toast Undo refuses and keeps both changes', await c.evaluate(`['u1', 'u2'].map(id => Store.d.events.some(e => e.id === id))`), [true, true]);
  };

  steps.checklist = async () => {
    expect('all four plans in the sidebar', await c.evaluate(`[...document.querySelectorAll('#plansList .plan-link-t span:last-child')].map(s => s.textContent)`), ['Course A Exam Plan', 'Course B Review Plan', 'Course C Exam Plan', 'Course D Study Plan']);
    expect('a study block per plan today', await c.evaluate(`[...document.querySelectorAll('#studyCard .study-head .card-title')].map(s => s.textContent)`), ['Course A', 'Course B', 'Course C', 'Course D']);
    await shot('20-two-plans-week');
    // Tick the first two Course B items from the right panel.
    for (let i = 0; i < 2; i++) {
      await c.evaluate(`[...document.querySelectorAll('#studyCard .study-plan')][1].querySelectorAll('.checklist .check')[${i}].click()`);
      await sleep(150);
    }
    expect('items ticked from the study card', await c.evaluate(`planById('plan-review').days[0].items.map(i => i.done)`), [true, true, false, false]);
    expect('progress shows 2 of 4', await c.evaluate(`[...document.querySelectorAll('#studyCard .study-plan')][1].querySelector('.study-meta').textContent.includes('2 of 4')`), true);
    // Collapse Course A to make room.
    await c.evaluate(`[...document.querySelectorAll('#studyCard .study-toggle')][0].click()`);
    await sleep(150);
    expect('first block collapses to one line', await c.evaluate(`[...document.querySelectorAll('#studyCard .study-plan')][0].classList.contains('collapsed')`), true);
    await shot('21-panel-collapsed');
    // Finish the day: ticking the last two items marks it done.
    for (let i = 0; i < 2; i++) {
      await c.evaluate(`(() => { const b = [...document.querySelectorAll('#studyCard .study-plan')][1]; const boxes = [...b.querySelectorAll('.checklist .check:not(.on)')]; boxes[0].click(); })()`);
      await sleep(150);
    }
    expect('all four ticked marks the day done', await c.evaluate(`planById('plan-review').days[0].done`), true);
    // Session timer for Course B (day 1 is one 60-minute block; day 2 is warm-up + main work).
    await c.evaluate(`Pomo.reset(); Pomo.startSession(planById('plan-review'), planById('plan-review').days[1])`);
    await sleep(200);
    expect('checklist plan session steps', await c.evaluate(`Pomo.st.seq.steps.map(s => s.name + ' ' + s.min)`), ['Warm-up 10', 'Main work 50']);
    await c.evaluate(`Pomo.endSession()`);
    await c.evaluate(`App.openPlan('plan-review')`);
    await shot('22-checklist-plan');
    await c.evaluate(`openPlanDay(planById('plan-review'), planById('plan-review').days[3])`);
    await shot('23-checklist-day');
    await c.evaluate(`closeAllModals(); App.setView('month')`);
    await shot('24-month-two-plans');
  };

  // Course C (exam on Nov 17, its last day) and Course D (a demo on Nov 17, study until Nov 20).
  steps.plans = async () => {
    const block = short => `[...document.querySelectorAll('#studyCard .study-plan')].find(b => b.querySelector('.card-title').textContent === ${JSON.stringify(short)})`;
    const leftOf = short => c.evaluate(`(() => { const s = ${block(short)}.querySelector('.study-left'); return s ? s.textContent : null; })()`);
    expect('countdowns on Nov 6', [await leftOf('Course A'), await leftOf('Course C'), await leftOf('Course D')], ['21 days to exam', '11 days to exam', '11 days to API demo']);
    expect('not started yet: next job named', await c.evaluate(`${block('Course D')}.querySelector('.study-empty').textContent`), 'No study job today. Next: Tomorrow · Outline the demo');

    await c.evaluate(`App.openPlan('plan-project')`);
    await shot('25-milestone-plan');
    expect('header names the milestone', await c.evaluate(`document.querySelector('.pv-eyebrow').textContent`), 'Course D · API demo on Tuesday, November 17');
    expect('milestone countdown', await c.evaluate(`document.querySelector('.pv-stat span').textContent`), '11 days to the API demo');
    expect('the demo sits between Nov 16 and Nov 18', await c.evaluate(`(() => { const ms = document.querySelector('.pv-days > .pv-ms'); return ms && [ms.previousElementSibling.id, ms.nextElementSibling.id, ms.textContent.replace(/\\s+/g, ' ').trim()]; })()`), ['pv-2026-11-16', 'pv-2026-11-18', 'TueNov 17API demo']);
    expect('two week phases', await c.evaluate(`[...document.querySelectorAll('.pv-phase h2')].map(x => x.textContent)`), ['Week 1: build the demo', 'Week 2: demo, then the next topic']);
    expect('plan links in the header', await c.evaluate(`[...document.querySelectorAll('.pv-stat a.go')].map(a => a.textContent)`), ['Project notes', 'Script', 'Slides', 'Next topic']);
    await c.evaluate(`scrollPlanTo('2026-11-16', false)`);
    await shot('26-milestone-row');

    await c.evaluate(`App.openPlan('plan-final')`);
    await shot('27-exam-last-day-plan');
    expect('exam plan header', await c.evaluate(`document.querySelector('.pv-eyebrow').textContent`), 'Course C · Exam on Tuesday, November 17');
    expect('exam on its last day stays at the end', await c.evaluate(`(() => { const x = document.querySelector('.pv-exam'); return [x.parentElement.className, !document.querySelector('.pv-ms'), x.previousElementSibling.classList.contains('pv-phase')]; })()`), ['pv-wrap', true, true]);
    await c.evaluate(`App.openPlan('plan-exam')`);
    expect('first plan header unchanged', await c.evaluate(`document.querySelector('.pv-eyebrow').textContent`), 'Course A · Exam on Friday, November 27');

    // Nov 17: the Course C exam and the Course D demo.
    await c.evaluate(`__travel(new Date(2026, 10, 17, 9, 0).getTime()); App.setView('week'); App.goToday()`);
    await sleep(300);
    expect('Nov 17 countdowns', [await leftOf('Course C'), await leftOf('Course D')], ['Exam day', 'API demo day']);
    expect('demo day: no study, good luck', await c.evaluate(`${block('Course D')}.querySelector('.study-empty').textContent`), 'API demo today. You have done the work. Good luck.');
    expect('exam day: a 30-minute session', await c.evaluate(`[...${block('Course C')}.querySelectorAll('.study-actions .btn')].map(b => b.textContent)`), ['Start 30-min session', 'Mark done']);
    expect('exam and demo in the calendar', await c.evaluate(`['Course C Exam', 'Course D API demo'].map(t => [...document.querySelectorAll('#main .chip, #main .ev')].some(x => x.textContent.includes(t)))`), [true, true]);
    await shot('28-nov17-week');
    await c.evaluate(`toggleStudyCollapsed('plan-project')`);
    expect('collapsed summary on the demo day', await c.evaluate(`${block('Course D')}.querySelector('.study-sum').textContent`), 'API demo today');
    await c.evaluate(`toggleStudyCollapsed('plan-project')`);

    // Nov 18: the demo is behind; the next topic starts and the countdown is gone.
    await c.evaluate(`__travel(new Date(2026, 10, 18, 9, 0).getTime()); App.goToday()`);
    await sleep(300);
    expect('no countdown after the demo', await leftOf('Course D'), null);
    expect('next topic starts', await c.evaluate(`${block('Course D')}.querySelector('.study-main').textContent`), 'Next topic: part 1.');
    expect('a finished plan leaves the card', await c.evaluate(`!${block('Course C')}`), true);
    await shot('29-nov18-panel');
  };

  // A fixed forecast (no network): rain before dawn, good 5-6 AM, hot and high-UV midday, good 7-9 PM.
  const useWeatherFixture = () => c.evaluate(`(() => {
    const off = -new Date().getTimezoneOffset() * 60;
    const lv = hr => hr < 5 ? 'rain' : hr <= 6 ? 'good' : hr <= 9 ? 'fair' : hr <= 16 ? 'poor' : hr <= 18 ? 'fair' : hr <= 21 ? 'good' : 'fair';
    const H = { time: [], temperature_2m: [], apparent_temperature: [], relative_humidity_2m: [], precipitation_probability: [], precipitation: [], weather_code: [], wind_gusts_10m: [], uv_index: [], is_day: [] };
    const days = ['2026-11-06', '2026-11-07', '2026-11-08'];
    for (const d of days) for (let hr = 0; hr < 24; hr++) {
      const l = lv(hr);
      H.time.push(d + 'T' + String(hr).padStart(2, '0') + ':00');
      H.temperature_2m.push(l === 'poor' ? 32 : 27); H.relative_humidity_2m.push(78);
      H.apparent_temperature.push(l === 'good' ? 27.5 : l === 'fair' ? 32 : l === 'poor' ? 37 : 27);
      H.precipitation_probability.push(l === 'rain' ? 75 : 10); H.precipitation.push(l === 'rain' ? 1.2 : 0);
      H.weather_code.push(l === 'rain' ? 61 : 2); H.wind_gusts_10m.push(12);
      H.uv_index.push(hr >= 10 && hr <= 15 ? 9 : 1); H.is_day.push(hr >= 6 && hr < 18 ? 1 : 0);
    }
    const fc = { utc_offset_seconds: off, timezone: 'auto', hourly: H,
      current: { temperature_2m: 32, apparent_temperature: 37, relative_humidity_2m: 66, precipitation: 0, weather_code: 2, is_day: 1 },
      daily: { time: days, apparent_temperature_max: [37.4, 36.8, 35.9], sunrise: [], sunset: [] } };
    const aq = { hourly: { time: H.time, us_aqi: H.time.map(() => 48) } };
    Weather.fetchJson = async url => url.includes('air-quality') ? aq : url.includes('geocoding') ? { results: [{ name: 'Sample City', admin1: 'Sample Region', country: 'Sampleland', latitude: 14.6, longitude: 121 }] } : fc;
    Store.d.settings.weather = { name: 'Sample City', region: 'Sample Region', country: 'Sampleland', lat: 14.6, lon: 121, enabled: true };
    return Weather.refresh(true);
  })()`);

  steps.health = async () => {
    await useWeatherFixture();
    await sleep(300);
    // Answer first: the best window, then a quiet timeline, then current conditions.
    // Good hours are 7-9 PM, but suggestions stop at a 9 PM start, so the window is 7 to 9 PM.
    expect('weather card: best window as the headline', await c.evaluate(`[...document.querySelectorAll('#weatherCard .jog-head > div')].map(x => x.textContent)`), ['Best time to jog', '7–9 PM today', 'Feels 28°C, dry']);
    expect('weather card: current conditions, quietly, at the bottom', await c.evaluate(`[...document.querySelectorAll('#weatherCard .wx-now > span')].map(x => x.textContent)`), ['32°C, feels 37°C · partly cloudy', 'Now: poor for jogging (too hot)']);
    // Rows run 5 AM to 9 PM: today has 9 hours already past (5 AM to 1 PM); tomorrow shows the whole pattern.
    expect('timeline: today and tomorrow, 16 hours each', await c.evaluate(`[...document.querySelectorAll('#weatherCard .jt-row .jt-day')].map(x => x.textContent + ' ' + x.nextElementSibling.querySelectorAll('.jt-h').length)`), ['Today 16', 'Tomorrow 16']);
    expect('timeline: past hours are dimmed', await c.evaluate(`document.querySelectorAll('#weatherCard .jt-bar')[0].querySelectorAll('.jt-h.past').length`), 9);
    expect('timeline: one green ramp, deeper is better', await c.evaluate(`[...document.querySelectorAll('#weatherCard .jt-bar')[1].querySelectorAll('.jt-h')].map(x => x.className.match(/q-(\\w)/)[1]).join('')`), 'ggfffpppppppffgg');
    expect('timeline: best window outlined on today, now marker shown', await c.evaluate(`[document.querySelectorAll('#weatherCard .jt-bar')[0].querySelector('.jt-best').style.gridColumn, !!document.querySelector('#weatherCard .jt-now')]`), ['15 / 17', true]);
    expect('axis labels are short and whole', await c.evaluate(`[...document.querySelectorAll('#weatherCard .jt-axis span')].map(x => x.textContent)`), ['6 AM', 'Noon', '6 PM']);
    expect('hot day adds half a flask', await c.evaluate(`waterGoal(todayYmd(), Weather.maxFeels(todayYmd())).flasks`), 4);

    // A new user has no medicines: the card skips them and the page offers to add some.
    expect('no medicines by default: none in the card', await c.evaluate(`[Store.d.health.meds.length, !!document.querySelector('#healthCard .hb-meds')]`), [0, false]);
    await c.evaluate(`App.openHealth()`);
    await sleep(200);
    expect('Health page offers Add medicine', await c.evaluate(`[...document.querySelectorAll('#hv-meds .btn')].map(b => b.textContent)`), ['Add medicine']);
    expect('notes from seed.local.js follow the general ones', await c.evaluate(`(() => { const li = [...document.querySelectorAll('#hv-notes li')].map(x => x.textContent); return [li.length, li[li.length - 1]]; })()`), [4, 'A sample note from seed.local.js.']);
    await c.evaluate(`App.setView('week')`);
    // This user takes six medicines (as you would add them).
    await c.evaluate(`Store.commit('meds', d => { d.health.meds = [['Vitamin D', '1000 IU', ''], ['Omega-3', '1 g', ''], ['Iron', '65 mg', ''], ['Magnesium', '200 mg', 'With food'], ['Probiotic', '', ''], ['Multivitamin', '', 'With food']].map(([name, dose, note], i) => ({ id: 'm' + i, name, dose, note, times: [480] })); }, { toast: false })`);
    await sleep(200);
    await shot('30-health-card');

    // Medicines from the right panel.
    expect('six doses at 8 AM', await c.evaluate(`[...document.querySelectorAll('#healthCard .dose-text')].map(x => [...x.children].map(c => c.textContent).join(' '))`), ['Vitamin D 1000 IU', 'Omega-3 1 g', 'Iron 65 mg', 'Magnesium 200 mg', 'Probiotic', 'Multivitamin']);
    await c.evaluate(`document.querySelector('#healthCard .dose').click()`);
    expect('one dose ticked', await c.evaluate(`medProgress(todayYmd())`), { taken: 1, total: 6 });
    await c.evaluate(`[...document.querySelectorAll('#healthCard .dose-time .linkish')].find(b => b.textContent === 'Take all').click()`);
    expect('Take all ticks the rest', await c.evaluate(`[medProgress(todayYmd()).taken, document.querySelector('#healthCard .hb-meds .hb-meta').textContent]`), [6, 'All taken']);

    // Water.
    await c.evaluate(`[...document.querySelectorAll('#healthCard .water-btns .btn')].find(b => b.textContent === '+1').click()`);
    await c.evaluate(`[...document.querySelectorAll('#healthCard .water-btns .btn')].find(b => b.textContent === '+½').click()`);
    expect('water +1 and +½', await c.evaluate(`[waterOn(todayYmd()), document.querySelector('#healthCard .hb-water .hb-meta').textContent]`), [1.5, '1½ of 4 flasks · 1.5 L']);
    await c.evaluate(`document.querySelectorAll('#healthCard .flask-btn')[2].click()`);
    expect('clicking the third flask fills to 3', await c.evaluate(`waterOn(todayYmd())`), 3);
    await c.evaluate(`document.querySelectorAll('#healthCard .flask-btn')[2].click()`);
    expect('clicking it again empties it back to 2', await c.evaluate(`waterOn(todayYmd())`), 2);
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
    await sleep(150);
    expect('Ctrl+Z undoes a water change', await c.evaluate(`waterOn(todayYmd())`), 3);

    // Workout: today (Friday) is Strength A, in the calendar at 6 PM.
    expect('today is Strength A, week 1', await c.evaluate(`document.querySelector('#healthCard .hb-work .hb-line').textContent`), 'Strength A + pull-ups · 35 min · week 1, foundation');
    // A 35-minute block is drawn compact, with just its start time.
    expect('workout block in the week view at 6 PM', await c.evaluate(`(() => { const el = [...document.querySelectorAll('#main .ev')].find(x => x.textContent.includes('Strength A')); return el ? [el.querySelector('.ev-time').textContent, el.title.split('\\n')[1]] : null; })()`), ['6:00 PM', '6:00 – 6:35 PM']);
    await c.evaluate(`[...document.querySelectorAll('#healthCard .hb-work .btn')].find(b => b.textContent.includes('Start workout')).click()`);
    await sleep(200);
    expect('workout timer: warm-up, strength, cool-down', await c.evaluate(`[Pomo.st.seq.kind, Pomo.st.seq.steps.map(s => s.name + ' ' + s.min).join(', '), document.querySelector('#pomoCard .card-title').textContent]`), ['workout', 'Warm-up 5, Strength 25, Cool-down 5', 'Workout']);
    await c.evaluate(`Pomo.st.endAt = Date.now() + 200; Pomo.arm();`); await sleep(900);
    await c.evaluate(`Pomo.st.endAt = Date.now() + 200; Pomo.arm();`); await sleep(900);
    await c.evaluate(`Pomo.st.endAt = Date.now() + 200; Pomo.arm();`); await sleep(1100);
    expect('finished workout prompts to tick, logs no focus time', await c.evaluate(`[Pomo.st.seq, Pomo.st.finished && Pomo.st.finished.kind, Store.d.pomoLog.length, !!document.querySelector('#healthCard .study-finished')]`), [null, 'workout', 0, true]);
    await c.evaluate(`openWorkoutDialog(todayYmd())`);
    await sleep(150);
    await c.evaluate(`document.querySelectorAll('.modal .checklist .check')[1].click()`);
    await sleep(150);
    expect('ticking in the dialog updates progress', await c.evaluate(`[workoutProgress(todayYmd()).done, document.querySelector('.modal .pd-meta').textContent.includes('1 of 7 done')]`), [1, true]);
    await c.evaluate(`closeAllModals()`);

    // HIIT intervals use the compact step bar and stay quiet between intervals.
    await c.evaluate(`Pomo.reset(); Pomo.startWorkout('2026-11-10')`);
    await sleep(200);
    expect('HIIT timer has 14 steps and a compact bar', await c.evaluate(`[Pomo.st.seq.steps.length, !!document.querySelector('#pomoCard .steps-compact'), document.querySelectorAll('#pomoCard .sc-bar i').length]`), [14, true, 14]);
    await c.evaluate(`Pomo.st.seq.idx = 1; Pomo.st.status = 'idle'; Pomo.start();`);
    expect('interval step alarm chimes without a notification', await c.evaluate(`(() => { const a = Pomo.alarmText(); return [a.title, a.notify]; })()`), ['Hard done', false]);
    expect('sidebar water goal matches the card', await c.evaluate(`document.querySelector('#healthLink .health-mini').textContent.includes('/4')`), true);
    await c.evaluate(`document.getElementById('pomoCard').scrollIntoView()`);
    await shot('31-hiit-timer');
    await c.evaluate(`document.getElementById('panel').scrollTop = 0`);
    await c.evaluate(`Pomo.endSession()`);

    // The Health page.
    await c.evaluate(`App.openHealth()`);
    await sleep(250);
    expect('Health page sections', await c.evaluate(`[...document.querySelectorAll('.hv-sec')].map(s => s.id || s.className.split(' ').pop())`), ['hv-meds', 'hv-water', 'hv-work', 'hv-weather', 'hv-history', 'hv-notes']);
    expect('this week strip', await c.evaluate(`[...document.querySelectorAll('.wk-day .wk-type')].map(x => x.textContent).join(', ')`), '–, –, –, –, –, Strength A, HIIT + core');
    expect('three days of hours on the page', await c.evaluate(`document.querySelectorAll('#hv-weather .jt-bar .jt-h').length`), 48);
    await shot('32-health-page');
    await c.evaluate(`document.getElementById('hv-work').scrollIntoView()`);
    await shot('33-health-page-exercise');
    await c.evaluate(`[...document.querySelectorAll('#hv-meds .btn')].find(b => b.textContent.includes('Edit')).click()`);
    await sleep(150);
    expect('medicine editor lists six', await c.evaluate(`document.querySelectorAll('.med-row').length`), 6);
    await c.evaluate(`[...document.querySelectorAll('.med-edit > .btn')].find(b => b.textContent.includes('Add medicine')).click()`);
    await sleep(150);
    expect('add a medicine', await c.evaluate(`[document.querySelectorAll('.med-row').length, Store.d.health.meds.length]`), [7, 7]);
    await c.evaluate(`[...document.querySelectorAll('.med-row')].pop().querySelector('.icon-btn.sm').click()`);
    await sleep(150);
    expect('remove it again', await c.evaluate(`Store.d.health.meds.length`), 6);
    await c.evaluate(`[...document.querySelectorAll('.med-row')][3].querySelector('.med-times .btn').click()`);
    await sleep(150);
    expect('second time for magnesium', await c.evaluate(`Store.d.health.meds[3].times.map(fmtTime)`), ['8:00 AM', '8:00 PM']);
    await c.evaluate(`document.getElementById('hv-meds').scrollIntoView()`);
    await shot('34-med-editor');
    await key('ArrowLeft', 'ArrowLeft', 37);
    expect('arrows move the Health page by day', await c.evaluate(`App.state.healthDate`), '2026-11-05');
    await key('t', 'KeyT', 84);
    expect('T returns to today', await c.evaluate(`App.state.healthDate`), '2026-11-06');

    // Water: rename the container.
    await c.evaluate(`(() => { const i = document.querySelector('#hv-water .unit-in'); i.value = 'bottle'; i.dispatchEvent(new Event('change')); })()`);
    await sleep(150);
    expect('container renamed everywhere', await c.evaluate(`document.querySelector('#hv-water .hb-meta').textContent`), '3 of 4 bottles · 3.0 L');

    // Workout program: edit the week, add a workout, catch a bad timer line, reset.
    await c.evaluate(`HealthUI.editingMeds = false; [...document.querySelectorAll('#hv-work .btn')].find(b => b.textContent.includes('Edit program')).click()`);
    await sleep(150);
    expect('program editor: seven day pickers and six workouts', await c.evaluate(`[document.querySelectorAll('.wk-edit select').length, document.querySelectorAll('.routine-row').length]`), [7, 6]);
    await c.evaluate(`(() => { const s = [...document.querySelectorAll('.wk-edit-day')].find(x => x.textContent.startsWith('Mon')).querySelector('select'); s.value = 'hiit'; s.dispatchEvent(new Event('change')); })()`);
    await sleep(150);
    expect('Monday is now HIIT', await c.evaluate(`workoutFor('2026-11-09').short`), 'HIIT');
    await c.evaluate(`[...document.querySelectorAll('.program-edit .btn')].find(b => b.textContent.includes('Add workout')).click()`);
    await sleep(150);
    await c.evaluate(`(() => { const m = document.querySelector('.modal'); const [title, short] = m.querySelectorAll('input'); const [items, steps] = m.querySelectorAll('textarea'); title.value = 'Yoga flow'; short.value = 'Yoga'; items.value = 'Sun salutations\\nPigeon pose 1 min each side'; steps.value = 'Warm-up 5\\nFlow twenty'; })()`);
    await c.evaluate(`[...document.querySelectorAll('.modal-f .btn')].find(b => b.textContent === 'Save').click()`);
    expect('a bad timer line is caught', await c.evaluate(`document.querySelector('.modal .form-error').textContent`), 'Could not read the timer. Line 2: "Flow twenty"');
    await c.evaluate(`(() => { const t = document.querySelectorAll('.modal textarea')[1]; t.value = 'Warm-up 5\\nFlow 20\\n3 x 30s Breathe / 30s Rest'; [...document.querySelectorAll('.modal-f .btn')].find(b => b.textContent === 'Save').click(); })()`);
    await sleep(200);
    expect('new workout saved and listed', await c.evaluate(`(() => { const r = routineList().find(x => x.title === 'Yoga flow'); const w = routineAt(r.id, 1); return [w.short, w.items.length, w.min, document.querySelectorAll('.routine-row').length]; })()`), ['Yoga', 2, 28, 7]);
    await c.evaluate(`(() => { const s = [...document.querySelectorAll('.wk-edit-day')].find(x => x.textContent.startsWith('Sun')).querySelector('select'); s.value = routineList().find(x => x.title === 'Yoga flow').id; s.dispatchEvent(new Event('change')); })()`);
    await sleep(150);
    expect('Sunday is now yoga instead of rest', await c.evaluate(`workoutFor('2026-11-08').title`), 'Yoga flow');
    await c.evaluate(`openRoutineEditor('A')`);
    await sleep(150);
    await c.evaluate(`(() => { const t = document.querySelectorAll('.modal textarea')[0]; t.value = 'Push-ups 4 x 10\\nDips 3 x 8'; [...document.querySelectorAll('.modal-f .btn')].find(b => b.textContent === 'Save').click(); })()`);
    await sleep(150);
    expect('edited Strength A takes effect on Friday', await c.evaluate(`[workoutFor('2026-11-13').items.map(i => i.text), !!document.querySelector('.routine-row .btn.ghost')]`), [['Push-ups 4 x 10', 'Dips 3 x 8'], true]);
    await c.evaluate(`document.getElementById('hv-work').scrollIntoView()`);
    await shot('36-program-editor');
    await c.evaluate(`[...document.querySelectorAll('.routine-row .btn.ghost')][0].click()`);
    await sleep(150);
    expect('Reset brings the automatic Strength A back', await c.evaluate(`workoutFor('2026-11-13').title`), 'Strength A + pull-ups');

    // Right panel: drag the Tasks card to the top, then move it back down one place with the keyboard.
    await c.evaluate(`App.setView('week')`);
    await sleep(200);
    // The Tasks card starts below the fold: scroll to it, then drag up to the panel's top edge so the panel auto-scrolls.
    await c.evaluate(`document.querySelector('.panel-slot[data-card="tasks"]').scrollIntoView({ block: 'end' })`);
    await sleep(150);
    const grip = await rectOf(`document.querySelector('.panel-slot[data-card="tasks"] .card-grip')`);
    const panelBox = await rectOf(`document.getElementById('panel')`);
    const gx = grip.x + grip.w / 2, gy = grip.y + grip.h / 2;
    await mouse('mouseMoved', gx, gy);
    await mouse('mousePressed', gx, gy, 1);
    for (let i = 1; i <= 12; i++) await mouse('mouseMoved', gx, gy + (panelBox.y + 8 - gy) * i / 12, 1);
    for (let i = 0; i < 12; i++) { await sleep(150); await mouse('mouseMoved', gx, panelBox.y + 8, 1); }
    await mouse('mouseReleased', gx, panelBox.y + 8);
    await sleep(300);
    expect('dragging a card reorders the panel and saves it', await c.evaluate(`[[...document.querySelectorAll('#panel .panel-slot')].map(s => s.dataset.card).join(','), Store.d.settings.panelOrder.join(',')]`), ['tasks,now,health,weather,study,timer', 'tasks,now,health,weather,study,timer']);
    await c.evaluate(`document.querySelector('.panel-slot[data-card="tasks"] .card-grip').focus()`);
    await key('ArrowDown', 'ArrowDown', 40);
    expect('arrow keys move a focused card', await c.evaluate(`Store.d.settings.panelOrder.slice(0, 2).join(',')`), 'now,tasks');
    await shot('37-panel-reordered');
    await c.evaluate(`resetPanelOrder()`);
    expect('Reset order restores the default', await c.evaluate(`[...document.querySelectorAll('#panel .panel-slot')].map(s => s.dataset.card).join(',')`), 'now,health,weather,study,timer,tasks');
    await c.evaluate(`App.setView('month')`);
    await shot('35-month-with-workouts');
  };

  steps.wx = async () => {
    await useWeatherFixture();
    await sleep(300);
    await c.evaluate(`document.getElementById('weatherCard').scrollIntoView({ block: 'center' })`);
    await sleep(200);
    const r = await rectOf(`document.getElementById('weatherCard')`);
    const shotR = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: r.x - 8, y: r.y - 8, width: r.w + 16, height: r.h + 16, scale: 2 } });
    fs.writeFileSync(path.join(outDir, '40-weather-card.png'), Buffer.from(shotR.data, 'base64'));
    await c.evaluate(`App.openHealth('hv-weather')`);
    await sleep(300);
    await shot('41-weather-page');
  };

  // Stray "null" / "undefined" / "NaN" text anywhere on screen, in every view and dialog.
  steps.text = async () => {
    const stray = () => c.evaluate(`(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const bad = []; let n; while ((n = w.nextNode())) { if (/null|undefined|NaN/.test(n.textContent) && !n.parentElement.closest('script,style')) bad.push(n.parentElement.className + ': ' + n.textContent.trim().slice(0, 60)); } return bad; })()`);
    const states = [
      ['week, no tasks', `App.setView('week')`],
      ['day', `App.setView('day')`],
      ['month', `App.setView('month')`],
      ['exam plan', `App.openPlan('plan-exam')`],
      ['checklist plan', `App.openPlan('plan-review')`],
      ['exam-on-last-day plan', `App.openPlan('plan-final')`],
      ['milestone plan', `App.openPlan('plan-project')`],
      ['tasks tomorrow', `App.setView('week'); App.state.taskDate = addDays(todayYmd(), 1); renderTasksCard()`],
      ['one task', `App.state.taskDate = todayYmd(); Store.commit('t', d => d.tasks.push(normalizeTask({ id: 'x1', title: 'One', date: todayYmd() })), { toast: false })`],
      ['overdue only', `Store.commit('t', d => { d.tasks = [normalizeTask({ id: 'x2', title: 'Old', date: addDays(todayYmd(), -2) })]; }, { toast: false })`],
      ['editor', `openEditor({ draft: {} })`],
      ['settings general', `closeAllModals(); openSettings('general')`],
      ['settings timer', `closeAllModals(); openSettings('pomodoro')`],
      ['settings categories', `closeAllModals(); openSettings('categories')`],
      ['settings app', `closeAllModals(); openSettings('app')`],
      ['plan day dialog', `closeAllModals(); openPlanDay(planById('plan-review'), planById('plan-review').days[0])`],
      ['shortcuts', `closeAllModals(); showShortcuts()`],
      ['session running', `closeAllModals(); Pomo.startSession(planById('plan-exam'), planById('plan-exam').days[0])`],
      ['health page', `Pomo.endSession(); App.openHealth()`],
      ['health page, editing medicines', `HealthUI.editingMeds = true; App.renderMain()`],
      ['health page, yesterday', `HealthUI.editingMeds = false; App.go(-1)`],
      ['workout dialog', `App.goToday(); openWorkoutDialog(todayYmd())`],
      ['weather location', `closeAllModals(); openWeatherPlace()`],
      ['program editor', `closeAllModals(); App.openHealth(); HealthUI.editingProgram = true; App.renderMain()`],
      ['workout editor dialog', `openRoutineEditor('hiit')`],
      ['new workout dialog', `closeAllModals(); openRoutineEditor(null)`],
      ['cards collapsed', `closeAllModals(); HealthUI.editingProgram = false; App.setView('week'); toggleCardCollapsed('health'); toggleCardCollapsed('weather')`],
      ['HIIT running', `toggleCardCollapsed('health'); toggleCardCollapsed('weather'); Pomo.startWorkout('2026-11-10')`],
    ];
    for (const [name, js] of states) {
      await c.evaluate(js);
      await sleep(200);
      expect(`no stray null/undefined text: ${name}`, await stray(), []);
    }
    // Control: the old Tasks-card bug must be caught by this check.
    await c.evaluate(`closeAllModals(); document.getElementById('tasksCard').replaceChildren(null, null)`);
    expect('control: the check catches the old "nullnull" bug', (await stray()).length > 0, true);
    await c.evaluate(`renderTasksCard()`);
  };

  for (const s of (scenario.split(',').filter(x => steps[x]))) await steps[s]();
  if (results.length) console.log(results.join('\n'));
  const info = await c.evaluate(`JSON.stringify({ events: Store.d.events.length, plans: Store.d.plans.length, days: Store.d.plans[0] && Store.d.plans[0].days.length, view: App.state.view })`);
  console.log('STATE', info);
  c.close();
} catch (e) {
  errors.push('HARNESS ' + (e.stack || e));
} finally {
  proc.kill();
  server.close();
}
console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
// Fail the process too, so a broken harness can't pass silently with no PASS / FAIL lines.
if (errors.length || results.some(r => r.startsWith('FAIL'))) process.exitCode = 1;
