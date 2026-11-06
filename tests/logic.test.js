// Logic tests for dates, repeat rules, series edits, plans, daily health and jogging weather.
// Run: node tests/logic.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const web = path.join(root, 'web', 'js');
const ctx = vm.createContext({
  console, structuredClone, Intl, navigator: { language: 'en-US' },
  Host: { save() {} }, App: { render() {} }, toast() {}, closeAllModals() {},
});
const load = (file, name) => vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: name });
load(path.join(web, 'util.js'), 'util.js');
load(path.join(web, 'seed.js'), 'seed.js');
// What a copy of the repo ships, before any personal seed.local.js: no plans, no notes.
ctx.SHIPPED_SEEDS = vm.runInContext('({ plans: SEED_PLANS.length, notes: LOCAL_HEALTH_NOTES.length })', ctx);
// The tests use sample plans in place of a personal seed.local.js.
load(path.join(__dirname, 'fixtures', 'plans.js'), 'fixtures/plans.js');
for (const f of ['store.js', 'health-core.js', 'weather.js']) load(path.join(web, f), f);

// Personal study material lives in claude.ai artifacts; links to it belong in *.local.js only.
ctx.ARTIFACT_LINKS = (() => {
  let files;
  try { files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean); }
  catch {
    files = [];
    const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach(e => {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['.git', 'bin', 'obj', 'dist', 'node_modules'].includes(e.name)) walk(rel); }
      else if (!e.name.endsWith('.local.js') && e.name !== 'CLAUDE.md') files.push(rel);
    });
    walk('.');
  }
  const needle = ['claude.ai', 'artifact'].join('/');
  return files.filter(f => /\.(js|mjs|cs|md|html|css|ps1|py|json|csproj)$/.test(f) && fs.existsSync(path.join(root, f))
    && fs.readFileSync(path.join(root, f), 'utf8').includes(needle));
})();

const tests = `
let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) passed++; else { failed++; console.log('FAIL', name, '\\n   got     ', a, '\\n   expected', e); }
}
const fresh = () => { Store.d = normalizeData(null); return Store.d; };
const ev = (o) => normalizeEvent({ id: 'e1', title: 'T', date: '2026-11-06', start: 540, dur: 60, ...o });
const dates = (e, from, to) => { const out = []; for (let n = dayNum(from); n <= dayNum(to); n++) if (occursOn(e, n)) out.push(fromDayNum(n)); return out; };

// Dates
eq(fromDayNum(dayNum('2026-11-06')), '2026-11-06', 'dayNum round trip');
eq(dowOf('2026-11-06'), 5, 'Nov 6 2026 is a Friday');
eq(dowOf('1969-12-31'), 3, 'weekday before 1970');
eq(addMonths('2026-01-31', 1), '2026-02-28', 'addMonths clamps');
eq(addMonths('2026-11-15', -11), '2025-12-15', 'addMonths backwards over a year');
eq(startOfWeek('2026-11-06', 1), '2026-11-02', 'week start Monday');
eq(startOfWeek('2026-11-06', 0), '2026-11-01', 'week start Sunday');
eq(addDays('2026-03-08', 1), '2026-03-09', 'addDays across DST');
eq(fmtSpan('2026-11-06', '2026-11-15'), 'November 6 to 15', 'phase range label');
eq(fmtSpan('2026-11-28', '2026-12-03'), 'November 28 to December 3', 'phase range across months');

// Typed times
eq(parseTime('930'), 570, '930');
eq(parseTime('9:30'), 570, '9:30');
eq(parseTime('9pm'), 1260, '9pm');
eq(parseTime('12a'), 0, '12a');
eq(parseTime('12:30 pm'), 750, '12:30 pm');
eq(parseTime('21.15'), 1275, '21.15');
eq(parseTime('24:00'), 1440, '24:00');
eq(parseTime('25'), null, '25 is invalid');
eq(parseTime('9:75'), null, '9:75 is invalid');
eq(parseTime('13pm'), null, '13pm is invalid');

// Repeat rules
fresh();
eq(dates(ev({ repeat: { freq: 'weekly', byDay: [5] } }), '2026-11-01', '2026-11-30'), ['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27'], 'weekly Fridays');
eq(dates(ev({ date: '2026-11-02', repeat: { freq: 'weekly', byDay: [1, 2, 3, 4, 5] } }), '2026-11-06', '2026-11-10'), ['2026-11-06', '2026-11-09', '2026-11-10'], 'weekdays skip the weekend');
eq(dates(ev({ date: '2026-11-03', repeat: { freq: 'weekly', interval: 2, byDay: [2, 4], wkst: 1 } }), '2026-11-01', '2026-11-30'), ['2026-11-03', '2026-11-05', '2026-11-17', '2026-11-19'], 'every 2 weeks on Tue and Thu');
eq(dates(ev({ date: '2026-01-31', repeat: { freq: 'monthly' } }), '2026-01-01', '2026-05-31'), ['2026-01-31', '2026-03-31', '2026-05-31'], 'monthly on the 31st skips short months');
eq(dates(ev({ date: '2028-02-29', repeat: { freq: 'yearly' } }), '2028-01-01', '2032-12-31'), ['2028-02-29', '2032-02-29'], 'leap-day yearly');
eq(dates(ev({ repeat: { freq: 'daily', interval: 3 } }), '2026-11-06', '2026-11-15'), ['2026-11-06', '2026-11-09', '2026-11-12', '2026-11-15'], 'every 3 days');
eq(dates(ev({ repeat: { freq: 'weekly', byDay: [5], until: '2026-11-20' } }), '2026-11-01', '2026-12-31'), ['2026-11-06', '2026-11-13', '2026-11-20'], 'until is inclusive');
eq(dates(ev({ repeat: { freq: 'weekly', byDay: [5] }, exceptions: ['2026-11-13'] }), '2026-11-01', '2026-11-30'), ['2026-11-06', '2026-11-20', '2026-11-27'], 'exceptions are skipped');
eq(describeRule({ freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5] }, '2026-11-06'), 'Weekly on weekdays', 'describe weekdays');

// Expansion: an overnight event spills into the next day
{
  const d = fresh();
  d.events.push(ev({ id: 'night', start: 23 * 60, dur: 120 }));
  eq(expandEvents('2026-11-07', '2026-11-07').map(o => o.key), ['night@2026-11-06'], 'overnight spill');
}

// Series edits
{
  const d = fresh();
  const s = ev({ id: 's', date: '2026-11-02', repeat: { freq: 'weekly', byDay: [1] } });
  d.events.push(s);
  const occ = eventOcc(s, '2026-11-16');
  applyEventChange(occ, { start: 600 }, 'one');
  eq(s.exceptions, ['2026-11-16'], "'this event' adds an exception");
  const copy = d.events.find(e => e.id !== 's');
  eq([copy.date, copy.start, copy.repeat, copy.seriesId], ['2026-11-16', 600, null, 's'], "'this event' makes a one-off copy");

  const d2 = fresh();
  const s2 = ev({ id: 's2', date: '2026-11-02', repeat: { freq: 'weekly', byDay: [1] } });
  d2.events.push(s2);
  applyEventChange(eventOcc(s2, '2026-11-16'), { title: 'New' }, 'following');
  const next = d2.events.find(e => e.id !== 's2');
  eq([s2.repeat.until, next.date, next.title, next.repeat.freq], ['2026-11-15', '2026-11-16', 'New', 'weekly'], "'this and following' splits the series");

  const d3 = fresh();
  const s3 = ev({ id: 's3', date: '2026-11-02', repeat: { freq: 'weekly', byDay: [1], until: '2026-11-30' } });
  d3.events.push(s3);
  applyEventChange(eventOcc(s3, '2026-11-16'), { date: '2026-11-17' }, 'all');
  eq([s3.date, s3.repeat.byDay, s3.repeat.until], ['2026-11-03', [2], '2026-12-01'], "dragging one day later with 'all' shifts the whole series");
  eq(d3.events.length, 1, "'all' does not add events");

  const d4 = fresh();
  const s4 = ev({ id: 's4', date: '2026-11-02', repeat: { freq: 'daily' } });
  d4.events.push(s4);
  deleteOccurrence(eventOcc(s4, '2026-11-05'), 'one');
  eq(s4.exceptions, ['2026-11-05'], 'delete one occurrence');
  deleteOccurrence(eventOcc(s4, '2026-11-10'), 'following');
  eq(s4.repeat.until, '2026-11-09', 'delete this and following');
  deleteOccurrence(eventOcc(s4, '2026-11-03'), 'all');
  eq(d4.events.length, 0, 'delete all');
}

// The repo ships no personal content: plans and notes come from seed.local.js (here, the sample plans)
eq(SHIPPED_SEEDS, { plans: 0, notes: 0 }, 'seed.js ships no plans or notes');
eq(ARTIFACT_LINKS, [], 'no claude.ai artifact links in tracked files');

// Seeded plans (sample plans in tests/fixtures/plans.js)
{
  const d = fresh();
  const added = applySeeds(d);
  eq(added, ['Course A Exam Plan', 'Course B Review Plan', 'Course C Exam Plan', 'Course D Study Plan'], 'seed adds every plan once');
  eq(applySeeds(d), [], 'seeding is idempotent');
  eq(['ev-course-a-exam', 'ev-course-c-exam', 'ev-course-d-demo'].map(id => d.events.filter(e => e.id === id).length), [1, 1, 1], 'each plan brings its exam or demo event once');
  const plan = d.plans[0];
  eq([plan.days.length, plan.days[0].date, plan.days[20].date], [21, '2026-11-06', '2026-11-26'], '21 days, Nov 6 to Nov 26');
  eq(new Set(plan.days.map(x => x.date)).size, 21, 'one job per day');
  eq(plan.phases.map(p => plan.days.filter(x => x.phase === p.id).length), [10, 6, 5], 'phase sizes 10 / 6 / 5');
  eq(planExamDate(plan), '2026-11-27', 'exam date comes from the exam event');
  eq(d.events.find(e => e.id === 'ev-course-a-exam').cat, 'c-exam', 'exam event in the Exam category');
  eq(planDur(plan, plan.days[0]), 60, 'daily session is 60 minutes');
  eq(planSteps(plan, plan.days[17]).map(s => s.name), ['Mock exam'], 'mock days run one 60-minute block');
  eq(expandPlans('2026-11-06', '2026-11-06').map(o => [o.title, o.allDay]), [['Chapter 1 statements', true], ['Unit 1', true]], 'both early plans show on Nov 6');
  eq(expandPlans('2026-11-07', '2026-11-07').map(o => o.plan.short), ['Course A', 'Course B', 'Course C', 'Course D'], 'all four plans show on Nov 7');
}

// A checklist plan: a day is done when every item is ticked
{
  const d = fresh();
  applySeeds(d);
  const plan = d.plans.find(p => p.id === 'plan-review');
  eq(plan.days.map(x => x.items.length), [4, 4, 4, 4, 4, 4, 4], 'four checklist items a day');
  eq(plan.days.map(x => planSteps(plan, x).map(s => s.name + ' ' + s.min).join(' + ')),
    ['Main work 60', 'Warm-up 10 + Main work 50', 'Warm-up 10 + Main work 50', 'Warm-up 10 + Main work 50', 'Warm-up 10 + Main work 50', 'Warm-up 10 + Main work 50', 'Mock review 60'], 'a day can override the plan’s steps');
  eq(planExamDate(plan), null, 'no exam date unless the plan has one');
  const day = plan.days[1];
  setPlanItemDone(day, day.items[0].id, true);
  eq([day.done, planDayProgress(day)], [false, { done: 1, total: 4 }], 'one item ticked: day not done yet');
  day.items.slice(1).forEach(i => setPlanItemDone(day, i.id, true));
  eq(day.done, true, 'all four ticked: day done');
  setPlanItemDone(day, day.items[2].id, false);
  eq(day.done, false, 'unticking an item reopens the day');
  setPlanDayDone(day, true);
  eq(day.items.every(i => i.done), true, 'ticking the day ticks every item');
  const round = normalizeData(JSON.parse(JSON.stringify(d))).plans.find(p => p.id === 'plan-review').days[1];
  eq([round.done, round.items.every(i => i.done)], [true, true], 'ticks survive a save and reload');
}

// Milestones: an exam on the last day, and a demo in the middle of a plan
{
  const d = fresh();
  applySeeds(d);
  const fin = d.plans.find(p => p.id === 'plan-final');
  eq([planExamDate(fin), fin.days[fin.days.length - 1].date], ['2026-11-17', '2026-11-17'], 'exam on the plan’s last day');
  eq(planSteps(fin, fin.days[10]).map(s => s.name + ' ' + s.min), ['Summary 30'], 'exam day runs a short review');
  const proj = d.plans.find(p => p.id === 'plan-project');
  eq(proj.days.map(x => x.date.slice(8)), ['07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '18', '19', '20'], 'no study day on the demo day');
  eq(proj.phases.map(p => proj.days.filter(x => x.phase === p.id).length), [7, 6], 'week 1 has 7 days, week 2 has 6 around the demo');
  eq([planExamDate(proj), proj.exam.label, d.events.find(e => e.id === 'ev-course-d-demo').title], ['2026-11-17', 'API demo', 'Course D API demo'], 'the demo is the milestone, with its own event');
  eq(expandPlans('2026-11-17', '2026-11-17').map(o => o.plan.short + ': ' + o.title), ['Course A: Problems 4–6', 'Course C: Exam day'], 'Nov 17 has no Course D study day');
  const ev = d.events.find(e => e.id === 'ev-course-d-demo');
  ev.date = '2026-11-18';
  eq(planExamDate(proj), '2026-11-18', 'moving the event moves the milestone');
}

// An existing data file gets only the plans it has not seen, on next launch
{
  const old = normalizeData({ seeded: ['plan-exam'], plans: [], events: [] });
  eq(applySeeds(old), ['Course B Review Plan', 'Course C Exam Plan', 'Course D Study Plan'], 'only the new plans are added to existing data');
  const two = normalizeData({ seeded: ['plan-exam', 'plan-review'], plans: [], events: [] });
  eq(applySeeds(two), ['Course C Exam Plan', 'Course D Study Plan'], 'data with the first two gets just the other two');
  eq(['ev-course-c-exam', 'ev-course-d-demo'].map(id => two.events.some(e => e.id === id)), [true, true], 'with their exam and demo events');
  eq([andList(['A']), andList(['A', 'B']), andList(['A', 'B', 'C', 'D'])], ['A', 'A and B', 'A, B, C and D'], 'the added-plans toast lists names naturally');
}

// The six medicines a user might add (none are built into the code).
const addSixMeds = d => {
  d.health.meds = [['Vitamin D', '1000 IU', ''], ['Omega-3', '1 g', ''], ['Iron', '65 mg', ''], ['Magnesium', '200 mg', 'With food'], ['Probiotic', '', ''], ['Multivitamin', '', 'With food']]
    .map(([name, dose, note], i) => ({ id: 'm' + i, name, dose, note, times: [480] }));
  d.health = normalizeHealth(d.health);
};

// Daily health: medicines
{
  const d = fresh();
  eq([d.health.meds.length, d.health.water.goal, d.health.water.flaskMl, d.health.workout.week], [0, 3, 1005, ['rest', 'A', 'hiit', 'B', 'jog', 'A', 'hiitcore']], 'new users: no medicines, default water and workout week');
  const old = normalizeData({ events: [], settings: {} });
  eq([old.health.meds.length, old.health.workout.week.length, old.settings.weather.lat], [0, 7, null], 'data from before health gets the defaults (no city until one is picked)');
  const kept = normalizeData({ health: { meds: [{ id: 'x', name: 'Magnesium', dose: '200 mg', times: [480, 1200] }] } });
  eq([kept.health.meds.map(m => medLabel(m)), kept.health.meds[0].times, kept.health.workout.custom], [['Magnesium 200 mg'], [480, 1200], {}], 'a user’s own medicines are kept and older health data gains the new fields');
  addSixMeds(d);
  const today = todayYmd();
  const groups = doseGroups(today);
  eq(groups.map(g => [g.time, g.doses.length]), [[480, 6]], 'one 8 AM slot with all six');
  setDoseTaken(today, groups[0].doses[0].key, true);
  eq(medProgress(today), { taken: 1, total: 6 }, 'ticking one dose');
  setDoseTaken(today, groups[0].doses[0].key, false);
  eq([medProgress(today).taken, d.health.medLog[today]], [0, undefined], 'unticking clears the day');
  d.health.meds[3].times = [480, 1200];
  eq(doseGroups(today).map(g => [fmtTime(g.time), g.doses.map(x => x.med.name)]), [['08:00', d.health.meds.map(m => m.name)], ['20:00', ['Magnesium']]], 'a second time makes a second slot');
}

// Daily health: water and the workout program
{
  const d = fresh();
  d.health.workout.start = '2026-11-06';
  eq([fmtFlasks(1.5), fmtFlasks(0.25), fmtFlasks(3), fmtFlasks(2.75), fmtFlasks(0)], ['1½', '¼', '3', '2¾', '0'], 'flask fractions');
  eq(fmtLitres(3, 1005), '3.0 L', 'three Aquaflasks is about 3 L');
  eq(waterGoal('2026-11-06').flasks, 3.5, 'workout day: 3 + ½');
  eq(waterGoal('2026-11-08').flasks, 3, 'Sunday rest: 3');
  eq(waterGoal('2026-11-06', 34).flasks, 4, 'hot workout day: 3 + ½ + ½');
  eq(waterGoal('2026-11-06', 31).flasks, 3.5, 'not hot below 33 °C');
  eq(waterCheckpoints(3.5).map(c => [c.time / 60, c.target]), [[11, 1.25], [15, 2.25], [19, 3.5]], 'pace: a third, two thirds, all');
  setWater('2026-11-06', 1.3);
  eq(waterOn('2026-11-06'), 1.25, 'water rounds to quarter flasks');

  const wk = ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'].map(x => workoutFor(x));
  eq(wk.map(w => w.short), ['Strength A', 'HIIT + core', 'Rest', 'Strength A', 'HIIT', 'Strength B', 'Walk-jog'], 'first week from Friday');
  eq([wk[0].week, wk[0].phase.name, workoutFor('2026-11-20').phase.name, workoutFor('2026-12-18').phase.name], [1, 'Foundation', 'Build', 'First pull-up'], 'phases advance every two weeks');
  eq(workoutFor('2026-11-05'), null, 'nothing before the program starts');
  const hiit = workoutFor('2026-11-10');
  eq([hiit.steps.length, hiit.min, hiit.steps[1].name, Math.round(hiit.steps[1].min * 60), hiit.steps[2].name], [14, 14, 'Hard', 20, 'Easy'], 'week 1 HIIT: 6 × 20 s hard + 40 s easy, 14 min');
  const jog = workoutFor('2026-11-12');
  eq([jog.min, jog.steps.filter(s => s.name === 'Jog').length], [34, 8], 'week 1 jog: 8 × (1 min jog + 2 min walk)');
  eq([workoutFor('2026-12-17').title, workoutFor('2026-12-24').title, workoutFor('2026-12-24').min], ['Walk-jog intervals', 'Easy jog', 30], 'week 7 Thursday: a continuous 20-minute jog');
  eq(workoutFor('2026-12-18').items.some(i => i.id === 'try'), true, 'pull-up attempts start once strong enough');
  eq(wk[0].items.some(i => i.id === 'try'), false, 'no attempts in week 1');
  setWorkoutItem('2026-11-06', 'hang', true);
  eq(workoutProgress('2026-11-06'), { done: 1, total: 7, complete: false }, 'ticking one exercise');
  wk[0].items.forEach(i => setWorkoutItem('2026-11-06', i.id, true));
  eq(workoutProgress('2026-11-06').complete, true, 'ticking every exercise completes the workout');
  setWorkoutDone('2026-11-06', false);
  eq(workoutProgress('2026-11-06'), { done: 0, total: 7, complete: false }, 'undo clears the ticks');
  eq(expandWorkouts('2026-11-06', '2026-11-12').map(o => [o.date, o.title, o.start]), [['2026-11-06', 'Strength A', 1080], ['2026-11-07', 'HIIT + core', 1080], ['2026-11-09', 'Strength A', 1080], ['2026-11-10', 'HIIT', 1080], ['2026-11-11', 'Strength B', 1080], ['2026-11-12', 'Walk-jog', 1080]], 'workouts in the calendar at 6 PM, rest days left out');
  d.hiddenCats.push('c-health');
  eq(expandWorkouts('2026-11-06', '2026-11-12').length, 0, 'hiding the Health category hides workouts');
}

// Daily health: editing the program and the water container
{
  const d = fresh();
  d.health.workout.start = '2026-11-06';
  const W = d.health.workout;
  W.week[1] = 'hiit';
  eq(workoutFor('2026-11-09').short, 'HIIT', 'Monday changed from Strength A to HIIT');
  const p = parseStepsText('Warm-up 5\\n6 x 20s Hard / 40s Easy\\nPlank 45s\\nCool-down 4');
  eq([p.steps.length, p.steps[1].name, Math.round(p.steps[1].min * 60), p.steps[2].name, Math.round(p.steps[13].min * 60), p.steps[13].name], [15, 'Hard', 20, 'Easy', 45, 'Plank'], 'timer text parses steps, intervals and seconds');
  eq(stepsToText(p.steps), 'Warm-up 5\\n6 x 20s Hard / 40s Easy\\nPlank 45s\\nCool-down 4', 'and turns back into the same text');
  eq(parseStepsText('8 x 1 Jog / 2 Walk').steps.filter(s => s.name === 'Walk').length, 8, 'minutes are the default unit');
  eq(parseStepsText('Warm-up five').error, 'Line 1: "Warm-up five"', 'a line it cannot read is named');
  eq(stepsToText(workoutFor('2026-11-12').steps), 'Walk 5\\n8 x 1 Jog / 2 Walk\\nCool-down 5', 'built-in routines print as editable text');
  W.custom.A = { title: 'Push day', short: 'Push', items: ['Push-ups 4 × 10', 'Dips 3 × 8'], steps: parseStepsText('Warm-up 5\\nPush 20').steps };
  W.custom.w1 = { title: 'Yoga', short: 'Yoga', user: true, items: ['Sun salutations'], steps: [{ name: 'Yoga', min: 30 }] };
  W.week[6] = 'w1';
  d.health = normalizeHealth(d.health);
  const fri = workoutFor('2026-11-06'), sat = workoutFor('2026-11-07');
  eq([fri.title, fri.min, fri.items.map(i => i.text), fri.custom], ['Push day', 25, ['Push-ups 4 × 10', 'Dips 3 × 8'], true], 'an edited built-in routine replaces the automatic one');
  eq([sat.title, sat.min, routineList().map(r => r.id).join(',')], ['Yoga', 30, 'A,B,hiit,hiitcore,jog,rest,w1'], 'a user routine can go on the week');
  setWorkoutItem('2026-11-06', 'c1', true);
  eq(workoutProgress('2026-11-06'), { done: 1, total: 2, complete: false }, 'custom checklists tick like any other');
  delete d.health.workout.custom.A;
  eq(workoutFor('2026-11-13').title, 'Strength A + pull-ups', 'reset brings the progression back');
  d.health.workout.week[0] = 'gone';
  eq(normalizeHealth(d.health).workout.week[0], 'rest', 'a missing routine becomes a rest day');
  eq([waterUnit(1), waterUnit(3)], ['flask', 'flasks'], 'default container name');
  d.health.water.unit = 'glass';
  eq([waterUnit(1), waterUnit(8)], ['glass', 'glasses'], 'renamed container');
}

// Daily health: reminders handed to the host
{
  const d = fresh();
  addSixMeds(d);
  const today = todayYmd();
  d.health.workout.start = addDays(today, -1);
  const at7 = tsOf(today, 7 * 60);
  const r = healthReminders(at7);
  const keys = r.map(x => x.key.split(':')[0]);
  eq([keys.filter(k => k === 'med').length, keys.filter(k => k === 'med-again').length, keys.filter(k => k === 'water').length], [2, 2, 3], 'medicine reminders today and tomorrow, three water nudges');
  eq(r.find(x => x.key.startsWith('med:')).body.includes('Magnesium 200 mg (with food)'), true, 'medicine reminder names the doses and notes');
  eq(keys.includes('workout'), workoutFor(today).type !== 'rest', 'workout reminder on training days only');
  doseGroups(today)[0].doses.forEach(x => setDoseTaken(today, x.key, true));
  setWater(today, 5);
  const after = healthReminders(at7).map(x => x.key);
  eq([after.some(k => k.startsWith('med:' + today)), after.some(k => k.startsWith('water'))], [false, false], 'nothing left to remind once taken and drunk');
}

// Jogging weather
{
  const base = { feels: 27, pop: 10, precip: 0, code: 1, uv: 2, gust: 15, aqi: 40 };
  const lv = o => rateJogHour({ ...base, ...o }).level;
  eq([lv({}), lv({ feels: 33 }), lv({ feels: 36 }), lv({ code: 95 }), lv({ pop: 70 }), lv({ pop: 40 }), lv({ uv: 9 }), lv({ uv: 6.5 }), lv({ aqi: 160 }), lv({ aqi: 120 }), lv({ gust: 55 })],
    ['good', 'fair', 'poor', 'poor', 'poor', 'fair', 'poor', 'fair', 'poor', 'fair', 'poor'], 'rating rules');
  eq(rateJogHour({ ...base, feels: 33.4, pop: 40 }).reasons.map(x => x.text), ['Chance of rain (40%)', 'Hot: feels 33°C, go slow and bring water'], 'reasons say why');

  const hours = [];
  const levels = { 4: 'good', 5: 'poor', 6: 'good', 7: 'good', 8: 'fair', 9: 'poor' };
  const fc = { utc_offset_seconds: 8 * 3600, timezone: 'Etc/GMT-8', hourly: { time: [], temperature_2m: [], apparent_temperature: [], relative_humidity_2m: [], precipitation_probability: [], precipitation: [], weather_code: [], wind_gusts_10m: [], uv_index: [], is_day: [] }, daily: { time: ['2026-11-06'], apparent_temperature_max: [34.6], sunrise: ['2026-11-06T05:50'], sunset: ['2026-11-06T17:28'] } };
  for (let hr = 0; hr < 24; hr++) {
    const want = levels[hr] || 'poor';
    fc.hourly.time.push('2026-11-06T' + String(hr).padStart(2, '0') + ':00');
    fc.hourly.temperature_2m.push(26); fc.hourly.relative_humidity_2m.push(80);
    fc.hourly.apparent_temperature.push(want === 'good' ? 28 : want === 'fair' ? 32 : 36);
    fc.hourly.precipitation_probability.push(10); fc.hourly.precipitation.push(0); fc.hourly.weather_code.push(1);
    fc.hourly.wind_gusts_10m.push(10); fc.hourly.uv_index.push(0); fc.hourly.is_day.push(hr >= 6 && hr < 18 ? 1 : 0);
  }
  const aq = { hourly: { time: fc.hourly.time, us_aqi: fc.hourly.time.map(() => 45) } };
  const p = parseForecast(fc, aq);
  eq([p.hours.length, p.hours[5].ts, p.hours[5].aqi, p.daily['2026-11-06'].maxFeels], [24, Date.UTC(2026, 10, 5, 21), 45, 34.6], 'forecast parsed with absolute times (UTC+8)');
  const midnight = Date.UTC(2026, 10, 5, 16); // 00:00 at UTC+8
  const best = bestJogWindow(p.hours, midnight);
  eq([best.level, best.from.hour, best.to.hour], ['good', 6, 7], 'best window: 6 to 8 AM (4 AM is before waking hours)');
  const afterGood = bestJogWindow(p.hours, Date.UTC(2026, 10, 6, 0, 30)); // 8:30 AM at UTC+8
  eq([afterGood.level, afterGood.from.hour], ['fair', 8], 'falls back to a fair window when no good one is left');
}

// Bad input
eq(normalizeData({ events: 'nope', settings: { pomo: { focus: 30 } } }).settings.pomo.short, 5, 'missing settings get defaults');
eq(normalizeData({ events: [{ id: 'x', date: 'bad' }, { id: 'y', date: '2026-11-06' }] }).events.map(e => e.id), ['y'], 'events with bad dates are dropped');

console.log(passed + ' passed, ' + failed + ' failed');
if (failed) throw new Error(failed + ' test(s) failed');
`;
try {
  vm.runInContext(tests, ctx, { filename: 'logic.test.js' });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
