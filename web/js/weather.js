'use strict';
/*
 * Jogging weather from Open-Meteo (free, no API key; only coordinates are sent).
 * Every hour is rated Good / Fair / Poor for jogging from heat and humidity (feels-like),
 * rain and storms, UV, wind gusts and air quality. The forecast is cached in localStorage
 * so the card still shows something when offline.
 */

const JOG_LEVELS = { good: { label: 'Good' }, fair: { label: 'Fair' }, poor: { label: 'Poor' } };

/** Rates one forecast hour. Returns { level: 'good' | 'fair' | 'poor', reasons: [{ level, text, short }] }. */
function rateJogHour(h) {
  let level = 0;
  const reasons = [];
  const bump = (lv, text, short) => { reasons.push({ level: ['good', 'fair', 'poor'][lv], text, short }); level = Math.max(level, lv); };
  const feels = Math.round(h.feels);
  if ([95, 96, 99].includes(h.code)) bump(2, 'Thunderstorm', 'storm');
  else if (h.precip >= 0.5 || h.pop >= 60) bump(2, h.precip >= 0.5 ? 'Raining' : `Rain likely (${h.pop}%)`, h.precip >= 0.5 ? 'raining' : 'rain likely');
  else if (h.precip > 0 || h.pop >= 35) bump(1, `Chance of rain (${h.pop}%)`, 'chance of rain');
  if (h.feels >= 35) bump(2, `Too hot: feels ${feels}°C`, 'too hot');
  else if (h.feels >= 31) bump(1, `Hot: feels ${feels}°C, go slow and bring water`, 'hot');
  else if (h.feels <= -5) bump(2, `Very cold: feels ${feels}°C`, 'very cold');
  else if (h.feels <= 2) bump(1, `Cold: feels ${feels}°C`, 'cold');
  if (h.uv >= 8) bump(2, `Very high UV (${Math.round(h.uv)})`, 'very high UV');
  else if (h.uv >= 6) bump(1, `High UV (${Math.round(h.uv)})`, 'high UV');
  if (h.gust >= 50) bump(2, `Strong wind, gusts ${Math.round(h.gust)} km/h`, 'strong wind');
  else if (h.gust >= 35) bump(1, `Windy, gusts ${Math.round(h.gust)} km/h`, 'windy');
  if (h.aqi != null) {
    if (h.aqi > 150) bump(2, `Unhealthy air (AQI ${h.aqi})`, 'unhealthy air');
    else if (h.aqi > 100) bump(1, `Air quality only fair (AQI ${h.aqi})`, 'so-so air');
  }
  return { level: ['good', 'fair', 'poor'][level], reasons };
}

/** Turns Open-Meteo's forecast (+ optional air quality) into rated hours with absolute timestamps. */
function parseForecast(fc, aq) {
  const off = (fc.utc_offset_seconds || 0) * 1000;
  const H = fc.hourly;
  const aqi = new Map();
  if (aq && aq.hourly && aq.hourly.time) aq.hourly.time.forEach((t, i) => aqi.set(t, aq.hourly.us_aqi[i]));
  const hours = H.time.map((t, i) => {
    const [d, hm] = t.split('T');
    const [y, mo, da] = d.split('-').map(Number);
    const hour = +hm.slice(0, 2);
    const hr = {
      time: t, date: d, hour, ts: Date.UTC(y, mo - 1, da, hour) - off,
      temp: H.temperature_2m[i], feels: H.apparent_temperature[i], humidity: H.relative_humidity_2m[i],
      pop: H.precipitation_probability ? H.precipitation_probability[i] ?? 0 : 0,
      precip: H.precipitation ? H.precipitation[i] ?? 0 : 0,
      code: H.weather_code[i], gust: H.wind_gusts_10m ? H.wind_gusts_10m[i] ?? 0 : 0,
      uv: H.uv_index ? H.uv_index[i] ?? 0 : 0, isDay: H.is_day ? H.is_day[i] === 1 : true,
      aqi: aqi.has(t) && aqi.get(t) != null ? Math.round(aqi.get(t)) : null,
    };
    hr.rating = rateJogHour(hr);
    return hr;
  });
  const daily = {};
  if (fc.daily && fc.daily.time) {
    fc.daily.time.forEach((d, i) => {
      daily[d] = {
        maxFeels: fc.daily.apparent_temperature_max ? fc.daily.apparent_temperature_max[i] : null,
        sunrise: fc.daily.sunrise ? fc.daily.sunrise[i] : null,
        sunset: fc.daily.sunset ? fc.daily.sunset[i] : null,
      };
    });
  }
  return { hours, daily, current: fc.current || null, offset: off, tz: fc.timezone || '' };
}

/**
 * The earliest run of the best available level (Good, else Fair) between 5 AM and 9 PM local time,
 * from now through the next 30 hours. Returns { level, from: hour, to: hour, startTs, endTs } or null.
 */
function bestJogWindow(hours, nowTs) {
  const cand = hours.filter(h => h.ts + 3600000 > nowTs && h.ts < nowTs + 30 * 3600000 && h.hour >= 5 && h.hour <= 20);
  for (const want of ['good', 'fair']) {
    for (let i = 0; i < cand.length; i++) {
      if (cand[i].rating.level !== want) continue;
      let j = i;
      while (j + 1 < cand.length && cand[j + 1].rating.level === want && cand[j + 1].ts === cand[j].ts + 3600000) j++;
      return { level: want, from: cand[i], to: cand[j], startTs: cand[i].ts, endTs: cand[j].ts + 3600000 };
    }
  }
  return null;
}

function weatherText(code) {
  if (code === 0) return ['Clear', 'sun'];
  if (code <= 2) return ['Partly cloudy', 'cloud'];
  if (code === 3) return ['Overcast', 'cloud'];
  if (code === 45 || code === 48) return ['Fog', 'cloud'];
  if (code >= 51 && code <= 57) return ['Drizzle', 'cloudRain'];
  if (code >= 61 && code <= 67) return ['Rain', 'cloudRain'];
  if (code >= 71 && code <= 77) return ['Snow', 'cloud'];
  if (code >= 80 && code <= 82) return ['Showers', 'cloudRain'];
  if (code >= 95) return ['Thunderstorm', 'cloudLightning'];
  return ['Cloudy', 'cloud'];
}

const Weather = {
  data: null,
  fetchedAt: 0,
  loading: false,
  error: '',
  CACHE_KEY: 'planner-weather',

  get place() { return Store.d.settings.weather; },

  init() {
    try {
      const c = JSON.parse(localStorage.getItem(this.CACHE_KEY) || 'null');
      if (c && c.lat === this.place.lat && c.lon === this.place.lon) { this.data = c.data; this.fetchedAt = c.fetchedAt; }
    } catch { /* no cache */ }
    this.refresh(false);
    setInterval(() => this.refresh(false), 10 * 60000);
  },

  async fetchJson(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  },

  /** Refreshes when forced, when there is no data, or when the cache is over 30 minutes old. */
  async refresh(force) {
    const p = this.place;
    if (!p || !p.enabled || p.lat == null) return;
    if (this.loading) return;
    if (!force && this.data && Date.now() - this.fetchedAt < 30 * 60000) return;
    this.loading = true;
    this.error = '';
    renderWeatherCard();
    try {
      const base = { latitude: p.lat, longitude: p.lon, timezone: 'auto', forecast_days: '3' };
      const fcUrl = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
        ...base,
        hourly: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_gusts_10m,uv_index,is_day',
        current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,is_day',
        daily: 'apparent_temperature_max,sunrise,sunset',
      });
      const aqUrl = 'https://air-quality-api.open-meteo.com/v1/air-quality?' + new URLSearchParams({ ...base, hourly: 'us_aqi' });
      const [fc, aq] = await Promise.all([this.fetchJson(fcUrl), this.fetchJson(aqUrl).catch(() => null)]);
      this.data = parseForecast(fc, aq);
      this.fetchedAt = Date.now();
      try { localStorage.setItem(this.CACHE_KEY, JSON.stringify({ lat: p.lat, lon: p.lon, fetchedAt: this.fetchedAt, data: this.data })); } catch { /* full */ }
    } catch (e) {
      this.error = navigator.onLine === false ? 'You are offline.' : 'The weather service did not answer.';
    } finally {
      this.loading = false;
      renderWeatherCard();
      if (App.state.view === 'health') App.renderMain();
      renderHealthCard();
      renderHealthLink();
      scheduleRemindersSoon();
    }
  },

  async search(name) {
    const url = 'https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name, count: '6', language: 'en', format: 'json' });
    const r = await this.fetchJson(url);
    return (r.results || []).map(x => ({ name: x.name, region: x.admin1 || '', country: x.country || '', lat: x.latitude, lon: x.longitude }));
  },

  setPlace(p) {
    Store.d.settings.weather = { ...Store.d.settings.weather, ...p, enabled: true };
    Store.quiet();
    this.data = null;
    this.fetchedAt = 0;
    this.refresh(true);
  },

  /** Highest feels-like temperature for a date, or null without a forecast. */
  maxFeels(date) { return this.data && this.data.daily[date] ? this.data.daily[date].maxFeels : null; },

  /** Rated hours from the current hour onward. */
  upcoming(count) {
    if (!this.data) return [];
    const now = Date.now();
    return this.data.hours.filter(h => h.ts + 3600000 > now).slice(0, count);
  },

  nowHour() { return this.upcoming(1)[0] || null; },
};

// ── Wording ─────────────────────────────────────────────────────────────
const JOG_FIRST = 5;   // the timeline covers waking hours, 5 AM ...
const JOG_LAST = 21;   // ... to 9 PM

/** Date and hour on the forecast's own clock (the location's time zone). */
function jogClock(ts) {
  const off = Weather.data ? Weather.data.offset : -new Date().getTimezoneOffset() * 60000;
  const d = new Date(ts + off);
  return { date: d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()), hour: d.getUTCHours() + d.getUTCMinutes() / 60 };
}
function shortHour(hh) {
  hh = ((hh % 24) + 24) % 24;
  if (!Fmt.h12) return pad2(hh) + ':00';
  return (hh % 12 || 12) + ' ' + (hh < 12 ? 'AM' : 'PM');
}
/** "5–8 AM", "11 AM–2 PM" or "05:00–08:00". `to` is the hour the window ends. */
function hourRange(from, to) {
  if (!Fmt.h12) return `${pad2(from)}:00–${pad2(to % 24)}:00`;
  const ma = from < 12 ? 'AM' : 'PM', mb = (to % 24) < 12 ? 'AM' : 'PM';
  return ma === mb ? `${from % 12 || 12}–${(to % 24) % 12 || 12} ${mb}` : `${shortHour(from)}–${shortHour(to)}`;
}
function jogDayWord(date, nowTs) {
  const diff = diffDays(jogClock(nowTs).date, date);
  return diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : WEEKDAYS[dowOf(date)];
}
const capFirst = s => s.charAt(0).toUpperCase() + s.slice(1);
function jogConditions(hr) {
  const parts = [`feels ${Math.round(hr.feels)}°C`, hr.pop >= 30 ? `${hr.pop}% chance of rain` : 'dry'];
  if (hr.uv >= 6) parts.push(`UV ${Math.round(hr.uv)}`);
  if (hr.aqi != null && hr.aqi > 100) parts.push(`air quality ${hr.aqi}`);
  return capFirst(parts.join(', '));
}
function jogHourTip(x) {
  const why = x.rating.reasons.length ? x.rating.reasons.map(r => r.text).join('. ') : 'Comfortable for a jog';
  return `${shortHour(x.hour)}: ${JOG_LEVELS[x.rating.level].label}\n${Math.round(x.temp)}°C, feels ${Math.round(x.feels)}°C, ${x.humidity}% humidity\nRain ${x.pop}% · UV ${Math.round(x.uv)}${x.aqi != null ? ' · AQI ' + x.aqi : ''}\n${why}`;
}

/** The answer, in one line: when to go. */
function jogSummary(nowTs) {
  const best = bestJogWindow(Weather.data.hours, nowTs);
  if (!best) return { label: 'Best time to jog', hero: 'Nothing good in the next day', sub: 'Too hot or too wet. Do the indoor HIIT instead.', best: null };
  const startsNow = best.startTs <= nowTs;
  const hero = startsNow ? `Now until ${shortHour(best.to.hour + 1)}` : `${hourRange(best.from.hour, best.to.hour + 1)} ${jogDayWord(best.from.date, nowTs)}`;
  const at = startsNow ? (Weather.nowHour() || best.from) : best.from;
  return { label: best.level === 'good' ? 'Best time to jog' : 'Best time to jog (only fair)', hero, sub: jogConditions(at), best };
}

// ── UI ──────────────────────────────────────────────────────────────────
/** A quiet hour-by-hour bar per day (5 AM to 9 PM): deeper green = better for jogging. */
function jogTimeline(nowTs, rows, big) {
  const H = Weather.data.hours;
  const span = JOG_LAST - JOG_FIRST;
  const now = jogClock(nowTs);
  const dates = [...new Set(H.map(x => x.date))];
  const first = dates.findIndex(d => H.some(x => x.date === d && x.hour >= JOG_FIRST && x.hour < JOG_LAST && x.ts + 3600000 > nowTs));
  if (first < 0) return null;
  const best = bestJogWindow(H, nowTs);
  const box = h('div', { class: 'jt' + (big ? ' big' : '') });
  for (const d of dates.slice(first, first + rows)) {
    const bar = h('div', { class: 'jt-bar' });
    for (let hr = JOG_FIRST; hr < JOG_LAST; hr++) {
      const x = H.find(y => y.date === d && y.hour === hr);
      const past = !x || x.ts + 3600000 <= nowTs;
      const tip = x ? jogHourTip(x) : '';
      bar.append(h('i', {
        class: `jt-h q-${x ? x.rating.level : 'none'}${past ? ' past' : ''}`,
        style: { gridColumn: String(hr - JOG_FIRST + 1) }, title: tip, role: 'img', 'aria-label': tip.replace(/\n/g, '. '),
      }));
    }
    if (best && best.from.date === d) {
      bar.append(h('span', { class: 'jt-best', 'aria-hidden': 'true', style: { gridColumn: `${best.from.hour - JOG_FIRST + 1} / ${best.to.hour - JOG_FIRST + 2}` } }));
    }
    if (d === now.date && now.hour >= JOG_FIRST && now.hour <= JOG_LAST) {
      bar.append(h('span', { class: 'jt-now', 'aria-hidden': 'true', style: { left: ((now.hour - JOG_FIRST) / span) * 100 + '%' } }));
    }
    box.append(h('div', { class: 'jt-row' }, h('span', { class: 'jt-day' }, capFirst(jogDayWord(d, nowTs))), bar));
  }
  box.append(h('div', { class: 'jt-row' }, h('span'), h('div', { class: 'jt-axis', 'aria-hidden': 'true' },
    [6, 12, 18].map(hr => h('span', { style: { left: ((hr - JOG_FIRST) / span) * 100 + '%' } }, hr === 12 ? 'Noon' : shortHour(hr))))));
  box.append(h('div', { class: 'jt-row' }, h('span'), h('div', { class: 'jt-key' },
    ['good', 'fair', 'poor'].map(k => h('span', null, h('i', { class: 'jt-h q-' + k }), JOG_LEVELS[k].label)),
    big ? h('span', { class: 'jt-hint' }, 'Hover an hour for details') : null)));
  return box;
}

function weatherNowLine() {
  const c = Weather.data && Weather.data.current;
  if (!c) return null;
  const [text, ic] = weatherText(c.weather_code);
  const cur = Weather.nowHour();
  const lvl = cur ? cur.rating.level : null;
  const why = cur ? cur.rating.reasons.find(r => r.level === lvl) : null;
  return h('div', { class: 'wx-now' },
    h('span', { class: 'wx-line' }, icon(c.is_day === 0 && ic === 'sun' ? 'moon' : ic, 14),
      `${Math.round(c.temperature_2m)}°C, feels ${Math.round(c.apparent_temperature)}°C · ${text.toLowerCase()}`),
    lvl ? h('span', { class: 'wx-verdict' }, `Now: ${JOG_LEVELS[lvl].label.toLowerCase()} for jogging${why ? ` (${why.short})` : ''}`) : null);
}

function jogHeadline(s, big) {
  return h('div', { class: 'jog-head' + (big ? ' big' : '') },
    h('div', { class: 'jog-label' }, s.label),
    h('div', { class: 'jog-hero' }, s.hero),
    h('div', { class: 'jog-sub' }, s.sub));
}

function renderWeatherCard() {
  const card = $('#weatherCard');
  if (!card) return;
  const p = Weather.place;
  const collapsed = (Store.d.settings.collapsedCards || []).includes('weather');
  const head = collapsibleHead('weather', 'Jogging weather', collapsed,
    h('button', { class: 'wx-place', title: 'Change location', onclick: () => openWeatherPlace() }, icon('pin', 13), p && p.name ? p.name : 'Set location'),
    h('button', { class: 'icon-btn xs', title: 'Refresh', onclick: () => Weather.refresh(true) }, icon('refresh', 13, Weather.loading ? 'spin' : '')));
  if (collapsed) {
    if (Weather.data) {
      const s = jogSummary(Date.now());
      head.querySelector('.study-toggle').append(h('span', { class: 'study-sum' }, s.best ? s.hero : 'No good time soon'));
    }
    fill(card, head);
    return;
  }
  if (!p || !p.enabled || p.lat == null) {
    fill(card, head, h('p', { class: 'study-empty' }, 'Set your city to see when it is good to jog.'));
    return;
  }
  if (!Weather.data) {
    fill(card, head, h('p', { class: 'study-empty' }, Weather.loading ? 'Loading the forecast…' : (Weather.error || 'No forecast yet.')));
    return;
  }
  const now = Date.now();
  fill(card, head,
    jogHeadline(jogSummary(now)),
    jogTimeline(now, 2, false),
    weatherNowLine(),
    Weather.error ? h('p', { class: 'muted small' }, `${Weather.error} Showing the last forecast.`) : null);
}

/** The bigger weather block on the Health page. */
function weatherSection() {
  const p = Weather.place;
  const head = h('div', { class: 'hv-sec-h' },
    h('h2', null, icon('sun', 18), 'Jogging weather'),
    h('div', { class: 'hv-sec-tools' },
      h('button', { class: 'btn sm', onclick: () => openWeatherPlace() }, icon('pin', 13), p && p.name ? `${p.name}${p.country ? ', ' + p.country : ''}` : 'Set location'),
      h('button', { class: 'btn sm ghost', onclick: () => Weather.refresh(true) }, icon('refresh', 13), 'Refresh')));
  const sec = h('section', { class: 'hv-sec', id: 'hv-weather' }, head);
  if (!Weather.data) {
    const noPlace = !p || p.lat == null;
    sec.append(h('p', { class: 'muted' }, noPlace ? 'Set your city to see when it is good to jog.'
      : Weather.loading ? 'Loading the forecast…' : (Weather.error || 'No forecast yet.')));
    return sec;
  }
  const now = Date.now();
  sec.append(
    jogHeadline(jogSummary(now), true),
    jogTimeline(now, 3, true),
    weatherNowLine(),
    h('p', { class: 'muted small' }, 'Each hour is rated from feels-like temperature (heat and humidity), rain and storms, UV, wind gusts and air quality. Forecast by Open-Meteo.'));
  return sec;
}

function openWeatherPlace() {
  const input = h('input', { class: 'input', placeholder: 'Your city', value: '' });
  const list = h('div', { class: 'wx-results' });
  const status = h('p', { class: 'muted small' }, 'Only the city’s coordinates are sent to the weather service.');
  let timer = 0;
  const run = async () => {
    const q = input.value.trim();
    if (q.length < 2) { list.replaceChildren(); return; }
    status.textContent = 'Searching…';
    try {
      const results = await Weather.search(q);
      status.textContent = results.length ? '' : 'No places found.';
      fill(list, results.map(r => h('button', {
        class: 'wx-result', onclick: () => { m.close(); Weather.setPlace(r); renderWeatherCard(); },
      }, icon('pin', 14), h('span', null, h('b', null, r.name), [r.region, r.country].filter(Boolean).length ? ' · ' + [r.region, r.country].filter(Boolean).join(', ') : ''))));
    } catch {
      status.textContent = 'The search service did not answer. Check your connection.';
    }
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 300); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(timer); run(); } });
  const m = openModal({ title: 'Weather location', className: 'small', body: h('div', { class: 'wx-search' }, input, status, list) });
}
