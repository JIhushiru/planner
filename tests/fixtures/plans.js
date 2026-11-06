'use strict';
/*
 * Sample study plans for the tests, in the same shape as a personal web/js/seed.local.js.
 * The logic tests load this after seed.js; the UI tests serve it as js/seed.local.js.
 * Four kinds of plan: a long exam plan with phases, a checklist review plan, a plan whose exam is
 * its last day, and a plan with a milestone (a demo) in the middle.
 */

// Course A: 21 days (Nov 6-26) in three phases, exam on Fri Nov 27.
SEED_PLANS.push((() => {
  const N = 'https://example.com/course-a/notes';
  const P = 'https://example.com/course-a/problems';
  const day = (id, phase, date, title, main, recall, extra) => ({ id, phase, date, title, main, recall, done: false, ...(extra || {}) });
  const mock = { steps: [{ name: 'Mock exam', min: 60, text: 'Closed notes, timed. The mock is the recall.' }] };
  const learn = (id, date, n) => day(id, 'p1', date, `Chapter ${n} statements`, `Learn the statements in [Chapter ${n}](${N}#ch${n}).`, n > 1 ? `Chapter ${n - 1}` : 'Nothing yet.');
  const prove = (id, date, n) => day(id, 'p1', date, `Chapter ${n} proofs`, `Write the proofs in [Chapter ${n}](${N}#ch${n}) from a blank page.`, `Chapter ${n} statements`);
  const probs = (id, date, a, b) => day(id, 'p2', date, `Problems ${a}–${b}`, `Problems [${a}](${P}#p${a}) to [${b}](${P}#p${b}).`, 'The chapter you trust least');
  return {
    id: 'plan-exam',
    title: 'Course A Exam Plan',
    short: 'Course A',
    eyebrow: 'Course A · Exam on Friday, November 27',
    heading: 'Exam Plan',
    lede: 'One main job per day from November 6 to November 26.',
    links: [{ label: 'Notes', url: N }, { label: 'Problems', url: P }],
    steps: [
      { name: 'Recall', min: 10, text: 'Close your notes and write the listed statements from memory.' },
      { name: 'Main job', min: 40, text: 'Work on paper. Read the answer only after you try.' },
      { name: 'Check', min: 10, text: 'Compare, fix what you missed, then tick the day.' },
    ],
    phases: [
      { id: 'p1', title: 'Learn each chapter', intro: 'Statements one day, proofs the next.', color: '#5BC2B0' },
      { id: 'p2', title: 'Problem set', intro: 'Write each answer from a blank page.', color: '#A0A4F2' },
      { id: 'p3', title: 'Exam practice', intro: 'Work closed-notes first.', color: '#D9AE5B' },
    ],
    days: [
      learn('d01', '2026-11-06', 1), prove('d02', '2026-11-07', 1),
      learn('d03', '2026-11-08', 2), prove('d04', '2026-11-09', 2),
      learn('d05', '2026-11-10', 3), prove('d06', '2026-11-11', 3),
      learn('d07', '2026-11-12', 4), prove('d08', '2026-11-13', 4),
      learn('d09', '2026-11-14', 5), prove('d10', '2026-11-15', 5),
      probs('d11', '2026-11-16', 1, 3), probs('d12', '2026-11-17', 4, 6), probs('d13', '2026-11-18', 7, 9),
      probs('d14', '2026-11-19', 10, 12), probs('d15', '2026-11-20', 13, 15),
      day('d16', 'p2', '2026-11-21', 'Catch-up day', 'Redo the problems you could not write the first time.', 'The chapter you trust least'),
      day('d17', 'p3', '2026-11-22', 'Summary sheet', `Write every definition and theorem on one sheet. Compare with [the notes](${N}).`, 'All definitions'),
      day('d18', 'p3', '2026-11-23', 'Mock exam 1', 'Mock exam 1: 60 minutes, closed notes.', 'Skip today. The mock is the recall.', mock),
      day('d19', 'p3', '2026-11-24', 'Mark mock 1', 'Mark mock 1 and rewrite what you missed.', 'Whatever mock 1 exposed'),
      day('d20', 'p3', '2026-11-25', 'Mock exam 2', 'Mock exam 2: same format, different problems.', 'Skip today. The mock is the recall.', mock),
      day('d21', 'p3', '2026-11-26', 'Light day', 'Mark mock 2 and recite only what you still miss. Stop early.', 'Your unticked items'),
    ],
    exam: { date: '2026-11-27', label: 'Exam', eventId: 'ev-course-a-exam' },
    notes: 'On a busy day, do only the Recall block.',
    time: null,
    reminder: 10,
    hidden: false,
    seedEvents: [{
      id: 'ev-course-a-exam', title: 'Course A Exam', date: '2026-11-27', allDay: true, days: 1, start: 540, dur: 120,
      cat: 'c-exam', location: '', notes: 'Set the start time here once you know it.', repeat: null, exceptions: [], reminder: 1440,
    }],
  };
})());

// Course B: 7 days (Nov 6-12), four checklist items a day, no exam date.
SEED_PLANS.push((() => {
  const R = 'https://example.com/course-b/review';
  const main = { name: 'Main work', text: 'Work down the day’s list. Tick each item as you finish it.' };
  const day = (id, date, title, items, extra) => ({
    id, phase: 'r', date, title, main: '', recall: '', done: false,
    items: items.map((text, k) => ({ id: `${id}-${k + 1}`, text, done: false })),
    ...(extra || {}),
  });
  const unit = (id, date, n, extra) => day(id, date, `Unit ${n}`, [
    `Warm-up: 10 min of [flashcards](${R}#cards).`,
    `Read [Unit ${n}](${R}#u${n}).`,
    `Work the examples in [Unit ${n}](${R}#u${n}).`,
    `Take the [Unit ${n} quiz](${R}#quiz).`,
  ], extra);
  return {
    id: 'plan-review',
    title: 'Course B Review Plan',
    short: 'Course B',
    eyebrow: 'Course B · Review',
    heading: '7-day review plan',
    lede: 'About an hour a day.',
    links: [{ label: 'Review', url: R }, { label: 'Flashcards', url: `${R}#cards` }],
    steps: [
      { name: 'Warm-up', min: 10, text: 'Flashcards from the day before.' },
      { ...main, min: 50 },
    ],
    phases: [{ id: 'r', title: 'Review schedule', intro: '', color: '#E3909B' }],
    days: [
      unit('m01', '2026-11-06', 1, { steps: [{ ...main, min: 60 }] }),
      unit('m02', '2026-11-07', 2), unit('m03', '2026-11-08', 3), unit('m04', '2026-11-09', 4),
      unit('m05', '2026-11-10', 5), unit('m06', '2026-11-11', 6),
      day('m07', '2026-11-12', 'Full mock review', [
        `Go through [the whole review](${R}) with recall on.`,
        `[Flashcards](${R}#cards) until none are left.`,
        'Closed-book, timed: the five key proofs.',
        `Retake [the quiz](${R}#quiz).`,
      ], { steps: [{ name: 'Mock review', min: 60, text: 'Recall pass, flashcards, then timed closed-book proofs.' }] }),
    ],
    exam: null,
    notes: '',
    time: null,
    reminder: 10,
    hidden: false,
    seedEvents: [],
  };
})());

// Course C: 11 days (Nov 7-17); the exam is on the plan's last day.
SEED_PLANS.push((() => {
  const N = 'https://example.com/course-c/notes';
  const day = (id, date, title, main, extra) => ({ id, phase: 'f', date, title, main, recall: '', done: false, ...(extra || {}) });
  const topic = (id, date, n) => day(id, date, `Topic ${n}`, `Practice the problems in [Topic ${n}](${N}#t${n}).`);
  return {
    id: 'plan-final',
    title: 'Course C Exam Plan',
    short: 'Course C',
    eyebrow: 'Course C · Exam on Tuesday, November 17',
    heading: 'Exam Plan',
    lede: 'One topic a day, then a timed mock and a day to fix weak spots.',
    links: [{ label: 'Notes', url: N }],
    phases: [{ id: 'f', title: 'Daily focus', intro: '', color: '#9E56DC' }],
    days: [
      topic('a01', '2026-11-07', 1), topic('a02', '2026-11-08', 2), topic('a03', '2026-11-09', 3),
      topic('a04', '2026-11-10', 4), topic('a05', '2026-11-11', 5), topic('a06', '2026-11-12', 6),
      topic('a07', '2026-11-13', 7), topic('a08', '2026-11-14', 8),
      day('a09', '2026-11-15', 'Timed mock exam', `Mixed problems using only your [summary sheet](${N}#sheet).`,
        { steps: [{ name: 'Mock exam', min: 60, text: 'Mixed problems, timed.' }] }),
      day('a10', '2026-11-16', 'Fix weak spots', 'Redo everything you missed. Stop early and sleep well.'),
      day('a11', '2026-11-17', 'Exam day', `Spend 30 minutes on [the summary sheet](${N}#sheet), with no new problems.`,
        { steps: [{ name: 'Summary', min: 30, text: 'Summary sheet only. No new problems.' }] }),
    ],
    exam: { date: '2026-11-17', label: 'Exam', eventId: 'ev-course-c-exam' },
    notes: '',
    time: null,
    reminder: 10,
    hidden: false,
    seedEvents: [{
      id: 'ev-course-c-exam', title: 'Course C Exam', date: '2026-11-17', allDay: true, days: 1, start: 540, dur: 120,
      cat: 'c-exam', location: '', notes: '', repeat: null, exceptions: [], reminder: 1440,
    }],
  };
})());

// Course D: Nov 7-20 with a demo on Tue Nov 17 in the middle (no study that day).
SEED_PLANS.push((() => {
  const D = 'https://example.com/course-d';
  const day = (id, phase, date, title, main, extra) => ({ id, phase, date, title, main, recall: '', done: false, ...(extra || {}) });
  const talk = { steps: [{ name: 'Run-through', min: 60, text: 'Give the demo out loud, timing each part.' }] };
  return {
    id: 'plan-project',
    title: 'Course D Study Plan',
    short: 'Course D',
    eyebrow: 'Course D · API demo on Tuesday, November 17',
    heading: 'Demo and next topic',
    lede: 'Prepare the demo, give it on November 17, then start the next topic.',
    links: [
      { label: 'Project notes', url: `${D}/notes` },
      { label: 'Script', url: `${D}/script` },
      { label: 'Slides', url: `${D}/slides` },
      { label: 'Next topic', url: `${D}/topic` },
    ],
    phases: [
      { id: 'w1', title: 'Week 1: build the demo', intro: '', color: '#BB6802' },
      { id: 'w2', title: 'Week 2: demo, then the next topic', intro: '', color: '#BB6802' },
    ],
    days: [
      day('b01', 'w1', '2026-11-07', 'Outline the demo', `[Project](${D}/notes): outline the demo.`),
      day('b02', 'w1', '2026-11-08', 'Build part 1', `[Project](${D}/notes): build part 1.`),
      day('b03', 'w1', '2026-11-09', 'Build part 2', `[Project](${D}/notes): build part 2.`),
      day('b04', 'w1', '2026-11-10', 'Timed rehearsal', `Rehearse [the script](${D}/script) once, timing each part.`, talk),
      day('b05', 'w1', '2026-11-11', 'Topic: basics', `[Topic](${D}/topic#basics): the basics.`),
      day('b06', 'w1', '2026-11-12', 'Topic: a full problem', `[Topic](${D}/topic#basics): one full problem.`),
      day('b07', 'w1', '2026-11-13', 'Topic: special cases', `[Topic](${D}/topic#basics): special cases.`),
      day('b08', 'w2', '2026-11-14', 'Topic: uniqueness', `[Topic](${D}/topic#basics): uniqueness.`),
      day('b09', 'w2', '2026-11-15', 'Mixed practice', `Mixed [practice problems](${D}/topic#practice), closed notes.`),
      day('b10', 'w2', '2026-11-16', 'Final run-through', `Final run-through ([slides](${D}/slides), [script](${D}/script)), then stop early.`, talk),
      day('b11', 'w2', '2026-11-18', 'Next topic: part 1', `[Next topic](${D}/topic#next): part 1.`),
      day('b12', 'w2', '2026-11-19', 'Next topic: part 2', `[Next topic](${D}/topic#next): part 2.`),
      day('b13', 'w2', '2026-11-20', 'Next topic: part 3', `[Next topic](${D}/topic#next): part 3.`),
    ],
    exam: { date: '2026-11-17', label: 'API demo', eventId: 'ev-course-d-demo' },
    notes: '',
    time: null,
    reminder: 10,
    hidden: false,
    seedEvents: [{
      id: 'ev-course-d-demo', title: 'Course D API demo', date: '2026-11-17', allDay: true, days: 1, start: 540, dur: 60,
      cat: 'c-exam', location: '', notes: 'Give the demo. No other study today.', repeat: null, exceptions: [], reminder: 1440,
    }],
  };
})());

LOCAL_HEALTH_NOTES.push('A sample note from seed.local.js.');
