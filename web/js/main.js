'use strict';
/* App shell: startup, header, navigation, theme, keyboard shortcuts, reminders and host messages. */

const App = {
  state: { view: 'week', date: todayYmd(), taskDate: todayYmd(), healthDate: todayYmd(), planId: null, miniMonth: null, today: todayYmd() },
  healthScrollTo: null,
  occByKey: new Map(),
  boot: null,
  dragging: false,
  resetScroll: true,
  lastReminderSync: 0,

  async init() {
    const boot = await Host.boot();
    this.boot = boot;
    Store.init(boot);
    const S = Store.d.settings;
    Fmt.h12 = S.time12h;
    this.state.view = ['day', 'week', 'month'].includes(S.view) ? S.view : 'week';
    applyTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
    this.wireHeader();
    this.applyLayout();
    applyPanelOrder();
    initPanelDrag();
    Pomo.init();
    Weather.init();
    this.render();

    Host.on('shown', () => { this.minuteTick(true); Weather.refresh(false); });
    Host.on('newEvent', () => { closeAllModals(); openEditor({ draft: {} }); });
    Host.on('importData', m => applyImport(m.json, m.name));
    Host.on('toast', m => toast(m.text));
    Host.on('saveError', m => toast('Planner could not save: ' + m.error, { kind: 'error', timeout: 12000 }));
    Host.on('autostart', m => { this.boot.autostart = m.enabled; });
    Host.on('reminderFired', m => { if (document.visibilityState === 'visible') toast(`${m.title} · ${m.body}`, { timeout: 9000 }); });

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onDocClick);
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => e.preventDefault());
    window.addEventListener('resize', debounce(() => { if (this.state.view === 'month') this.renderMain(); }, 120));
    setInterval(() => this.minuteTick(false), 20000);

    Host.post({ type: 'hostSettings', closeToTray: S.closeToTray });
    if (S.zoom && S.zoom !== 1) Host.post({ type: 'zoom', factor: S.zoom });
    scheduleReminders();
    if (boot.loadError) toast(boot.loadError, { kind: 'error', timeout: 15000 });
    if (Store.justSeeded.length) toast(`${andList(Store.justSeeded)} added. Today’s study job is on the right.`, { timeout: 9000 });
    if (Store.healthNew) toast('New: Daily health with your medicines, water and workouts, plus jogging weather. Press H to open it.', { timeout: 12000 });
    document.body.classList.add('ready');
    Host.post({ type: 'ready' });
  },

  wireHeader() {
    $$('[data-icon]').forEach(el => el.prepend(icon(el.dataset.icon, +(el.dataset.size || 17))));
    $('#btnToday').addEventListener('click', () => this.goToday());
    $('#btnPrev').addEventListener('click', () => this.go(-1));
    $('#btnNext').addEventListener('click', () => this.go(1));
    $$('#viewSeg button').forEach(b => b.addEventListener('click', () => { this.resetScroll = this.state.view === 'month' || this.state.view === 'plan'; this.setView(b.dataset.view); }));
    $('#btnNew').addEventListener('click', () => openEditor({ draft: {} }));
    $('#btnSettings').addEventListener('click', () => openSettings());
    $('#btnHelp').addEventListener('click', () => showShortcuts());
    $('#btnSidebar').addEventListener('click', () => this.toggleSide('showSidebar'));
    $('#btnPanel').addEventListener('click', () => this.toggleSide('showPanel'));
    $('#btnEditCats').addEventListener('click', () => openSettings('categories'));
  },

  applyLayout() {
    const S = Store.d.settings;
    const app = $('#app');
    app.classList.toggle('no-sidebar', !S.showSidebar);
    app.classList.toggle('no-panel', !S.showPanel);
  },

  toggleSide(key) {
    Store.d.settings[key] = !Store.d.settings[key];
    Store.quiet();
    this.applyLayout();
    if (this.state.view === 'month') this.renderMain();
  },

  render() {
    if (this.dragging) return;
    this.renderHeader();
    this.renderMain();
    this.renderSidebar();
    this.renderPanels();
    scheduleRemindersSoon();
  },

  renderHeader() {
    const v = this.state.view;
    $('#periodTitle').textContent = periodTitle();
    $$('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    $('#app').dataset.view = v;
    const today = todayYmd();
    let showsToday;
    if (v === 'plan') showsToday = true;
    else if (v === 'health') showsToday = (this.state.healthDate || today) === today;
    else if (v === 'month') showsToday = startOfMonth(this.state.date) === startOfMonth(today);
    else showsToday = visibleDates().includes(today);
    $('#btnToday').classList.toggle('is-current', showsToday);
  },

  renderMain() {
    const main = $('#main');
    this.occByKey.clear();
    const v = this.state.view;
    if (v === 'plan') renderPlanView(main);
    else if (v === 'health') renderHealthView(main);
    else if (v === 'month') renderMonth(main);
    else renderTimeline(main);
  },

  renderSidebar() {
    renderMiniCal();
    renderHealthLink();
    renderPlansList();
    renderUpcoming();
    renderCategories();
  },

  renderPanels() {
    renderNowCard();
    renderHealthCard();
    renderWeatherCard();
    renderStudyCard();
    Pomo.render();
    renderTasksCard();
  },

  setView(v) {
    closePopover();
    this.state.view = v;
    if (['day', 'week', 'month'].includes(v)) { Store.d.settings.view = v; Store.quiet(); }
    this.state.miniMonth = null;
    this.render();
  },

  /** Opens the Daily health page on today, optionally scrolled to a section (hv-meds, hv-water, hv-work, hv-weather). */
  openHealth(sectionId) {
    closePopover();
    if (this.state.view !== 'health') this.state.healthDate = todayYmd();
    this.state.view = 'health';
    this.resetScroll = true;
    this.healthScrollTo = sectionId || null;
    this.render();
  },

  openPlan(id, date) {
    this.state.view = 'plan';
    this.state.planId = id;
    this.resetScroll = true;
    this.render();
    if (date) scrollPlanTo(date, false);
  },

  goToday() {
    const today = todayYmd();
    this.state.date = today;
    this.state.taskDate = today;
    this.state.healthDate = today;
    this.state.miniMonth = null;
    this.resetScroll = true;
    if (this.state.view === 'plan') { scrollPlanTo(today); return; }
    this.render();
  },

  go(delta) {
    const st = this.state;
    if (st.view === 'plan') return;
    if (st.view === 'health') { st.healthDate = addDays(st.healthDate || todayYmd(), delta); this.render(); return; }
    if (st.view === 'day') { st.date = addDays(st.date, delta); st.taskDate = st.date; }
    else if (st.view === 'week') st.date = addDays(st.date, 7 * delta);
    else st.date = addMonths(startOfMonth(st.date), delta);
    st.miniMonth = null;
    this.render();
  },

  /** Runs every 20 s: moves the now line, refreshes Now / Next and rolls over to a new day at midnight. */
  minuteTick(force) {
    const today = todayYmd();
    if (today !== this.state.today) {
      const old = this.state.today;
      this.state.today = today;
      if (this.state.date === old) this.state.date = today;
      if (this.state.taskDate === old) this.state.taskDate = today;
      if (this.state.healthDate === old) this.state.healthDate = today;
      this.resetScroll = true;
      this.render();
      scheduleReminders();
      return;
    }
    if (force) { if (!this.dragging && !topModal()) this.render(); }
    else if (!this.dragging) { updateNowMarks(); renderNowCard(); renderHealthCard(); renderWeatherCard(); }
    if (Date.now() - this.lastReminderSync > 10 * 60000) scheduleReminders();
  },
};

// ── Theme ───────────────────────────────────────────────────────────────
function applyTheme() {
  const S = Store.d.settings;
  const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = S.theme === 'dark' || (S.theme === 'system' && sysDark);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  const cs = getComputedStyle(root);
  const v = n => cs.getPropertyValue(n).trim();
  Host.theme({ dark, bg: v('--surface'), caption: v('--header'), text: v('--text') });
}

// ── Reminders: hand the host everything due in the next two days ────────
function scheduleReminders() {
  App.lastReminderSync = Date.now();
  const S = Store.d.settings;
  const now = Date.now(), today = todayYmd();
  const items = [];
  if (S.notifyEvents) {
    for (const o of occurrences(addDays(today, -1), addDays(today, 2))) {
      let at, body;
      if (o.kind === 'event') {
        const rem = o.ev.reminder;
        if (rem == null) continue;
        if (o.allDay) {
          at = tsOf(o.date, 9 * 60) - (rem >= 1440 ? 86400000 : 0);
          body = rem >= 1440 ? `Tomorrow, ${fmtDateLong(o.date)}` : `Today, all day`;
        } else {
          at = tsOf(o.date, o.start) - rem * 60000;
          body = fmtRange(o.start, o.start + o.dur) + (rem ? ` · starts in ${fmtDur(rem)}` : ' · starting now') + (o.ev.location ? ` · ${o.ev.location}` : '');
        }
      } else if (o.kind === 'plan') {
        if (o.allDay || o.plan.reminder == null || o.done) continue;
        at = tsOf(o.date, o.start) - o.plan.reminder * 60000;
        body = `${fmtTime(o.start)} study session (${planDur(o.plan, o.day)} min): ${o.day.title}`;
      } else continue; // workouts are reminded by the health reminders below
      if (at < now - 60000) continue;
      items.push({ key: `${o.key}|${at}`, at, title: o.label || o.title || '(No title)', body, sound: 'none' });
    }
  }
  // Medicines, water and the workout have their own switches on the Health page.
  for (const r of healthReminders(now)) items.push({ ...r, sound: 'none' });
  Host.reminders(items);
}
const scheduleRemindersSoon = debounce(scheduleReminders, 400);

// ── Keyboard and links ──────────────────────────────────────────────────
function onKeyDown(e) {
  if (e.key === 'Escape') {
    if (closePopover()) { e.preventDefault(); return; }
    const m = topModal();
    if (m) { e.preventDefault(); m.tryClose(); }
    return;
  }
  if (topModal() || isTyping(e) || App.dragging) return;
  const key = e.key;
  if (e.ctrlKey && !e.shiftKey && !e.altKey && key.toLowerCase() === 'z') { e.preventDefault(); Store.undo(); return; }
  if (e.ctrlKey && key === ',') { e.preventDefault(); openSettings(); return; }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  switch (key) {
    case 't': case 'T': App.goToday(); break;
    case 'd': case 'D': App.setView('day'); break;
    case 'w': case 'W': App.setView('week'); break;
    case 'm': case 'M': App.setView('month'); break;
    case 'ArrowLeft': App.go(-1); break;
    case 'ArrowRight': App.go(1); break;
    case 'n': case 'N': case 'c': case 'C': openEditor({ draft: {} }); break;
    case 'h': case 'H': App.openHealth(); break;
    case 'p': case 'P': Pomo.toggle(); break;
    case ' ':
      if (e.target === document.body) { e.preventDefault(); Pomo.toggle(); }
      return;
    case '?': showShortcuts(); break;
    case '[': App.toggleSide('showSidebar'); break;
    case ']': App.toggleSide('showPanel'); break;
    default: return;
  }
  e.preventDefault();
}

function onDocClick(e) {
  const a = e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (/^https?:\/\//i.test(href)) {
    e.preventDefault();
    Host.openUrl(href);
  }
}

App.init();
