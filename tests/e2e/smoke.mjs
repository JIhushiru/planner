// Quick, invisible smoke test: starts an exe hidden in the tray with an isolated data folder,
// checks the UI loads without errors and both plans are seeded, then quits it.
// Usage: node smoke.mjs <exe> <scratchDataDir>
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { connect, sleep, waitForJson } from './cdp.mjs';

const [exe, dataDir] = process.argv.slice(2);
fs.rmSync(dataDir, { recursive: true, force: true });
const port = 9500 + Math.floor(Math.random() * 300);
const proc = spawn(exe, ['--minimized'], { env: { ...process.env, PLANNER_DATA_DIR: dataDir, PLANNER_DEBUG_PORT: String(port) }, stdio: 'ignore' });
const out = [];
const check = (name, ok, detail = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  [' + detail + ']' : ''}`);
try {
  const isApp = t => t.type === 'page' && t.url.startsWith('https://planner.example');
  const page = (await waitForJson(port, 160, isApp)).find(isApp);
  const c = await connect(page.webSocketDebuggerUrl);
  const errors = [];
  c.on(m => {
    if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 600));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  await c.send('Runtime.enable');
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { ready = await c.evaluate(`document.body.classList.contains('ready')`); if (!ready) await sleep(150); }
  check('UI ready while hidden in the tray', ready);
  // Plans come only from a personal seed.local.js: none in a fresh copy of the repo, yours when built on your PC.
  const seeds = JSON.parse(await c.evaluate(`JSON.stringify({ want: SEED_PLANS.map(p => p.id), got: Store.d.plans.map(p => p.id), events: SEED_PLANS.flatMap(p => (p.seedEvents || []).map(e => e.id)) })`));
  check('plans seeded from seed.local.js only', JSON.stringify(seeds.got) === JSON.stringify(seeds.want), seeds.want.length ? `${seeds.want.length} personal plans` : 'none: no seed.local.js in this build');
  await sleep(400);
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'data.json'), 'utf8'));
  check('saved to disk', saved.seeded.length === seeds.want.length && saved.plans.length === seeds.want.length && seeds.events.every(id => saved.events.some(e => e.id === id)));
  check('no page errors', errors.length === 0, errors.join(' | '));
  check('no city until one is picked', await c.evaluate(`Store.d.settings.weather.lat === null`));
  // A fresh copy starts with no medicines but keeps the default water and workout program.
  const health = await c.evaluate(`JSON.stringify({ meds: Store.d.health.meds.length, flaskMl: Store.d.health.water.flaskMl, goal: Store.d.health.water.goal, week: Store.d.health.workout.week })`);
  check('daily health defaults (no medicines, default water and program)', health === '{"meds":0,"flaskMl":1005,"goal":3,"week":["rest","A","hiit","B","jog","A","hiitcore"]}', health);
  // Live forecast through the app's own network and content-security rules (needs internet), for a test city.
  await c.evaluate(`Weather.setPlace({ name: 'Test City', region: '', country: '', lat: 1.29, lon: 103.85 })`);
  let wx = null;
  for (let i = 0; i < 40 && !wx; i++) { wx = await c.evaluate(`Weather.data ? Weather.data.hours.length + ' hours, now ' + JSON.stringify(Weather.nowHour() && Weather.nowHour().rating.level) : null`); if (!wx) await sleep(250); }
  const wxErr = await c.evaluate(`Weather.error`);
  check('jogging weather loads live', !!wx, wx || wxErr || 'no data (offline?)');

  // Close paths, all without showing a window.
  const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
  const post = kind => execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'postclose.ps1'), '-ProcessId', String(proc.pid), '-Kind', kind], { encoding: 'utf8' }).trim();
  check('title-bar X (SC_CLOSE) keeps it in the tray', post('sc').startsWith('posted sc to 1') && (await sleep(1200), proc.exitCode === null));
  execFileSync(exe, ['--quit'], { env: { ...process.env, PLANNER_DATA_DIR: dataDir } });
  for (let i = 0; i < 40 && proc.exitCode === null; i++) await sleep(150);
  check('Planner.exe --quit closes the running copy', proc.exitCode === 0, 'exit ' + proc.exitCode);
  check('no host errors logged', !fs.existsSync(path.join(dataDir, 'error.log')));

  const again = spawn(exe, ['--minimized'], { env: { ...process.env, PLANNER_DATA_DIR: dataDir }, stdio: 'ignore' });
  await sleep(2500);
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'postclose.ps1'), '-ProcessId', String(again.pid), '-Kind', 'wm'], { encoding: 'utf8' });
  for (let i = 0; i < 40 && again.exitCode === null; i++) await sleep(150);
  check('outside WM_CLOSE (Task Manager) really quits', again.exitCode === 0, 'exit ' + again.exitCode);
  if (again.exitCode === null) again.kill();
} catch (e) {
  out.push('HARNESS ERROR ' + (e.stack || e));
} finally {
  if (proc.exitCode === null) proc.kill();
}
console.log(out.join('\n'));
process.exit(0);
