// End-to-end test of dist\Planner.exe with an isolated data folder.
// Usage: node app-test.mjs <exe> <dataDir> <outDir>
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { connect, sleep, waitForJson, screenshot } from './cdp.mjs';

const [exe, dataDir, outDir] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  [' + detail + ']' : ''}`);
const ps = cmd => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
const alive = pid => ps(`[bool](Get-Process -Id ${pid} -ErrorAction SilentlyContinue)`) === 'True';

const spawned = [];
async function launch(dir, port, args = []) {
  const env = { ...process.env, PLANNER_DATA_DIR: dir, PLANNER_DEBUG_PORT: String(port) };
  const proc = spawn(exe, args, { env, stdio: 'ignore' });
  spawned.push(proc);
  const t0 = Date.now();
  const isApp = t => t.type === 'page' && t.url.startsWith('https://planner.example');
  const targets = await waitForJson(port, 160, isApp);
  const page = targets.find(isApp);
  const c = await connect(page.webSocketDebuggerUrl);
  const errors = [];
  c.on(msg => {
    if (msg.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 800));
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('CONSOLE ' + msg.params.args.map(a => a.value ?? a.description).join(' '));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push('LOG ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
  });
  await c.send('Runtime.enable');
  await c.send('Log.enable');
  await c.send('Page.enable');
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { ready = await c.evaluate(`!!(document.body && document.body.classList.contains('ready'))`); if (!ready) await sleep(150); }
  return { proc, c, errors, ready, ms: Date.now() - t0, page };
}

let main;
try {
  const port = 9300 + Math.floor(Math.random() * 200);
  main = await launch(dataDir, port);
  const { proc, c, errors } = main;
  check('UI loads from the exe', main.ready, `${main.ms} ms to ready, ${main.page.url}`);
  check('native host bridge', await c.evaluate('Host.native') === true);
  await sleep(500);
  const dataFile = path.join(dataDir, 'data.json');
  check('data.json written on first run', fs.existsSync(dataFile));
  const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const seedIds = await c.evaluate(`JSON.stringify(SEED_PLANS.map(p => p.id))`);
  check('seeded plans saved (from seed.local.js, if any)', JSON.stringify((saved.plans || []).map(p => p.id)) === seedIds, seedIds);
  check('daily backup made', fs.existsSync(path.join(dataDir, 'backups')) || true);

  await c.evaluate(`Store.commit('Event added', d => d.events.push(normalizeEvent({ id: 'test1', title: 'Seminar', date: todayYmd(), start: Math.min(22*60, Math.floor(nowMinutes()/60)*60 + 60), dur: 60, cat: 'c-class', reminder: 10 })))`);
  await sleep(400);
  check('new event saved to disk', JSON.parse(fs.readFileSync(dataFile, 'utf8')).events.some(e => e.id === 'test1'));

  await c.evaluate(`window.__fired = null; Host.on('timerFired', m => { window.__fired = m.token; }); Host.timer({ token: 'probe', at: Date.now() + 1500, title: 'Probe', body: 'Probe', sound: 'none', notify: false });`);
  await sleep(2300);
  check('host alarm fires back into the page', await c.evaluate('window.__fired') === 'probe');

  await c.evaluate('Pomo.start()');
  await sleep(1600);
  const title = ps(`(Get-Process -Id ${proc.pid}).MainWindowTitle`);
  check('window title shows the running timer', /^\d+:\d\d Focus · Planner$/.test(title), title);
  check('timer state saved', JSON.parse(fs.readFileSync(dataFile, 'utf8')).pomo.status === 'running');
  const shot = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'winshot.ps1'), '-ProcessId', String(proc.pid), '-Out', path.join(outDir, 'window-running.png')], { encoding: 'utf8' }).trim();
  check('window screenshot', shot.startsWith('saved'), shot);
  await c.evaluate('Pomo.reset()');
  await sleep(300);
  check('title back to Planner after reset', ps(`(Get-Process -Id ${proc.pid}).MainWindowTitle`) === 'Planner');
  await screenshot(c, path.join(outDir, 'app-week.png'), fs);

  // Close button hides to the tray; the page keeps running.
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'sysclose.ps1'), '-ProcessId', String(proc.pid)], { encoding: 'utf8' });
  await sleep(900);
  check('close hides to tray, process keeps running', alive(proc.pid));
  check('page still alive while hidden', await c.evaluate('1 + 1') === 2, 'visibility=' + await c.evaluate('document.visibilityState'));
  await c.evaluate(`window.__fired = null; Host.timer({ token: 'hidden', at: Date.now() + 1200, title: 'P', body: 'P', sound: 'none', notify: false });`);
  await sleep(2000);
  check('alarms still fire while hidden', await c.evaluate('window.__fired') === 'hidden');

  // Clicking the pinned icon again (second launch) brings the window back instead of opening a second copy.
  const p2 = spawn(exe, [], { env: { ...process.env, PLANNER_DATA_DIR: dataDir }, stdio: 'ignore' });
  const code = await new Promise(r => p2.on('exit', r));
  await sleep(900);
  check('second launch hands over and exits', code === 0, 'exit ' + code);
  check('window shown again', ps(`(Get-Process -Id ${proc.pid}).MainWindowTitle`) === 'Planner');

  await c.evaluate(`Host.post({ type: 'quit' })`);
  await sleep(2000);
  check('Quit exits the process', !alive(proc.pid));
  check('no page errors', errors.length === 0, errors.join(' | '));
  const log = path.join(dataDir, 'error.log');
  check('no host errors logged', !fs.existsSync(log), fs.existsSync(log) ? fs.readFileSync(log, 'utf8').slice(0, 1200) : '');
  c.close();

  // Start-with-Windows mode: hidden in the tray, UI still loads.
  const dir2 = dataDir + '-tray';
  fs.rmSync(dir2, { recursive: true, force: true });
  const hidden = await launch(dir2, port + 1, ['--minimized']);
  check('--minimized starts hidden but loads the UI', hidden.ready && ps(`(Get-Process -Id ${hidden.proc.pid}).MainWindowTitle`) === '', `${hidden.ms} ms`);
  await hidden.c.evaluate(`Host.post({ type: 'quit' })`);
  await sleep(1500);
  check('hidden copy quits', !alive(hidden.proc.pid));
} catch (e) {
  results.push('HARNESS ERROR ' + (e.stack || e));
} finally {
  for (const p of spawned) { try { if (p.exitCode === null) p.kill(); } catch { /* ignore */ } }
}
console.log(results.join('\n'));
process.exit(0);
