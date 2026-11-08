# Planner

An everyday calendar, scheduler and focus timer for Windows, with study plans built in.

## Pin it to the taskbar

1. Open `dist\Planner.exe`.
2. Right-click its icon on the taskbar and choose **Pin to taskbar**.

Leave the exe where it is, because the pin points at this file. Rebuilding replaces it in place, so the pin keeps working.

## What it does

- **Calendar**: day, week and month views. Drag across empty time to add an event, drag a block to move it, drag its bottom edge to change the end time. Ctrl + scroll zooms the day and week views, and the **24h** button (or **F**) fits the whole day, 12 AM to midnight, on screen without scrolling.
- **Repeating events**: daily, weekdays, weekly, monthly, yearly or custom, with an optional end date. Changing one occurrence asks whether it applies to this event, this and following, or all.
- **Reminders**: Windows notifications and a chime before events and study sessions, even while Planner sits in the tray. Turn the chime off in Settings → App and data.
- **Focus timer**: 25 / 5 / 15 minute Pomodoro with chimes, a progress bar on the taskbar icon and play / skip buttons on the taskbar preview. Durations are in Settings.
- **Tasks**: a short list per day. Unfinished tasks carry into today. The target button on a task starts a focus timer for it.
- **Study plans**: a day-by-day plan toward an exam or another milestone, such as a report. Each day has a job (or a checklist), links to your notes and a session timer with its own steps. Today's job shows in the right panel, and each plan counts down to its milestone. Tick days or items off, drag days to other dates, and collapse a plan in the right panel when you don't need it. Planner ships with no plans; see [Your own plans](#your-own-plans).

## Your own plans

Study plans, like everything personal, stay out of the repo. Put yours in `web/js/seed.local.js`. Git ignores that file, but `build.ps1` still builds it into your `Planner.exe`, and each plan is added to your data once, on the next launch. The file pushes plans onto `SEED_PLANS`, and can add lines to the Health page notes with `LOCAL_HEALTH_NOTES`. [tests/fixtures/plans.js](tests/fixtures/plans.js) shows every kind of plan:

```js
SEED_PLANS.push({
  id: 'plan-my-exam', title: 'My Exam Plan', short: 'Exam',
  phases: [{ id: 'p1', title: 'Learn', color: '#5BC2B0' }],
  steps: [{ name: 'Study', min: 50, text: '' }],
  days: [{ id: 'd1', phase: 'p1', date: '2026-12-01', title: 'Chapter 1', main: 'Read [chapter 1](https://example.com).' }],
  exam: { date: '2026-12-10', label: 'Exam' },
});
```

## Daily health

Open it with the heart in the sidebar or press **H**. The right panel shows today at a glance. Everything here is yours to change, and it is stored in your data file, not in the code.

- **Medicines**: start empty. Add the ones you take with their dose, a note (for example "with food") and one or more times a day. You get a checklist and a Windows reminder at each time, plus a second reminder an hour later if any are left.
- **Water**: tracked in your own container, by default a 34 oz (about 1 L) flask. The goal starts at 3 a day, plus ½ on workout days and ½ on hot days (feels-like 33 °C or more). Tap a container or use the +¼ / +½ / +1 buttons. Rename the container, change its size or the goal on the Health page. Reminders nudge you if you fall behind: a third by 11 AM, two thirds by 3 PM, the rest by 7 PM.
- **Workout**: starts with a beginner program toward a first pull-up while burning fat, about 35 minutes a day:

  | Day | Workout |
  | --- | --- |
  | Mon, Fri | Strength A: dead hangs, scapular pulls, slow negative pull-ups, push-ups, squats, plank |
  | Wed | Strength B: flexed-arm hang, dead hangs, backpack rows, lunges, glute bridges, dead bugs |
  | Tue | HIIT intervals |
  | Sat | HIIT + core |
  | Thu | Walk-jog intervals (at the best jogging time) |
  | Sun | Rest |

  The built-in workouts step up every two weeks (Foundation → Build → Strength → First pull-up). **Edit program** lets you pick the workout for each day, edit any workout's checklist and timer, add your own, and reset a built-in one. Timer steps are one per line: `Warm-up 5`, `Plank 45s`, `6 x 20s Hard / 40s Easy`. Workouts show in the calendar at the workout time (6 PM by default), and **Start workout** runs the timer.
- **Jogging weather**: the best time to jog in the next day, with an hour-by-hour bar for today and tomorrow (deeper green is better). Hours are rated from feels-like temperature, rain and storms, UV, wind and air quality. It uses Open-Meteo (free, no account); only your city's coordinates are sent. Pick your city on the weather card; until then it asks for one.

Check with your doctor before starting HIIT, especially if you take regular medicine.

## Arrange the right panel

Hover a card and drag the handle at its top to move it. With the keyboard, focus the handle and press ↑ or ↓. Settings → General → **Reset order** puts the cards back.

## Keyboard

| Key | Action |
| --- | --- |
| T | Today |
| D / W / M | Day, week, month |
| F | Fit the whole day on screen, or scroll |
| ← / → | Previous / next |
| N | New event |
| H | Daily health |
| P or Space | Start / pause the timer |
| Ctrl + Z | Undo |
| ? | All shortcuts |

## Your data

Planner saves to `%APPDATA%\Planner\data.json` after every change and keeps one copy per day in `%APPDATA%\Planner\backups` (last 30). Settings → App and data has Export, Import and Open folder.

Closing the window keeps Planner running in the tray so timers and reminders still work. Right-click the tray icon to quit, or turn this off in Settings.

## Rebuild after changing the code

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

Needs the .NET 8 SDK. The script runs `tests\logic.test.js` first and writes `dist\Planner.exe`. If Planner is running, the script asks it to quit, rebuilds, and starts it again in the tray.
