/* ==========================================================================
   SkyCast - front-end logic (no external libraries)

   Sections:
     1. Storage + settings (theme, units)         6. Home page (search, load, render)
     2. Icons                                      7. Weather background effects
     3. Formatting helpers                         8. Favorites page
     4. Toasts + small DOM helpers                 9. Boot (service worker, install)
     5. Networking
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ 1. Storage + settings */
  const KEYS = {
    settings: 'skycast.settings',
    recent: 'skycast.recent',
    favs: 'skycast.favorites',
    last: 'skycast.lastCity',
    cache: 'skycast.lastWeather'
  };
  const REFRESH_MS = 10 * 60 * 1000; // automatic refresh every 10 minutes
  const MAX_RECENT = 6;
  const MAX_FAVS = 12;
  const NETWORK_CODES = new Set([
    'network', 'offline', 'timeout', 'upstream_timeout', 'upstream_unreachable', 'upstream_error', 'upstream_busy'
  ]);

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
  }

  const settings = Object.assign({ theme: 'dark', units: 'metric' }, load(KEYS.settings, {}));
  if (settings.theme !== 'light' && settings.theme !== 'dark') settings.theme = 'dark';
  if (settings.units !== 'metric' && settings.units !== 'imperial') settings.units = 'metric';

  function applySettings() {
    const root = document.documentElement;
    root.setAttribute('data-theme', settings.theme);
    root.setAttribute('data-units', settings.units);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', settings.theme === 'dark' ? '#0a1a3a' : '#dbeafe');
  }
  applySettings(); // runs while the page is loading, so there is no flash of the wrong theme

  /* ------------------------------------------------------------------ 2. Icons */
  const UI = {
    search: '<circle cx="11" cy="11" r="7.5"/><path d="M21 21l-4.6-4.6"/>',
    locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    refresh: '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    sun: '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    thermometer: '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>',
    droplet: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
    wind: '<path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>',
    compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    arrow: '<polygon points="12 3 18 20 12 16.5 6 20 12 3"/>',
    gauge: '<path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
    umbrella: '<path d="M23 12a11.05 11.05 0 0 0-22 0zm-5 7a3 3 0 0 1-6 0v-7"/>',
    sunrise: '<path d="M17 18a5 5 0 0 0-10 0M12 2v7M4.22 10.22l1.42 1.42M1 18h2M21 18h2M18.36 11.64l1.42-1.42M23 22H1M8 6l4-4 4 4"/>',
    sunset: '<path d="M17 18a5 5 0 0 0-10 0M12 9v9M4.22 10.22l1.42 1.42M1 18h2M21 18h2M18.36 11.64l1.42-1.42M23 22H1M16 5l-4 4-4-4"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    'arrow-up': '<path d="M12 19V5M5 12l7-7 7 7"/>',
    'arrow-down': '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>'
  };

  function ui(name) {
    return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (UI[name] || '') + '</svg>';
  }

  // Weather illustrations (64x64). Colours come from CSS classes so both themes look right.
  const CLOUD_D = 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z';
  function cloudG(x, y, s, cls) {
    return '<g' + (cls ? ' class="' + cls + '"' : '') + ' transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' +
      '<path class="i-cloud" d="' + CLOUD_D + '"/></g>';
  }
  function moonPath(x, y, s) {
    return '<path class="i-moon" transform="translate(' + x + ' ' + y + ') scale(' + s + ')" ' +
      'd="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  }
  function sunShape(cx, cy, r, r1, r2) {
    let rays = '';
    for (let a = 0; a < 360; a += 45) {
      const rad = a * Math.PI / 180;
      rays += '<line x1="' + (cx + Math.cos(rad) * r1).toFixed(1) + '" y1="' + (cy + Math.sin(rad) * r1).toFixed(1) +
        '" x2="' + (cx + Math.cos(rad) * r2).toFixed(1) + '" y2="' + (cy + Math.sin(rad) * r2).toFixed(1) + '"/>';
    }
    return '<g class="i-ray">' + rays + '</g><circle class="i-sun" cx="' + cx + '" cy="' + cy + '" r="' + r + '"/>';
  }
  const STARS = '<circle class="i-star" cx="48" cy="15" r="1.8"/><circle class="i-star" cx="54" cy="29" r="1.4"/>' +
    '<circle class="i-star" cx="17" cy="14" r="1.5"/><circle class="i-star" cx="50" cy="46" r="1.2"/>';
  const line = (x1, y1, x2, y2, cls) => '<line class="' + cls + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>';

  function wicon(icon, isDay) {
    const day = isDay !== false && isDay !== 0;
    let inner;
    switch (icon) {
      case 'clear':
        inner = day ? sunShape(32, 32, 12, 18, 27) : moonPath(12.8, 12.8, 1.6) + STARS;
        break;
      case 'partly':
        inner = (day ? sunShape(24, 24, 9, 13.5, 20) : moonPath(2, 0, 1.25)) + cloudG(10, 22, 2);
        break;
      case 'fog':
        inner = cloudG(10, 2, 2) + line(14, 48, 50, 48, 'i-fogl') + line(20, 54.5, 54, 54.5, 'i-fogl') + line(12, 61, 44, 61, 'i-fogl');
        break;
      case 'drizzle':
        inner = cloudG(10, 2, 2) + line(22, 48, 20, 53, 'i-rain') + line(32, 50, 30, 55, 'i-rain') +
          line(42, 48, 40, 53, 'i-rain') + line(27, 58, 25, 62, 'i-rain');
        break;
      case 'rain':
        inner = cloudG(10, 2, 2) + line(22, 47, 18, 58, 'i-rain') + line(32, 47, 28, 58, 'i-rain') + line(42, 47, 38, 58, 'i-rain');
        break;
      case 'snow':
        inner = cloudG(10, 2, 2) + '<circle class="i-snow" cx="22" cy="50" r="2.9"/><circle class="i-snow" cx="32" cy="57" r="2.9"/>' +
          '<circle class="i-snow" cx="42" cy="50" r="2.9"/>';
        break;
      case 'thunder':
        inner = cloudG(10, 0, 2, 'i-storm') + '<polygon class="i-bolt" points="35,36 25,52 32,52 28,63 42,45 34,45 39,36"/>';
        break;
      case 'cloudy':
      default:
        inner = cloudG(24, 6, 1.5, 'i-cloud2') + cloudG(6, 20, 2);
    }
    return '<svg class="wicon" viewBox="0 0 64 64" aria-hidden="true">' + inner + '</svg>';
  }

  // Fill <i data-icon="x"> and <span data-wicon="partly-day"> placeholders from the templates.
  function hydrate(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(function (el) {
      let name = el.getAttribute('data-icon');
      if (name === 'theme') name = settings.theme === 'dark' ? 'sun' : 'moon';
      el.innerHTML = ui(name);
    });
    (root || document).querySelectorAll('[data-wicon]').forEach(function (el) {
      const name = el.getAttribute('data-wicon');
      const m = /^(clear|partly)-(day|night)$/.exec(name);
      el.innerHTML = m ? wicon(m[1], m[2] === 'day') : wicon(name, true);
    });
  }

  /* ------------------------------------------------------------------ 3. Formatting helpers */
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const imperial = () => settings.units === 'imperial';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtTemp = (c) => isNum(c) ? Math.round(imperial() ? c * 9 / 5 + 32 : c) + '°' : '–';
  const tempUnit = () => imperial() ? '°F' : '°C';
  function fmtWind(kmh) {
    if (!isNum(kmh)) return { v: '–', u: '' };
    return imperial() ? { v: Math.round(kmh * 0.621371), u: 'mph' } : { v: Math.round(kmh), u: 'km/h' };
  }
  function fmtPressure(hpa) {
    if (!isNum(hpa)) return { v: '–', u: '' };
    return imperial() ? { v: (hpa * 0.02953).toFixed(2), u: 'inHg' } : { v: Math.round(hpa), u: 'hPa' };
  }
  function fmtPrecip(mm) {
    if (!isNum(mm)) return '–';
    return imperial() ? (mm / 25.4).toFixed(2) + ' in' : mm.toFixed(1) + ' mm';
  }
  const fmtPct = (v) => isNum(v) ? Math.round(v) + '%' : '–';
  const fmtUv = (v) => isNum(v) ? String(Math.round(v * 10) / 10) : '–';

  const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = (deg) => isNum(deg) ? DIRS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16] : '–';

  function uvWord(v) {
    if (!isNum(v)) return '';
    return v < 3 ? 'Low' : v < 6 ? 'Moderate' : v < 8 ? 'High' : v < 11 ? 'Very high' : 'Extreme';
  }
  function windWord(k) {
    if (!isNum(k)) return '';
    return k < 2 ? 'Calm' : k < 20 ? 'Light breeze' : k < 39 ? 'Moderate breeze' : k < 62 ? 'Strong breeze' : k < 88 ? 'Gale' : 'Storm';
  }
  function humidityWord(h) {
    if (!isNum(h)) return '';
    return h < 30 ? 'Dry' : h <= 60 ? 'Comfortable' : h <= 75 ? 'Humid' : 'Very humid';
  }
  function pressureWord(p) {
    if (!isNum(p)) return '';
    return p < 1009 ? 'Low' : p <= 1022 ? 'Normal' : 'High';
  }
  function cloudWord(c) {
    if (!isNum(c)) return '';
    return c < 10 ? 'Clear' : c < 35 ? 'Mostly clear' : c < 65 ? 'Partly cloudy' : c < 90 ? 'Mostly cloudy' : 'Overcast';
  }
  function feelsWord(feels, actual) {
    if (!isNum(feels) || !isNum(actual)) return '';
    const d = feels - actual;
    return Math.abs(d) < 1.5 ? 'Similar to actual' : d > 0 ? 'Feels warmer' : 'Feels cooler';
  }

  // Times from Open-Meteo are already local to the city ("2026-11-24T06:31"), so they are read as-is.
  function parseLocal(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(str || '');
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0))) : null;
  }
  function fmtClock(str) {
    const d = parseLocal(str);
    return d ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) : '–';
  }
  function fmtHour(str) {
    const d = parseLocal(str);
    return d ? d.toLocaleTimeString(undefined, { hour: 'numeric', timeZone: 'UTC' }) : '';
  }
  function fmtDayName(str, i) {
    if (i === 0) return 'Today';
    const d = parseLocal(str);
    return d ? d.toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' }) : '';
  }
  function fmtShortDate(str) {
    const d = parseLocal(str);
    return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
  }
  function daylight(sunrise, sunset) {
    const a = parseLocal(sunrise), b = parseLocal(sunset);
    if (!a || !b || b <= a) return '';
    const mins = Math.round((b - a) / 60000);
    return 'Daylight ' + Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
  }

  /* ------------------------------------------------------------------ 4. Toasts + DOM helpers */
  const $ = (id) => document.getElementById(id);
  const page = () => document.body.getAttribute('data-page');

  function toast(message, type, ms) {
    const box = $('toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    const text = document.createElement('span');
    text.textContent = message;
    el.appendChild(text);
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 300);
    }, ms || 4500);
  }

  /* ------------------------------------------------------------------ 5. Networking */
  function makeError(message, code) {
    const err = new Error(message);
    err.code = code;
    return err;
  }

  async function fetchJSON(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 15000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      let body = null;
      try { body = await res.json(); } catch (e) { /* not JSON */ }
      if (!res.ok || !body || body.ok === false) {
        const e = body && body.error;
        throw makeError(e ? e.message : 'Server error (' + res.status + ').', e ? e.code : 'http_' + res.status);
      }
      return body.data;
    } catch (e) {
      if (e && e.name === 'AbortError') throw makeError('The request took too long. Please try again.', 'timeout');
      if (e instanceof TypeError) throw makeError('You appear to be offline or the server cannot be reached.', 'network');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ------------------------------------------------------------------ Shared city helpers */
  const cityKey = (c) => Number(c.lat).toFixed(2) + ',' + Number(c.lon).toFixed(2);
  const sameCity = (a, b) => !!a && !!b && Math.abs(a.lat - b.lat) < 0.0005 && Math.abs(a.lon - b.lon) < 0.0005;
  const cityRegion = (c) => [c.admin1 && c.admin1 !== c.name ? c.admin1 : '', c.country].filter(Boolean).join(', ');
  const getFavs = () => (load(KEYS.favs, []) || []).filter((c) => c && isNum(c.lat) && isNum(c.lon));
  const isFav = (c) => getFavs().some((f) => cityKey(f) === cityKey(c));

  function toggleFav(city) {
    let favs = getFavs();
    if (isFav(city)) {
      favs = favs.filter((f) => cityKey(f) !== cityKey(city));
      save(KEYS.favs, favs);
      toast(city.name + ' removed from favorites.', 'info', 2500);
      return false;
    }
    if (favs.length >= MAX_FAVS) {
      toast('You can save up to ' + MAX_FAVS + ' favorite cities. Remove one first.', 'warn');
      return isFav(city);
    }
    favs.unshift({ name: city.name, admin1: city.admin1 || '', country: city.country || '', lat: city.lat, lon: city.lon, isCurrent: !!city.isCurrent });
    save(KEYS.favs, favs);
    toast(city.name + ' added to favorites.', 'success', 2500);
    return true;
  }

  /* ------------------------------------------------------------------ 6. Home page */
  const state = {
    city: null,        // the city being shown / loaded
    dataCity: null,    // the city that `data` belongs to
    data: null,
    fetchedAt: 0,
    stale: false,
    inflight: false
  };
  let reqSeq = 0;

  function showState(name) {
    ['state-welcome', 'state-loading', 'state-error', 'dashboard'].forEach(function (id) {
      const el = $(id);
      if (el) el.hidden = id !== (name === 'dashboard' ? 'dashboard' : 'state-' + name);
    });
  }

  function showError(message) {
    $('error-message').textContent = message;
    showState('error');
  }

  function setRefreshing(on) {
    const b = $('btn-refresh');
    if (b) b.classList.toggle('spinning', on);
  }

  async function loadCity(city, opts) {
    opts = opts || {};
    const seq = ++reqSeq;
    state.city = city;
    state.inflight = true;
    save(KEYS.last, city);
    if (opts.silent) setRefreshing(true); else showState('loading');

    try {
      const url = '/api/weather?lat=' + encodeURIComponent(city.lat) + '&lon=' + encodeURIComponent(city.lon) + (opts.fresh ? '&fresh=1' : '');
      const data = await fetchJSON(url);
      if (seq !== reqSeq) return;
      state.data = data;
      state.dataCity = city;
      state.fetchedAt = Date.now();
      state.stale = false;
      save(KEYS.cache, { city: city, data: data, fetchedAt: state.fetchedAt });
      if (opts.remember) addRecent(city);
      renderAll();
      showState('dashboard');
    } catch (err) {
      if (seq !== reqSeq) return;
      const net = NETWORK_CODES.has(err.code);
      const cached = load(KEYS.cache, null);

      if (state.data && sameCity(state.dataCity, city)) {
        // We already show this city: keep it on screen and say it may be out of date.
        state.stale = net;
        renderAll();
        showState('dashboard');
        toast(err.message, net ? 'warn' : 'error');
      } else if (net && cached && cached.data && sameCity(cached.city, city)) {
        state.data = cached.data;
        state.dataCity = city;
        state.fetchedAt = cached.fetchedAt;
        state.stale = true;
        renderAll();
        showState('dashboard');
        toast('No connection - showing the last saved weather.', 'warn');
      } else {
        showError(err.message);
      }
    } finally {
      if (seq === reqSeq) {
        state.inflight = false;
        setRefreshing(false);
      }
    }
  }

  function refresh(manual) {
    if (!state.city) return;
    if (manual) toast('Refreshing…', 'info', 1200);
    loadCity(state.city, { silent: !!state.data, fresh: true });
  }

  function renderAll() {
    const d = state.data, city = state.dataCity || state.city;
    if (!d || !city) return;
    renderHero(d, city);
    renderTiles(d);
    renderHourly(d);
    renderDaily(d);
    renderMeta();
    updateFavButton();
    setSky(d.current.icon, d.current.is_day !== 0);
  }

  function renderHero(d, city) {
    const c = d.current;
    $('hero-city').textContent = city.name || 'Unknown place';
    $('hero-region').textContent = city.isCurrent ? ((d.location.timezone || '').replace(/_/g, ' ')) : cityRegion(city);
    $('hero-temp').textContent = isNum(c.temperature) ? String(Math.round(imperial() ? c.temperature * 9 / 5 + 32 : c.temperature)) : '--';
    $('hero-unit').textContent = tempUnit();
    $('hero-cond').textContent = c.label || '';
    $('hero-feels').textContent = 'Feels like ' + fmtTemp(c.feels_like) + tempUnit().slice(1);
    $('hero-high').textContent = fmtTemp(c.temp_max);
    $('hero-low').textContent = fmtTemp(c.temp_min);
    $('hero-icon').innerHTML = wicon(c.icon, c.is_day !== 0);
    tickClock();
  }

  function tickClock() {
    if (!state.data || page() !== 'home') return;
    const t = new Date(Date.now() + (state.data.location.utc_offset_seconds || 0) * 1000);
    $('hero-date').textContent = t.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
    $('hero-time').textContent = t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  }

  function tile(i, icon, label, value, unit, sub, extra) {
    return '<div class="tile" style="--i:' + i + '"><div class="tile-head">' + ui(icon) + '<span>' + esc(label) + '</span></div>' +
      '<div class="tile-value">' + esc(value) + (unit ? '<small>' + esc(unit) + '</small>' : '') + (extra || '') + '</div>' +
      '<div class="tile-sub">' + esc(sub || ' ') + '</div></div>';
  }

  function renderTiles(d) {
    const c = d.current, today = d.daily[0] || {};
    const w = fmtWind(c.wind_speed), p = fmtPressure(c.pressure);
    const arrow = isNum(c.wind_direction)
      ? ' <span class="tile-arrow" style="transform:rotate(' + Math.round(c.wind_direction + 180) + 'deg)">' + ui('arrow') + '</span>'
      : '';
    const rainBits = [];
    if (isNum(today.precip_sum)) rainBits.push('Today ' + fmtPrecip(today.precip_sum));
    if (isNum(today.precip_prob)) rainBits.push(Math.round(today.precip_prob) + '% chance');

    const tiles = [
      tile(0, 'thermometer', 'Temperature', fmtTemp(c.temperature).replace('°', ''), tempUnit(), c.label),
      tile(1, 'thermometer', 'Feels like', fmtTemp(c.feels_like).replace('°', ''), tempUnit(), feelsWord(c.feels_like, c.temperature)),
      tile(2, 'droplet', 'Humidity', fmtPct(c.humidity), '', humidityWord(c.humidity)),
      tile(3, 'wind', 'Wind speed', w.v, w.u, windWord(c.wind_speed)),
      tile(4, 'compass', 'Wind direction', compass(c.wind_direction), isNum(c.wind_direction) ? Math.round(c.wind_direction) + '°' : '', 'Blowing from ' + compass(c.wind_direction), arrow),
      tile(5, 'gauge', 'Pressure', p.v, p.u, pressureWord(c.pressure)),
      tile(6, 'cloud', 'Cloud cover', fmtPct(c.cloud_cover), '', cloudWord(c.cloud_cover)),
      tile(7, 'umbrella', 'Precipitation', fmtPrecip(c.precipitation), '', rainBits.join(' · ') || 'Right now'),
      tile(8, 'sun', 'UV index', fmtUv(c.uv_index), '', uvWord(c.uv_index)),
      tile(9, 'sunrise', 'Sunrise', fmtClock(c.sunrise), '', 'Today'),
      tile(10, 'sunset', 'Sunset', fmtClock(c.sunset), '', daylight(c.sunrise, c.sunset))
    ];
    $('tiles').innerHTML = tiles.join('');
  }

  function renderHourly(d) {
    $('hourly').innerHTML = d.hourly.map(function (h, i) {
      return '<li class="hour"><span class="h-time">' + (i === 0 ? 'Now' : esc(fmtHour(h.time))) + '</span>' +
        '<span class="hi" title="' + esc(h.label) + '">' + wicon(h.icon, h.is_day !== 0) + '</span>' +
        '<span class="h-temp">' + fmtTemp(h.temp) + '</span>' +
        '<span class="h-pop">' + ui('droplet') + fmtPct(h.precip_prob) + '</span></li>';
    }).join('');
    $('hourly').scrollLeft = 0;
  }

  function renderDaily(d) {
    const mins = d.daily.map((x) => x.temp_min).filter(isNum);
    const maxs = d.daily.map((x) => x.temp_max).filter(isNum);
    const lo = mins.length ? Math.min.apply(null, mins) : 0;
    const hi = maxs.length ? Math.max.apply(null, maxs) : 1;
    const span = hi - lo || 1;

    $('daily').innerHTML = d.daily.map(function (day, i) {
      let left = 0, width = 100;
      if (isNum(day.temp_min) && isNum(day.temp_max)) {
        left = ((day.temp_min - lo) / span) * 100;
        width = Math.max(((day.temp_max - day.temp_min) / span) * 100, 8);
        if (left + width > 100) left = 100 - width;
      }
      const extra = ['UV ' + fmtUv(day.uv_max)];
      return '<li class="day"><div class="d-name"><strong>' + esc(fmtDayName(day.date, i)) + '</strong><small>' + esc(fmtShortDate(day.date)) + '</small></div>' +
        '<span class="di">' + wicon(day.icon, true) + '</span>' +
        '<div class="d-cond">' + esc(day.label) + '<small>' + esc(extra.join(' · ')) + '</small></div>' +
        '<div class="d-range"><span class="lo">' + fmtTemp(day.temp_min) + '</span>' +
        '<span class="bar"><i style="left:' + left.toFixed(1) + '%;width:' + width.toFixed(1) + '%"></i></span>' +
        '<span class="hi">' + fmtTemp(day.temp_max) + '</span></div></li>';
    }).join('');
  }

  function renderMeta() {
    const when = new Date(state.fetchedAt);
    const sameDay = when.toDateString() === new Date().toDateString();
    const text = sameDay
      ? when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : when.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    $('updated').textContent = 'Updated ' + text + ' · refreshes automatically every 10 minutes';

    const notice = $('notice');
    notice.hidden = !state.stale;
    if (state.stale) notice.textContent = 'You’re offline or the weather service can’t be reached. Showing the data saved at ' + text + '.';
  }

  function updateFavButton() {
    const b = $('btn-fav');
    if (!b || !state.city) return;
    const on = isFav(state.dataCity || state.city);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', on ? 'Remove from favorites' : 'Add to favorites');
    b.title = on ? 'Remove from favorites' : 'Add to favorites';
  }

  /* ---- Recent searches ---- */
  function addRecent(city) {
    let list = (load(KEYS.recent, []) || []).filter((c) => c && isNum(c.lat) && isNum(c.lon) && cityKey(c) !== cityKey(city));
    if (city.isCurrent) return;
    list.unshift({ name: city.name, admin1: city.admin1 || '', country: city.country || '', lat: city.lat, lon: city.lon });
    save(KEYS.recent, list.slice(0, MAX_RECENT));
    renderRecent();
  }

  function renderRecent() {
    const wrap = $('recent');
    if (!wrap) return;
    const list = (load(KEYS.recent, []) || []).filter((c) => c && isNum(c.lat) && isNum(c.lon));
    wrap.hidden = list.length === 0;
    $('recent-chips').innerHTML = list.map(function (c, i) {
      return '<button type="button" class="chip" data-i="' + i + '" title="' + esc(cityRegion(c)) + '">' + esc(c.name) + '</button>';
    }).join('') + '<button type="button" class="chip clear" data-clear="1">Clear</button>';
  }

  /* ---- Search + suggestions ---- */
  let suggTimer = null, suggSeq = 0, suggList = [], suggActive = -1;

  function hideSuggestions() {
    const ul = $('suggestions');
    ul.hidden = true;
    ul.innerHTML = '';
    suggList = [];
    suggActive = -1;
    $('search-input').setAttribute('aria-expanded', 'false');
  }

  function showSuggestions(results, query, message) {
    const ul = $('suggestions');
    suggList = results || [];
    suggActive = -1;
    if (suggList.length) {
      ul.innerHTML = suggList.map(function (r, i) {
        const sub = [r.admin1 && r.admin1 !== r.name ? r.admin1 : '', r.country].filter(Boolean).join(', ');
        return '<li role="option"><button type="button" class="sugg" data-i="' + i + '">' + ui('pin') +
          '<span><strong>' + esc(r.name) + '</strong><small>' + esc(sub) + '</small></span></button></li>';
      }).join('');
    } else {
      ul.innerHTML = '<li class="sugg-empty">' + esc(message || 'No city found for “' + query + '”. Check the spelling or try a nearby larger city.') + '</li>';
    }
    ul.hidden = false;
    $('search-input').setAttribute('aria-expanded', 'true');
  }

  function setActiveSuggestion(i) {
    const items = $('suggestions').querySelectorAll('.sugg');
    if (!items.length) return;
    suggActive = (i + items.length) % items.length;
    items.forEach(function (el, idx) { el.classList.toggle('active', idx === suggActive); });
    items[suggActive].scrollIntoView({ block: 'nearest' });
  }

  async function fetchSuggestions(q) {
    const seq = ++suggSeq;
    try {
      const data = await fetchJSON('/api/search?q=' + encodeURIComponent(q));
      if (seq === suggSeq) showSuggestions(data.results, q);
    } catch (err) {
      if (seq === suggSeq) showSuggestions([], q, err.message);
    }
  }

  function pickResult(r) {
    hideSuggestions();
    $('search-input').value = '';
    $('search-input').blur();
    loadCity({ name: r.name, admin1: r.admin1 || '', country: r.country || '', lat: r.latitude, lon: r.longitude }, { remember: true });
  }

  async function submitSearch(e) {
    e.preventDefault();
    const input = $('search-input');
    const q = input.value.trim();
    if (suggActive >= 0 && suggList[suggActive]) return pickResult(suggList[suggActive]);
    if (q.length < 2) {
      toast('Type at least 2 letters of a city name.', 'warn');
      input.focus();
      return;
    }
    clearTimeout(suggTimer);
    const btn = $('btn-search');
    btn.disabled = true;
    try {
      const data = await fetchJSON('/api/search?q=' + encodeURIComponent(q));
      if (!data.results.length) {
        showSuggestions([], q);
        toast('No city found for “' + q + '”. Check the spelling.', 'error');
      } else {
        pickResult(data.results[0]);
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  /* ---- Current location ---- */
  function locate() {
    if (!('geolocation' in navigator)) {
      toast('This browser does not support location.', 'error');
      return;
    }
    const b = $('btn-locate');
    b.classList.add('spinning');
    toast('Asking for your location…', 'info', 2000);
    navigator.geolocation.getCurrentPosition(function (pos) {
      b.classList.remove('spinning');
      loadCity({
        name: 'Current location', admin1: '', country: '',
        lat: Number(pos.coords.latitude.toFixed(4)), lon: Number(pos.coords.longitude.toFixed(4)), isCurrent: true
      });
    }, function (err) {
      b.classList.remove('spinning');
      if (!window.isSecureContext) {
        toast('Location only works on HTTPS or http://localhost. Search for a city instead.', 'error', 6500);
      } else if (err.code === 1) {
        toast('Location permission was denied. Allow it in your browser’s site settings, or search for a city.', 'error', 6500);
      } else if (err.code === 3) {
        toast('Finding your location took too long. Please try again.', 'error');
      } else {
        toast('Your location is not available right now. Search for a city instead.', 'error');
      }
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60 * 1000 });
  }

  function initHome() {
    $('search-form').addEventListener('submit', submitSearch);
    const input = $('search-input');
    input.addEventListener('input', function () {
      const q = input.value.trim();
      clearTimeout(suggTimer);
      if (q.length < 2) { hideSuggestions(); return; }
      suggTimer = setTimeout(function () { fetchSuggestions(q); }, 300);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSuggestion(suggActive + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSuggestion(suggActive - 1); }
      else if (e.key === 'Escape') { hideSuggestions(); }
    });
    $('suggestions').addEventListener('click', function (e) {
      const btn = e.target.closest('.sugg');
      if (btn && suggList[+btn.getAttribute('data-i')]) pickResult(suggList[+btn.getAttribute('data-i')]);
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.search-wrap')) hideSuggestions();
    });

    $('recent-chips').addEventListener('click', function (e) {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      if (chip.hasAttribute('data-clear')) {
        save(KEYS.recent, []);
        renderRecent();
        return;
      }
      const list = load(KEYS.recent, []) || [];
      const c = list[+chip.getAttribute('data-i')];
      if (c) loadCity(c, { remember: true });
    });

    $('btn-locate').addEventListener('click', locate);
    $('btn-locate-welcome').addEventListener('click', locate);
    $('btn-refresh').addEventListener('click', function () { refresh(true); });
    $('btn-retry').addEventListener('click', function () { if (state.city) loadCity(state.city, { fresh: true }); });
    $('btn-focus-search').addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); input.focus(); });
    $('btn-fav').addEventListener('click', function () {
      const city = state.dataCity || state.city;
      if (!city) return;
      toggleFav(city);
      updateFavButton();
    });

    renderRecent();

    // Automatic refresh: every minute check whether the data is older than 10 minutes.
    function autoRefresh() {
      if (document.visibilityState !== 'visible' || !state.city || !state.data || state.inflight) return;
      if (Date.now() - state.fetchedAt >= REFRESH_MS) loadCity(state.city, { silent: true, fresh: true });
    }
    setInterval(autoRefresh, 60 * 1000);
    document.addEventListener('visibilitychange', autoRefresh);
    window.addEventListener('online', function () {
      if (state.city && !state.inflight && (state.stale || !state.data)) loadCity(state.city, { silent: !!state.data, fresh: true });
    });
    window.addEventListener('offline', function () { toast('You are offline. Saved data will be shown if available.', 'warn'); });
    setInterval(tickClock, 15 * 1000);

    // Start up: show the last city (saved copy first for speed, then a fresh fetch).
    const last = load(KEYS.last, null);
    if (last && isNum(last.lat) && isNum(last.lon)) {
      const cached = load(KEYS.cache, null);
      if (cached && cached.data && cached.data.current && sameCity(cached.city, last)) {
        state.city = last;
        state.data = cached.data;
        state.dataCity = last;
        state.fetchedAt = cached.fetchedAt || Date.now();
        renderAll();
        showState('dashboard');
        loadCity(last, { silent: true, fresh: true });
      } else {
        loadCity(last);
      }
    } else {
      showState('welcome');
    }
  }

  /* ------------------------------------------------------------------ 7. Weather background effects */
  function setSky(icon, isDay) {
    let sky = icon;
    if (icon === 'clear') sky = isDay ? 'clear-day' : 'clear-night';
    else if (icon === 'partly') sky = isDay ? 'partly-day' : 'partly-night';
    document.body.setAttribute('data-sky', sky);
    buildFx(sky);
  }

  function buildFx(sky) {
    const fx = $('fx');
    if (!fx || fx.getAttribute('data-sky') === sky) return;
    fx.setAttribute('data-sky', sky);
    fx.innerHTML = '';
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const frag = document.createDocumentFragment();
    const rnd = (a, b) => a + Math.random() * (b - a);
    function add(cls, style) {
      const el = document.createElement('i');
      el.className = cls;
      el.style.cssText = style;
      frag.appendChild(el);
    }
    const clouds = (n) => { for (let i = 0; i < n; i++) add('fx-cloud', 'top:' + rnd(2, 55).toFixed(0) + '%;transform:scale(' + rnd(.8, 1.7).toFixed(2) + ');animation-duration:' + rnd(70, 130).toFixed(0) + 's;animation-delay:-' + rnd(0, 120).toFixed(0) + 's'); };
    const stars = (n) => { for (let i = 0; i < n; i++) { const s = rnd(1.5, 3.2).toFixed(1); add('fx-star', 'left:' + rnd(0, 100).toFixed(1) + '%;top:' + rnd(0, 70).toFixed(1) + '%;width:' + s + 'px;height:' + s + 'px;animation-duration:' + rnd(2.5, 6).toFixed(1) + 's;animation-delay:-' + rnd(0, 6).toFixed(1) + 's'); } };

    switch (sky) {
      case 'rain':
      case 'thunder':
        for (let i = 0; i < 70; i++) add('fx-drop', 'left:' + rnd(0, 110).toFixed(1) + '%;animation-duration:' + rnd(.55, .95).toFixed(2) + 's;animation-delay:-' + rnd(0, 2).toFixed(2) + 's;opacity:' + rnd(.25, .6).toFixed(2));
        if (sky === 'thunder') add('fx-flash', '');
        break;
      case 'drizzle':
        for (let i = 0; i < 45; i++) add('fx-drop thin', 'left:' + rnd(0, 110).toFixed(1) + '%;animation-duration:' + rnd(.9, 1.4).toFixed(2) + 's;animation-delay:-' + rnd(0, 2).toFixed(2) + 's;opacity:' + rnd(.25, .5).toFixed(2));
        break;
      case 'snow':
        for (let i = 0; i < 55; i++) { const s = rnd(3, 7).toFixed(1); add('fx-flake', 'left:' + rnd(0, 100).toFixed(1) + '%;width:' + s + 'px;height:' + s + 'px;animation-duration:' + rnd(7, 13).toFixed(1) + 's;animation-delay:-' + rnd(0, 12).toFixed(1) + 's'); }
        break;
      case 'clear-night': stars(48); break;
      case 'partly-night': stars(26); clouds(3); break;
      case 'clear-day': add('fx-sun', ''); break;
      case 'partly-day': add('fx-sun', ''); clouds(3); break;
      case 'cloudy': clouds(5); break;
      case 'fog':
        for (let i = 0; i < 3; i++) add('fx-fog', 'top:' + (15 + i * 28) + '%;animation-duration:' + (9 + i * 3) + 's');
        break;
      default: break;
    }
    fx.appendChild(frag);
  }

  /* ------------------------------------------------------------------ 8. Favorites page */
  const favData = new Map();

  function renderFavs() {
    const favs = getFavs();
    $('fav-empty').hidden = favs.length > 0;
    $('fav-list').hidden = favs.length === 0;
    $('fav-list').innerHTML = favs.map(function (c, i) {
      const key = cityKey(c);
      const entry = favData.get(key);
      let cond, right;
      if (!entry) {
        cond = '<div class="skeleton fc-skel"></div>';
        right = '';
      } else if (entry.error) {
        cond = '<div class="fc-cond">Weather unavailable</div><div class="fc-hl">Tap to retry</div>';
        right = '';
      } else {
        const cur = entry.data.current;
        cond = '<div class="fc-cond">' + esc(cur.label) + '</div><div class="fc-hl">H ' + fmtTemp(cur.temp_max) + ' · L ' + fmtTemp(cur.temp_min) + '</div>';
        right = '<span class="fc-icon">' + wicon(cur.icon, cur.is_day !== 0) + '</span><span class="fc-temp">' + fmtTemp(cur.temperature) + '</span>';
      }
      return '<li class="fav-card glass" style="--i:' + i + '"><button type="button" class="fav-open" data-key="' + esc(key) + '">' +
        '<div><div class="fc-name">' + esc(c.name) + '</div><div class="fc-region">' + esc(c.isCurrent ? 'Saved location' : cityRegion(c)) + '</div>' + cond + '</div>' +
        '<div class="fc-right">' + right + '</div></button>' +
        '<button type="button" class="icon-btn fc-remove" data-remove="' + esc(key) + '" aria-label="Remove ' + esc(c.name) + ' from favorites">' + ui('x') + '</button></li>';
    }).join('');
  }

  async function loadFavWeather(city) {
    const key = cityKey(city);
    try {
      const data = await fetchJSON('/api/weather?lat=' + encodeURIComponent(city.lat) + '&lon=' + encodeURIComponent(city.lon));
      favData.set(key, { data: data });
    } catch (err) {
      favData.set(key, { error: err.message });
    }
    renderFavs();
  }

  function initFavorites() {
    $('fav-list').addEventListener('click', function (e) {
      const rm = e.target.closest('[data-remove]');
      if (rm) {
        const key = rm.getAttribute('data-remove');
        save(KEYS.favs, getFavs().filter((c) => cityKey(c) !== key));
        favData.delete(key);
        renderFavs();
        toast('Removed from favorites.', 'info', 2200);
        return;
      }
      const open = e.target.closest('[data-key]');
      if (!open) return;
      const city = getFavs().find((c) => cityKey(c) === open.getAttribute('data-key'));
      if (!city) return;
      if (favData.get(open.getAttribute('data-key')) && favData.get(open.getAttribute('data-key')).error) {
        favData.delete(open.getAttribute('data-key'));
        renderFavs();
        loadFavWeather(city);
        return;
      }
      save(KEYS.last, city);
      window.location.href = '/';
    });
    renderFavs();
    getFavs().forEach(loadFavWeather);
  }

  /* ------------------------------------------------------------------ 9. Boot */
  let deferredInstall = null;
  function showInstallButton() {
    const b = $('btn-install');
    if (b && deferredInstall) b.hidden = false;
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstall = e;
    showInstallButton();
  });
  window.addEventListener('appinstalled', function () {
    deferredInstall = null;
    const b = $('btn-install');
    if (b) b.hidden = true;
    toast('SkyCast installed. Look for it on your home screen.', 'success');
  });

  function boot() {
    hydrate(document);

    $('btn-theme').addEventListener('click', function () {
      settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
      save(KEYS.settings, settings);
      applySettings();
      hydrate($('btn-theme'));
    });
    $('btn-units').addEventListener('click', function () {
      settings.units = settings.units === 'metric' ? 'imperial' : 'metric';
      save(KEYS.settings, settings);
      applySettings();
      if (page() === 'home' && state.data) renderAll();
      if (page() === 'favorites') renderFavs();
    });

    const p = page();
    if (p === 'home') initHome();
    else if (p === 'favorites') initFavorites();
    else if (p === 'about') {
      showInstallButton();
      $('btn-install').addEventListener('click', async function () {
        if (!deferredInstall) return;
        deferredInstall.prompt();
        try { await deferredInstall.userChoice; } catch (e) { /* ignore */ }
        deferredInstall = null;
        $('btn-install').hidden = true;
      });
    }

    // Service worker: needs HTTPS (or localhost) to work.
    const host = location.hostname;
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || host === 'localhost' || host === '127.0.0.1')) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/service-worker.js').catch(function () { /* app still works without it */ });
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
