'use strict';
/*
 * Bridge to the Windows host (Planner.exe). When the page is opened in a normal browser
 * (for previews), it falls back to localStorage, setTimeout alarms and Web Audio chimes.
 */
const Host = (() => {
  const wv = window.chrome && window.chrome.webview;
  const native = !!wv;
  const LS_KEY = 'planner-data';
  const handlers = Object.create(null);

  function on(type, fn) { (handlers[type] || (handlers[type] = [])).push(fn); }
  function emit(msg) {
    for (const fn of handlers[msg.type] || []) {
      try { fn(msg); } catch (e) { console.error(e); }
    }
  }
  if (native) wv.addEventListener('message', e => emit(e.data));
  function post(msg) { if (native) wv.postMessage(msg); }

  async function boot() {
    if (native) {
      try {
        const r = await fetch('/api/boot', { cache: 'no-store' });
        return await r.json();
      } catch (e) {
        return { data: null, loadError: 'Planner could not read its data: ' + e.message };
      }
    }
    let data = null;
    try { data = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { /* ignore */ }
    return {
      data, browser: true, version: 'preview', autostart: false,
      dataPath: 'Browser storage (preview only)',
      systemDark: matchMedia('(prefers-color-scheme: dark)').matches,
    };
  }

  function save(json) {
    if (native) post({ type: 'save', json });
    else { try { localStorage.setItem(LS_KEY, json); } catch { /* ignore */ } }
  }

  // ── Alarms: the host fires them even while the window is hidden in the tray ──
  const fallbackTimers = new Map();
  function timer(t) {
    if (native) { post({ type: 'timer', ...t }); return; }
    clearTimeout(fallbackTimers.get(t.token));
    fallbackTimers.set(t.token, setTimeout(() => {
      fallbackTimers.delete(t.token);
      webChime(t.sound, t.volume);
      if (t.notify && document.hidden) webNotify(t.title, t.body);
      emit({ type: 'timerFired', token: t.token });
    }, Math.max(0, t.at - Date.now())));
  }
  function cancelTimer(token) {
    if (native) { post({ type: 'timerCancel', token }); return; }
    if (token === '*') { fallbackTimers.forEach(clearTimeout); fallbackTimers.clear(); return; }
    clearTimeout(fallbackTimers.get(token));
    fallbackTimers.delete(token);
  }
  function reminders(items) { if (native) post({ type: 'reminders', items }); }
  function notify(title, body) { if (native) post({ type: 'notify', title, body }); else webNotify(title, body); }
  function chime(sound, volume) { if (native) post({ type: 'chime', sound, volume }); else webChime(sound, volume); }
  function status(s) {
    if (native) post({ type: 'status', ...s });
    else document.title = s.title ? s.title + ' · Planner' : 'Planner';
  }
  function theme(t) { post({ type: 'theme', ...t }); }
  function openUrl(url) {
    if (native) post({ type: 'openUrl', url });
    else window.open(url, '_blank', 'noopener');
  }

  // ── Browser-preview fallbacks ──
  let audio = null;
  function webChime(sound, volume = 0.7) {
    if (!sound || sound === 'none') return;
    try {
      audio = audio || new AudioContext();
      const notes = {
        focusEnd: [1046.5, 783.99, 659.25], breakEnd: [659.25, 783.99, 1046.5],
        step: [880, 1174.66], done: [783.99, 987.77, 1174.66, 1567.98], reminder: [987.77, 1318.51],
      }[sound] || [1046.5, 783.99, 659.25];
      const t0 = audio.currentTime + 0.02;
      notes.forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = f;
        o.type = 'sine';
        const t = t0 + i * 0.17;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.25 * Math.pow(volume, 1.6), t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
        o.connect(g).connect(audio.destination);
        o.start(t);
        o.stop(t + 1.15);
      });
    } catch { /* audio unavailable */ }
  }
  function webNotify(title, body) {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'granted') new Notification(title, { body });
      else if (Notification.permission !== 'denied') Notification.requestPermission();
    } catch { /* ignore */ }
  }

  return { native, on, emit, post, boot, save, timer, cancelTimer, reminders, notify, chime, status, theme, openUrl };
})();
