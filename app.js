'use strict';
/* ============================================================
   Time is Money — wasted-time tracker
   Pure client-side. Everything in localStorage. No network.
   ============================================================ */

/* ---------- constants ---------- */
const SETTINGS_KEY = 'tim.settings.v2';
const SESSIONS_KEY = 'tim.sessions.v1';
const ACTIVE_KEY   = 'tim.active.v1';
const WEEKS_PER_YEAR = 52.1775;
const WORK_DAYS_PER_YEAR = 260;
const HOURS_PER_YEAR_ALL = 365.25 * 24;
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
const MONEY_EPSILON = 0.005;             // sub-cent amounts are treated as zero in UI thresholds
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // index = getDay() (0 = Sun)
const DAY_LABELS2 = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']; // unambiguous (Sa≠Su, Tu≠Th)
const LOCALE = (navigator.languages && navigator.languages[0]) || navigator.language || 'en-US';

const CURRENCIES = [
  ['USD','US Dollar'],['EUR','Euro'],['GBP','British Pound'],['JPY','Japanese Yen'],
  ['KRW','Korean Won'],['CNY','Chinese Yuan'],['INR','Indian Rupee'],['CAD','Canadian Dollar'],
  ['AUD','Australian Dollar'],['CHF','Swiss Franc'],['HKD','Hong Kong Dollar'],['SGD','Singapore Dollar'],
  ['SEK','Swedish Krona'],['NOK','Norwegian Krone'],['DKK','Danish Krone'],['PLN','Polish Zloty'],
  ['MXN','Mexican Peso'],['BRL','Brazilian Real'],['ZAR','South African Rand'],['NZD','NZ Dollar'],
  ['AED','UAE Dirham'],['SAR','Saudi Riyal'],['THB','Thai Baht'],['IDR','Indonesian Rupiah'],
  ['PHP','Philippine Peso'],['MYR','Malaysian Ringgit'],['VND','Vietnamese Dong'],['TRY','Turkish Lira']
];

const PERIODS = [['hour','/ hour'],['day','/ day'],['week','/ week'],['month','/ month'],['year','/ year']];

const ACTIVITIES = [
  { key: 'instagram', label: 'Instagram',  emoji: '📷' },
  { key: 'tiktok',    label: 'TikTok',     emoji: '🎵' },
  { key: 'youtube',   label: 'YouTube',    emoji: '▶️' },
  { key: 'gaming',    label: 'Gaming',     emoji: '🎮' },
  { key: 'movies',    label: 'Movies / TV',emoji: '🎬' },
  { key: 'social',    label: 'Social',     emoji: '💬' },
  { key: 'browsing',  label: 'Browsing',   emoji: '🌐' },
  { key: 'other',     label: 'Other…',     emoji: '➕' }
];
const QUICK_START = { label: 'General', emoji: '⏱️' };  // generic Start button
const REDIRECT_META = {
  invest: { emoji: '📈', label: 'Invested' },
  save:   { emoji: '🏦', label: 'Saved' },
  donate: { emoji: '💝', label: 'Donated' }
};

/* ---------- helpers ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => 'i' + Math.random().toString(36).slice(2, 9);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const MAX_AMOUNT = 1e12;                   // sane finite ceiling for any income amount
// D1: clamp every income amount to [0, MAX_AMOUNT] as it crosses a trust boundary.
//   reason: a negative / NaN / Infinity amount (typed in Settings, or loaded from an
//           imported backup) otherwise flows straight into the money math and produces
//           negative or "$Infinity" wasted-money — garbage in the app's core metric.
//   cost: silently coerces nonsense to 0 (or the cap) instead of surfacing an input
//         error; a legitimate income above 1e12 would be capped (not a real personal case).
//   escape: delete sanitizeAmount and revert the three "/* D1 */" call sites to
//           `Number(x) || 0` to restore the previous pass-through behavior.
const sanitizeAmount = (v) => { const n = Number(v); return (!isFinite(n) || n < 0) ? 0 : Math.min(n, MAX_AMOUNT); };
// D2: validate + canonicalize penalty clock times ("HH:MM", 00:00–23:59) at the
//     normalization boundary; anything else falls back to the supplied default.
//   reason: a tampered/imported time like "99:99" or "abc" otherwise feeds timeToMin
//           an out-of-range value and the night-rate window behaves unpredictably.
//   cost: a malformed time silently reverts to its default rather than erroring.
//   escape: delete sanitizeTime; revert the two night.start/end lines to `x || default`.
const sanitizeTime = (t, fallback) => {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(String(t == null ? '' : t).trim());
  if (!m) return fallback;
  const hh = Number(m[1]), mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallback;
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
};
const MAX_SESSIONS = 100000;                 // cap on imported/stored sessions (DoS guard)
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;    // reject backup files larger than ~5MB
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0,0,0,0); return d.getTime(); };

function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}
function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return (h > 0 ? p(h) + ':' : '') + p(m) + ':' + p(s);
}

/* ---------- money formatting (single source of truth) ---------- */
const _mf = {};
function formatMoney(v, maxFrac = 2, minFrac = null) {
  const cur = settings.currency;
  const key = cur + ':' + maxFrac + ':' + (minFrac == null ? '' : minFrac);
  let f = _mf[key];
  if (!f) {
    const opts = {
      style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: maxFrac,
      minimumFractionDigits: minFrac != null ? Math.min(minFrac, maxFrac) : Math.min(2, maxFrac)
    };
    try { f = new Intl.NumberFormat(LOCALE, opts); }
    catch (_) {
      try { f = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: cur, maximumFractionDigits: maxFrac }); }
      catch (_2) { f = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'USD', maximumFractionDigits: maxFrac }); }
    }
    _mf[key] = f;
  }
  return f.format(v || 0);
}

/* ---------- state ---------- */
function defaultSettings() {
  return {
    v: 2,
    currency: 'USD',
    incomes: [{ id: uid(), label: 'Salary', amount: 50000, period: 'year' }],
    valueBasis: 'work',     // 'work' | 'all'
    hoursPerWeek: 40,
    nudgeEnabled: true,
    nudgeEvery: 5,          // buzz each time a session crosses this amount
    weeklyGoal: 50,         // 0 = off
    activityLimits: {},     // { label: weeklyLimit }
    penalty: {
      enabled: false,                                       // opt-in: most people don't earn premium rates
      night:   { on: true, mult: 1.5, start: '22:00', end: '06:00' },
      // per day-of-week multiplier (0=Sun … 6=Sat); Sat and Sun can differ.
      // Night on a weekend/holiday is DERIVED: dayRate + (night.mult − 1) night uplift.
      weekend: { on: true, rates: { 6: 1.5, 0: 2.0 } },     // Sat ×1.5, Sun ×2.0
      holiday: { on: true, mult: 2.5, dates: [] }           // dates: ['YYYY-MM-DD']; holiday night derived too
    },
    startedAt: Date.now()
  };
}

function loadSettings() {
  try {
    const rawNew = localStorage.getItem(scopedKey('settings.v2'));
    if (rawNew) return normalizeSettings(JSON.parse(rawNew));
    // migrate from v1 (earnings-ticker era) — guest/unscoped only, so new accounts start clean
    if (!currentUserId || currentUserId === 'guest') {
      const rawOld = localStorage.getItem('tim.settings.v1');
      if (rawOld) {
        const old = JSON.parse(rawOld);
        const s = defaultSettings();
        if (old.currency) s.currency = old.currency;
        if (Array.isArray(old.incomes) && old.incomes.length) s.incomes = old.incomes;
        return normalizeSettings(s);
      }
    }
  } catch (_) {}
  return defaultSettings();
}
function normalizeSettings(parsed) {
  const s = Object.assign(defaultSettings(), parsed);
  if (!Array.isArray(s.incomes) || !s.incomes.length) s.incomes = defaultSettings().incomes;
  s.incomes = s.incomes.map(i => ({ id: i.id || uid(), label: i.label || '', amount: sanitizeAmount(i.amount) /* D1 */, period: i.period || 'year' }));
  s.hoursPerWeek = clamp(Number(s.hoursPerWeek) || 40, 1, 168);
  if (s.valueBasis !== 'all') s.valueBasis = 'work';
  s.nudgeEnabled = s.nudgeEnabled !== false;
  s.nudgeEvery = Math.max(1, Number(s.nudgeEvery) || 5);
  s.weeklyGoal = Math.max(0, Number(s.weeklyGoal) || 0);
  const al = {};
  if (s.activityLimits && typeof s.activityLimits === 'object') {
    for (const k in s.activityLimits) { const v = Number(s.activityLimits[k]); if (v > 0) al[k] = v; }
  }
  s.activityLimits = al;

  const dp = defaultSettings().penalty;
  const p = (s.penalty && typeof s.penalty === 'object') ? s.penalty : {};
  const pw = (p.weekend && typeof p.weekend === 'object') ? p.weekend : {};
  s.penalty = {
    enabled: 'enabled' in p ? (p.enabled !== false) : dp.enabled,
    night: Object.assign({}, dp.night, p.night || {}),
    weekend: { on: pw.on !== false, rates: {} },
    holiday: Object.assign({}, dp.holiday, p.holiday || {})
  };
  const sp = s.penalty;
  sp.night.on = sp.night.on !== false; sp.night.mult = Math.max(1, Number(sp.night.mult) || 1.5);
  sp.night.start = sanitizeTime(sp.night.start, '22:00'); sp.night.end = sanitizeTime(sp.night.end, '06:00'); /* D2 */

  // weekend.rates: per day-of-week (0–6) multiplier > 1. Migrate the legacy
  // {weekendDays[], weekend.mult} shape; if no weekend info at all, seed defaults.
  if (pw.rates && typeof pw.rates === 'object') {
    for (const k in pw.rates) { const d = Number(k), m = Number(pw.rates[k]); if (d >= 0 && d <= 6 && isFinite(m) && m > 1) sp.weekend.rates[d] = Math.min(m, 100); }
  } else if (Array.isArray(p.weekendDays) && Number(pw.mult) > 1) {
    const m = Math.min(Number(pw.mult), 100);
    for (const d of p.weekendDays) if (d >= 0 && d <= 6) sp.weekend.rates[d] = m;
  } else if (!('weekend' in p) && !('weekendDays' in p)) {
    Object.assign(sp.weekend.rates, dp.weekend.rates);
  }

  sp.holiday.on = sp.holiday.on !== false; sp.holiday.mult = Math.max(1, Number(sp.holiday.mult) || 2.5);
  if (!Array.isArray(sp.holiday.dates)) sp.holiday.dates = [];

  if (!s.startedAt) s.startedAt = Date.now();
  return s;
}
function normalizeSessions(parsed) {
  if (!Array.isArray(parsed)) return [];
  const out = [];
  const nonNeg = (v) => { const n = Number(v); return isFinite(n) ? Math.max(0, n) : 0; };
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue;        // drop non-object junk
    const startMs = Number(raw.startMs);
    if (!isFinite(startMs)) continue;                     // unsalvageable without a timestamp
    const redirect = (raw.redirect && Object.prototype.hasOwnProperty.call(REDIRECT_META, raw.redirect)) ? raw.redirect : null;
    out.push({
      id: (typeof raw.id === 'string' && raw.id) ? raw.id : uid(),
      label: raw.label == null ? '' : String(raw.label),
      emoji: raw.emoji == null ? '' : String(raw.emoji),
      startMs,
      durationSec: nonNeg(raw.durationSec),
      rate: nonNeg(raw.rate),
      cost: nonNeg(raw.cost),
      redirect,
    });
  }
  return out;
}

/* ============================================================
   ACCOUNTS (device-local) — sign up / sign in / per-user data
   On-device auth: no server. Passwords are PBKDF2-hashed with a per-user
   salt, but anyone with this device+browser can read localStorage — so this
   is privacy/separation between people sharing a device, NOT bank-grade auth.
   For real cross-device accounts, swap the auth fns + loadUserData for a
   backend (Supabase / Firebase). Data keys are namespaced per signed-in user.
   ============================================================ */
const USERS_KEY = 'tim.users.v1';
const CURRENT_USER_KEY = 'tim.currentUser.v1';

function loadUsers() { const v = loadJSON(USERS_KEY, []); return Array.isArray(v) ? v : []; }
function saveUsers(list) { try { localStorage.setItem(USERS_KEY, JSON.stringify(list)); } catch (_) {} }
function findUserByEmail(email) { const e = String(email || '').trim().toLowerCase(); return loadUsers().find(u => u.email === e) || null; }
function findUserById(id) { return loadUsers().find(u => u.id === id) || null; }
function loadCurrentUser() {
  let id; try { id = localStorage.getItem(CURRENT_USER_KEY); } catch (_) { id = null; }
  if (!id) return null;                  // never chosen → show the portal
  if (id === 'guest') return 'guest';
  return findUserById(id) ? id : null;   // stale id → re-gate
}
function isSignedIn() { return !!currentUserId && currentUserId !== 'guest'; }

/* per-user data keys; guest / not-signed-in use the original base keys */
function scopedKey(base) {
  return (currentUserId && currentUserId !== 'guest') ? `tim.u.${currentUserId}.${base}` : `tim.${base}`;
}

/* crypto helpers (Web Crypto PBKDF2; degrades on insecure contexts like file://) */
function bytesToHex(b) { return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(''); }
function hexToBytes(h) { const a = new Uint8Array(h.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
function randomSaltHex() {
  if (window.crypto && crypto.getRandomValues) { const a = new Uint8Array(16); crypto.getRandomValues(a); return bytesToHex(a); }
  return (Date.now().toString(16) + Math.random().toString(16).slice(2)).slice(0, 32);
}
async function hashPassword(password, saltHex) {
  if (window.crypto && crypto.subtle) {
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: 100000, hash: 'SHA-256' }, km, 256);
    return 'pbkdf2$' + bytesToHex(new Uint8Array(bits));
  }
  let h = 5381; const s = saltHex + ':' + password;        // insecure-context fallback only
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return 'weak$' + (h >>> 0).toString(16);
}

let currentUserId = loadCurrentUser();       // valid user id, 'guest', or null (→ portal)
let settings = loadSettings();
let sessions = normalizeSessions(loadJSON(scopedKey('sessions.v1'), []));
let active = loadJSON(scopedKey('active.v1'), null);     // {label, emoji, startMs} | null
let val = { annual: 0, hourly: 0, perSecond: 0 };
let nudgeLevel = 0;                          // highest threshold multiple already nudged this session
let audioCtx = null;
const activityLimitNudged = new Set();       // keys "label|weekStart" already warned this week
let pendingRedirectId = null;                // session awaiting an invest/save/donate choice

function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
  catch (_) { return fallback; }
}
const saveSettings = () => { try { localStorage.setItem(scopedKey('settings.v2'), JSON.stringify(settings)); } catch (_) {} };
const saveSessions = () => { try { localStorage.setItem(scopedKey('sessions.v1'), JSON.stringify(sessions)); } catch (_) {} };
const saveActive  = () => { try { active ? localStorage.setItem(scopedKey('active.v1'), JSON.stringify(active)) : localStorage.removeItem(scopedKey('active.v1')); } catch (_) {} };

/* ---------- time-value computation ---------- */
function annualOf(inc) {
  const a = sanitizeAmount(inc.amount); /* D1 */
  switch (inc.period) {
    case 'hour':  return a * Math.max(1, settings.hoursPerWeek * WEEKS_PER_YEAR);
    case 'day':   return a * WORK_DAYS_PER_YEAR;
    case 'week':  return a * WEEKS_PER_YEAR;
    case 'month': return a * 12;
    case 'year':  return a;
    default:      return 0;
  }
}
function computeValue() {
  let annual = 0;
  for (const inc of settings.incomes) annual += annualOf(inc);
  const hourly = settings.valueBasis === 'all'
    ? annual / HOURS_PER_YEAR_ALL
    : annual / Math.max(1, settings.hoursPerWeek * WEEKS_PER_YEAR);
  val = { annual, hourly, perSecond: hourly / 3600 };
}
function costDecimals() {
  const r = val.perSecond;
  if (!isFinite(r) || r <= 0) return 2;
  return clamp(Math.ceil(Math.log10(8 / r)), 2, 4);
}

/* ---------- penalty / premium rate engine ---------- */
function timeToMin(t) { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); }
function dateKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function inNight(d, startMin, endMin) {
  const m = d.getHours() * 60 + d.getMinutes();
  if (startMin === endMin) return false;
  return startMin < endMin ? (m >= startMin && m < endMin) : (m >= startMin || m < endMin);
}
/* multiplier + a label for a given instant, by rule priority */
function multiplierInfo(ts) {
  const p = settings.penalty;
  if (!p || !p.enabled) return { mult: 1, label: '' };
  const d = new Date(ts);
  const night = p.night.on && inNight(d, timeToMin(p.night.start), timeToMin(p.night.end));
  const nightUplift = night ? (p.night.mult - 1) : 0;   // night adds onto whatever the day rate is
  // Holiday overrides weekday/weekend; its night rate is derived (holiday rate + night uplift).
  if (p.holiday.on && p.holiday.dates.includes(dateKey(d))) {
    return { mult: p.holiday.mult + nightUplift, label: night ? 'Holiday night' : 'Holiday rate' };
  }
  // Per-day weekend rate; weekend night is derived (day rate + night uplift).
  const dow = d.getDay();
  const wkRate = p.weekend.on ? p.weekend.rates[dow] : undefined;
  if (wkRate != null && wkRate > 1) {
    return { mult: wkRate + nightUplift, label: dayName(dow) + (night ? ' night' : ' rate') };
  }
  if (night) return { mult: p.night.mult, label: 'Night rate' };
  return { mult: 1, label: '' };
}
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dayName(dow) { return DAY_NAMES[dow] || ''; }
function weekendNightRate(dow) { const p = settings.penalty; const r = p.weekend.rates[dow]; return (r != null && r > 1) ? r + (p.night.on ? p.night.mult - 1 : 0) : null; }
function holidayNightRate() { const p = settings.penalty; return p.holiday.mult + (p.night.on ? p.night.mult - 1 : 0); }
/* exact cost over [fromMs,toMs), integrating the rate across windows it spans */
function costBetween(fromMs, toMs) {
  if (toMs <= fromMs) return 0;
  const basePerSec = val.perSecond;
  const p = settings.penalty;
  if (!p || !p.enabled) return basePerSec * (toMs - fromMs) / 1000;
  const ns = timeToMin(p.night.start) * 60000, ne = timeToMin(p.night.end) * 60000;
  const pts = [fromMs, toMs];
  for (let day = startOfDay(fromMs); day <= toMs; day += DAY_MS) {
    [day, day + ns, day + ne].forEach(t => { if (t > fromMs && t < toMs) pts.push(t); });
  }
  const uniq = Array.from(new Set(pts)).sort((a, b) => a - b);
  let cost = 0;
  for (let i = 0; i < uniq.length - 1; i++) {
    const a = uniq[i], b = uniq[i + 1];
    cost += basePerSec * (b - a) / 1000 * multiplierInfo((a + b) / 2).mult;
  }
  return cost;
}
function investProjection(amount, years, rate) { return amount * Math.pow(1 + rate, years); }

/* ---------- DOM ---------- */
const el = {
  // timer
  valueLineAmt: $('#value-line-amt'), valueLineTag: $('#value-line-tag'), recoTimer: $('#reco-timer'),
  heroIdle: $('#hero-idle'), heroLive: $('#hero-live'),
  todayWasted: $('#today-wasted'), todayHint: $('#today-hint'),
  liveEmoji: $('#live-emoji'), liveLabel: $('#live-label'), liveCost: $('#live-cost'), liveTime: $('#live-time'),
  gridCaption: $('#grid-caption'),
  activityGrid: $('#activity-grid'), stopBtn: $('#stop-btn'), startBtn: $('#start-btn'),
  todayBlock: $('#today-block'), todayList: $('#today-list'),
  // reports
  periodSeg: $('#period-seg'), periodPrev: $('#period-prev'), periodNext: $('#period-next'), periodLabel: $('#period-label'),
  rtMoney: $('#rt-money'), rtTime: $('#rt-time'), rtCap: $('#rt-cap'),
  reportChart: $('#report-chart'), reportBreakdown: $('#report-breakdown'), reportEmpty: $('#report-empty'),
  goalCard: $('#goal-card'), goalLabel: $('#goal-label'), goalStatus: $('#goal-status'),
  goalFill: $('#goal-fill'), goalSpent: $('#goal-spent'), goalTarget: $('#goal-target'), goalStreak: $('#goal-streak'),
  reportSaved: $('#report-saved'), todayCompare: $('#today-compare'), limitList: $('#limit-list'),
  recoReport: $('#reco-report'), turnedCard: $('#turned-card'),
  redirectModal: $('#redirect-modal'), redirectAmt: $('#redirect-amt'),
  penaltyToggle: $('#penalty-toggle'), penaltyBody: $('#penalty-body'),
  nightMult: $('#night-mult'), nightStart: $('#night-start'), nightEnd: $('#night-end'),
  weekendRates: $('#weekend-dayrates'), weekendNightNote: $('#weekend-night-note'),
  holidayMult: $('#holiday-mult'), holidayDate: $('#holiday-date'), addHoliday: $('#add-holiday'), holidayList: $('#holiday-list'), holidayNightNote: $('#holiday-night-note'),
  // settings
  sumHour: $('#sum-hour'), sumSub: $('#sum-sub'),
  incomeList: $('#income-list'), currencySelect: $('#currency-select'),
  basisSeg: $('#basis-seg'), hoursRow: $('#hours-row'), hoursWeek: $('#hours-week'), basisHint: $('#basis-hint'),
  nudgeToggle: $('#nudge-toggle'), nudgeEvery: $('#nudge-every'), nudgeCur: $('#nudge-cur'),
  weeklyGoal: $('#weekly-goal'), goalCur: $('#goal-cur'),
  // misc
  toast: $('#toast'),
  // data backup + edit-session modal
  exportBtn: $('#export-btn'), importBtn: $('#import-btn'), importFile: $('#import-file'),
  editModal: $('#edit-modal'), editLabel: $('#edit-label'), editDuration: $('#edit-duration'), editCostPreview: $('#edit-cost-preview'),
  // auth
  authScreen: $('#auth-screen'), authForm: $('#auth-form'), authName: $('#auth-name'),
  authEmail: $('#auth-email'), authPassword: $('#auth-password'), authSubmit: $('#auth-submit'),
  authError: $('#auth-error'), authGuest: $('#auth-guest'), authPwToggle: $('#auth-pw-toggle'),
  accountStatus: $('#account-status'), accountAction: $('#account-action'),
};

/* ============================================================
   TIMER
   ============================================================ */
function buildActivityGrid() {
  el.activityGrid.innerHTML = '';
  for (const a of ACTIVITIES) {
    const b = document.createElement('button');
    b.className = 'act-btn'; b.dataset.key = a.key;
    b.innerHTML = `<span class="emoji">${a.emoji}</span><span class="name">${a.label}</span>`;
    b.addEventListener('click', () => onActivityTap(a));
    el.activityGrid.appendChild(b);
  }
}

function onActivityTap(a) {
  let label = a.label, emoji = a.emoji;
  if (a.key === 'other') {
    const name = (prompt('What are you doing?') || '').trim();
    if (!name) return;
    label = name; emoji = '✏️';
  }
  // tapping the currently-running activity stops it
  if (active && active.label === label) { stopActivity(); return; }
  startActivity(label, emoji);
}

function startActivity(label, emoji) {
  if (active) stopActivity();          // log the previous one first
  active = { label, emoji, startMs: Date.now() };
  nudgeLevel = 0;
  initAudio();                         // unlock sound on this user gesture (needed on iOS)
  saveActive();
  renderTimerScreen();
  startTick();
}

function stopActivity() {
  if (!active) return;
  const now = Date.now();
  const durationSec = Math.max(0, (now - active.startMs) / 1000);
  let logged = null;
  if (durationSec >= 1) {
    const cost = costBetween(active.startMs, now);
    logged = {
      id: uid(), label: active.label, emoji: active.emoji,
      startMs: active.startMs, durationSec,
      rate: durationSec > 0 ? cost / durationSec : val.perSecond, cost, redirect: null
    };
    sessions.push(logged);
    saveSessions();
  }
  active = null; saveActive();
  stopTick();
  renderTimerScreen();
  if (currentScreen === 'reports-screen') renderReports();
  if (logged && logged.cost > MONEY_EPSILON) promptRedirect(logged);
}

/* ---------- post-session: invest / save / donate ---------- */
function promptRedirect(session) {
  pendingRedirectId = session.id;
  el.redirectAmt.textContent = formatMoney(session.cost, 2);
  el.redirectModal.hidden = false;
}
function closeRedirect() { el.redirectModal.hidden = true; pendingRedirectId = null; }
function initRedirectModal() {
  $$('.redirect-opt').forEach(b => b.addEventListener('click', () => {
    const s = sessions.find(x => x.id === pendingRedirectId);
    if (s) {
      s.redirect = b.dataset.redirect; saveSessions();
      const m = REDIRECT_META[s.redirect];
      showToast(`${m.emoji} ${m.label}: ${formatMoney(s.cost, 2)}`);
      if (currentScreen === 'reports-screen') renderReports();
      if (currentScreen === 'timer-screen') renderTimerScreen();
    }
    closeRedirect();
  }));
  $('#redirect-skip').addEventListener('click', closeRedirect);
  el.redirectModal.addEventListener('click', e => { if (e.target.id === 'redirect-modal') closeRedirect(); });
}

function deleteSession(id) {
  sessions = sessions.filter(s => s.id !== id);
  saveSessions();
  renderTimerScreen();
  if (currentScreen === 'reports-screen') renderReports();
}

/* live tick loop (runs only while a timer is active) */
let tickRAF = null;
function tick() {
  if (!active) { tickRAF = null; return; }
  const now = Date.now();
  const dur = (now - active.startMs) / 1000;
  const cost = costBetween(active.startMs, now);
  const dec = costDecimals();
  el.liveCost.textContent = formatMoney(cost, dec, dec);
  el.liveTime.textContent = fmtClock(dur);
  checkNudge(cost);
  checkActivityLimit(cost);
  tickRAF = requestAnimationFrame(tick);
}

/* ---------- nudges ---------- */
function checkNudge(cost) {
  if (!settings.nudgeEnabled || settings.nudgeEvery <= 0) return;
  const lvl = Math.floor(cost / settings.nudgeEvery);
  if (lvl > nudgeLevel) {
    nudgeLevel = lvl;
    nudge(`💸 ${formatMoney(lvl * settings.nudgeEvery, 0)} gone${active ? ' on ' + active.label : ''}`);
  }
}
function checkActivityLimit(liveCost) {
  if (!active) return;
  const limit = settings.activityLimits[active.label];
  if (!limit || limit <= 0) return;
  const key = active.label + '|' + weekStartMs(0);
  if (activityLimitNudged.has(key)) return;
  if (weeklyForActivity(active.label, 0) + liveCost >= limit) {
    activityLimitNudged.add(key);
    nudge(`🚫 Over your weekly ${active.label} limit (${formatMoney(limit, 0)})`, true);
  }
}
function nudge(message, strong) {
  if (navigator.vibrate) {
    try { navigator.vibrate(strong ? [0, 250, 120, 250, 120, 250] : [0, 180, 90, 180]); } catch (_) {}
  }
  beep(strong);
  el.heroLive.classList.remove('flash'); void el.heroLive.offsetWidth; el.heroLive.classList.add('flash');
  showToast(message);
}
function initAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (_) {}
}
function beep(strong) {
  if (!audioCtx) initAudio();
  if (!audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = strong ? 'sawtooth' : 'triangle';
    const f0 = strong ? 520 : 660, f1 = strong ? 300 : 440, len = strong ? 0.42 : 0.3;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + len * 0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(strong ? 0.25 : 0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(audioCtx.destination);
    o.start(t); o.stop(t + len + 0.02);
  } catch (_) {}
}
let toastTimer = null;
function showToast(msg) {
  const t = el.toast; if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
function startTick() { if (!tickRAF) tickRAF = requestAnimationFrame(tick); }
function stopTick() { if (tickRAF) cancelAnimationFrame(tickRAF); tickRAF = null; }

function todaySessions() {
  const t0 = startOfDay(Date.now());
  return sessions.filter(s => s.startMs >= t0).sort((a, b) => b.startMs - a.startMs);
}

function renderTimerScreen() {
  const mi = multiplierInfo(Date.now());
  el.valueLineAmt.textContent = formatMoney(val.hourly * mi.mult, 2);
  el.valueLineTag.textContent = mi.mult !== 1 ? `${mi.label} ×${mi.mult}` : '';

  // hero
  const running = !!active;
  el.heroIdle.hidden = running;
  el.heroLive.hidden = !running;
  el.stopBtn.hidden = !running;
  el.startBtn.hidden = running;
  el.gridCaption.textContent = running ? 'Switch activity, or stop below.' : '…or tag what you\'re doing';

  if (running) {
    el.liveEmoji.textContent = active.emoji;
    el.liveLabel.textContent = active.label;
    const now = Date.now();
    const dur = (now - active.startMs) / 1000;
    const dec = costDecimals();
    el.liveCost.textContent = formatMoney(costBetween(active.startMs, now), dec, dec);
    el.liveTime.textContent = fmtClock(dur);
  }

  // highlight active activity button
  $$('.act-btn', el.activityGrid).forEach(b => {
    const a = ACTIVITIES.find(x => x.key === b.dataset.key);
    b.classList.toggle('is-active', running && a && a.label === active.label);
  });

  // today total + list
  const today = todaySessions();
  const total = today.reduce((s, x) => s + x.cost, 0);
  el.todayWasted.textContent = formatMoney(total, 2);
  el.todayHint.textContent = today.length
    ? `${today.length} session${today.length > 1 ? 's' : ''} · ${fmtDuration(today.reduce((s, x) => s + x.durationSec, 0))} of your day`
    : 'Tap what you\'re doing to start the clock.';

  el.todayBlock.hidden = today.length === 0;

  // today vs your daily average
  const avg = dailyAverage();
  if (avg != null && today.length) {
    const diff = avg - total;
    if (diff >= MONEY_EPSILON) {
      el.todayCompare.hidden = false; el.todayCompare.className = 'today-compare good';
      el.todayCompare.innerHTML = `🌱 <b>${formatMoney(diff, 2)}</b> under your daily average — keep it up`;
    } else {
      el.todayCompare.hidden = false; el.todayCompare.className = 'today-compare bad';
      el.todayCompare.innerHTML = `<b>${formatMoney(-diff, 2)}</b> over your daily average today`;
    }
  } else {
    el.todayCompare.hidden = true;
  }

  el.todayList.innerHTML = '';
  for (const s of today) el.todayList.appendChild(sessionRow(s));

  // only nag about money not yet committed to invest/save/donate
  const uncommitted = today.reduce((a, s) => a + (s.redirect ? 0 : s.cost), 0);
  renderReco(el.recoTimer, uncommitted);
}

/* ---------- "turn it around" recommendation ---------- */
function renderReco(container, amount) {
  if (!container) return;
  if (!(amount > MONEY_EPSILON)) { container.hidden = true; container.innerHTML = ''; return; }
  container.hidden = false;
  const inv = investProjection(amount, 10, 0.07);
  container.innerHTML = `
    <h3>Turn that <b>${formatMoney(amount, 2)}</b> around</h3>
    <p class="reco-sub">That money is already gone — but the next ${formatMoney(amount, 2)} doesn't have to be. Put it to work instead:</p>
    <div class="reco-list">
      <div class="reco-item"><span class="ri-emoji">📈</span><span>Invest it. At ~7%/yr, ${formatMoney(amount, 2)} could grow to about <b>${formatMoney(inv, 2)}</b> in 10 years.</span></div>
      <div class="reco-item"><span class="ri-emoji">🏦</span><span>Save it toward a goal — small amounts add up far faster than wasted hours do.</span></div>
      <div class="reco-item"><span class="ri-emoji">💝</span><span>Donate it. Turn time you can't get back into real good for someone else.</span></div>
      <div class="reco-item"><span class="ri-emoji">📚</span><span>Invest in <b>you</b> — a book, a course, or a skill that earns it back and then some.</span></div>
    </div>`;
}

/* committed redirects (invest/save/donate) for a set of sessions */
function renderTurnedAround(inRange) {
  const sums = { invest: 0, save: 0, donate: 0 };
  let total = 0;
  for (const s of inRange) {
    if (s.redirect && Object.prototype.hasOwnProperty.call(sums, s.redirect)) { sums[s.redirect] += s.cost; total += s.cost; }
  }
  if (total <= MONEY_EPSILON) { el.turnedCard.hidden = true; el.turnedCard.innerHTML = ''; return; }
  el.turnedCard.hidden = false;
  let rows = '';
  for (const k of ['invest', 'save', 'donate']) {
    if (sums[k] > MONEY_EPSILON) {
      const m = REDIRECT_META[k];
      rows += `<div class="reco-item"><span class="ri-emoji">${m.emoji}</span><span>${m.label} <b>${formatMoney(sums[k], 2)}</b></span></div>`;
    }
  }
  el.turnedCard.innerHTML = `<h3>♻️ Turned around: <b>${formatMoney(total, 2)}</b></h3>
    <p class="reco-sub">Money you committed to put to good use instead of writing off.</p>
    <div class="reco-list">${rows}</div>`;
}

function sessionRow(s) {
  const row = document.createElement('div');
  row.className = 'session-row';
  const time = new Date(s.startMs).toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
  const m = s.redirect && REDIRECT_META[s.redirect];
  const badge = m ? `<span class="s-redirect" title="${m.label}">${m.emoji}</span>` : '';
  row.innerHTML = `
    <span class="s-emoji">${s.emoji || '⏱'}</span>
    <button class="s-main" aria-label="Choose where this money goes">
      <div class="s-label">${escapeHtml(s.label)}</div>
      <div class="s-time">${time} · ${fmtDuration(s.durationSec)}</div>
    </button>
    ${badge}
    <span class="s-cost">${formatMoney(s.cost, 2)}</span>
    <button class="s-edit" aria-label="Edit">✏️</button>
    <button class="s-del" aria-label="Delete">×</button>`;
  row.querySelector('.s-main').addEventListener('click', () => { if (s.cost > MONEY_EPSILON) promptRedirect(s); });
  row.querySelector('.s-del').addEventListener('click', () => deleteSession(s.id));
  row.querySelector('.s-edit').addEventListener('click', () => openEdit(s));
  return row;
}

/* ---------- data backup (export / import) — 100% on-device ---------- */
function exportData() {
  const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), settings, sessions }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const d = new Date();
  const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const a = document.createElement('a');
  a.href = url; a.download = `time-is-money-backup-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('⬇ Backup exported');
}
// D3: parse an untrusted backup file through ONE fenced function — bounded size,
//     strict shape, prototype-pollution-safe JSON, sanitized settings/sessions, and a
//     session-count cap — so importData only ever applies validated data.
//   reason: importData consumes a user-picked file (fully untrusted); a malformed,
//           oversized, or hostile file could otherwise crash/hang the app or inject junk.
//   cost: silently drops sessions beyond MAX_SESSIONS (keeps the most recent ones).
//   escape: inline this back into importData and remove the size cap / __proto__ reviver.
function parseBackup(text) {
  if (typeof text === 'string' && text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'too-large' };
  let parsed;
  try { parsed = JSON.parse(text, (k, v) => (k === '__proto__' ? undefined : v)); }   // drop __proto__ keys
  catch (_) { return { ok: false, error: 'invalid-json' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed.settings == null && parsed.sessions == null))
    return { ok: false, error: 'not-a-backup' };
  const rawSettings = (parsed.settings && typeof parsed.settings === 'object' && !Array.isArray(parsed.settings)) ? parsed.settings : {};
  const settings = normalizeSettings(rawSettings);
  let sessions = normalizeSessions(parsed.sessions);
  let dropped = 0;
  if (sessions.length > MAX_SESSIONS) { dropped = sessions.length - MAX_SESSIONS; sessions = sessions.slice(-MAX_SESSIONS); }
  return { ok: true, settings, sessions, dropped };
}
function importData(file) {
  if (file && file.size > MAX_IMPORT_BYTES) { showToast('⚠️ Backup file too large'); return; }   /* D3 */
  const reader = new FileReader();
  reader.onload = () => {
    const res = parseBackup(reader.result);
    if (!res.ok) {
      showToast(res.error === 'invalid-json' ? '⚠️ Invalid backup file'
        : res.error === 'too-large' ? '⚠️ Backup file too large'
        : '⚠️ Not a Time is Money backup');
      return;
    }
    if (!confirm('Replace your current settings and sessions with this backup?')) return;
    settings = res.settings;
    sessions = res.sessions;
    active = null; nudgeLevel = 0; activityLimitNudged.clear();
    saveSettings(); saveSessions(); saveActive();
    stopTick(); computeValue();
    buildCurrencyOptions(); renderIncomeList(); renderBasisUI(); renderNudgeGoalUI(); renderLimitList(); renderPenaltyUI();
    showScreen('timer-screen');
    showToast(res.dropped ? `⬆ Backup restored (${res.dropped} oldest sessions dropped)` : '⬆ Backup restored');
  };
  reader.onerror = () => showToast('⚠️ Could not read file');
  reader.readAsText(file);
}

/* ---------- edit a past session (relabel + adjust duration, cost recomputed) ---------- */
let editingId = null;
function openEdit(s) {
  editingId = s.id;
  el.editLabel.value = s.label;
  el.editDuration.value = Math.round(s.durationSec / 60);
  updateEditPreview();
  el.editModal.hidden = false;
}
function closeEdit() { el.editModal.hidden = true; editingId = null; }
function editPreviewCost() {
  const s = sessions.find(x => x.id === editingId);
  if (!s) return 0;
  const mins = Math.max(0, Number(el.editDuration.value) || 0);
  return costBetween(s.startMs, s.startMs + mins * 60000);
}
function updateEditPreview() { el.editCostPreview.textContent = formatMoney(editPreviewCost(), 2); }
function saveEdit() {
  const s = sessions.find(x => x.id === editingId);
  if (!s) { closeEdit(); return; }
  const label = (el.editLabel.value || '').trim() || s.label;
  const durationSec = Math.round(Math.max(0, Number(el.editDuration.value) || 0) * 60);
  const cost = costBetween(s.startMs, s.startMs + durationSec * 1000);
  const preset = ACTIVITIES.find(a => a.key !== 'other' && a.label.toLowerCase() === label.toLowerCase());
  s.label = label;
  s.emoji = preset ? preset.emoji : (s.emoji || '✏️');
  s.durationSec = durationSec;
  s.cost = cost;
  s.rate = durationSec > 0 ? cost / durationSec : val.perSecond;
  saveSessions();
  closeEdit();
  renderTimerScreen();
  if (currentScreen === 'reports-screen') renderReports();
}
function initEditModal() {
  el.editDuration.addEventListener('input', updateEditPreview);
  $('#edit-save').addEventListener('click', saveEdit);
  $('#edit-cancel').addEventListener('click', closeEdit);
  $('#edit-close').addEventListener('click', closeEdit);
  el.editModal.addEventListener('click', e => { if (e.target.id === 'edit-modal') closeEdit(); });
}

/* ============================================================
   REPORTS
   ============================================================ */
let reportPeriod = 'week';
let reportOffset = 0;     // 0 = current, -1 = previous, ...

/* session aggregation helpers (single source of truth for range sums) */
const sessionsInRange = (from, to) => sessions.filter(s => s.startMs >= from && s.startMs < to);
const sumCost = (list) => list.reduce((a, s) => a + s.cost, 0);

function periodRange(period, offset) {
  const now = new Date();
  let from, to, label;
  if (period === 'day') {
    const d = new Date(now); d.setHours(0,0,0,0); d.setDate(d.getDate() + offset);
    from = d.getTime(); to = from + DAY_MS;
    label = offset === 0 ? 'Today' : offset === -1 ? 'Yesterday'
      : new Date(from).toLocaleDateString(LOCALE, { weekday: 'short', month: 'short', day: 'numeric' });
  } else if (period === 'week') {
    from = weekStartMs(offset); to = from + WEEK_MS;
    const end = new Date(to - DAY_MS);
    label = offset === 0 ? 'This week' : offset === -1 ? 'Last week'
      : `${new Date(from).toLocaleDateString(LOCALE,{month:'short',day:'numeric'})} – ${end.toLocaleDateString(LOCALE,{month:'short',day:'numeric'})}`;
  } else if (period === 'month') {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    from = d.getTime(); to = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1).getTime();
    label = d.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
  } else { // year
    const y = now.getFullYear() + offset;
    from = new Date(y, 0, 1).getTime(); to = new Date(y + 1, 0, 1).getTime();
    label = String(y);
  }
  return { from, to, label };
}

function weekStartMs(offset) {
  const d = new Date(); d.setHours(0,0,0,0);
  const dow = (d.getDay() + 6) % 7;        // Monday = 0
  d.setDate(d.getDate() - dow + offset * 7);
  return d.getTime();
}
function weekTotal(offset) {
  const from = weekStartMs(offset);
  return sumCost(sessionsInRange(from, from + WEEK_MS));
}
function weeklyForActivity(label, offset) {
  const from = weekStartMs(offset);
  return sumCost(sessionsInRange(from, from + WEEK_MS).filter(s => s.label === label));
}

/* ---------- "saved vs your average" ---------- */
function dailyMap() {
  const m = new Map();
  for (const s of sessions) { const d = startOfDay(s.startMs); m.set(d, (m.get(d) || 0) + s.cost); }
  return m;
}
function dailyAverage() {
  // average over completed days that had activity (exclude today, so a fresh day doesn't skew it)
  const m = dailyMap(); const today0 = startOfDay(Date.now());
  let sum = 0, n = 0;
  for (const [d, c] of m) { if (d < today0) { sum += c; n++; } }
  return n ? sum / n : null;
}
function savedInRange(from, to) {
  const avg = dailyAverage();
  if (avg == null || !sessions.length) return null;
  const m = dailyMap();
  const firstDay = startOfDay(Math.min(...sessions.map(s => s.startMs)));
  const today0 = startOfDay(Date.now());
  let saved = 0;
  for (let d = Math.max(from, firstDay); d < to && d <= today0; d += DAY_MS) {
    saved += Math.max(0, avg - (m.get(d) || 0));
  }
  return saved;
}
function computeStreak() {
  const goal = settings.weeklyGoal;
  if (!goal || goal <= 0 || !sessions.length) return 0;
  const earliest = Math.min(...sessions.map(s => s.startMs));
  let streak = 0;
  for (let off = -1; off > -520; off--) {       // look back over completed weeks (~10yr cap)
    const from = weekStartMs(off), to = from + WEEK_MS;
    if (to <= earliest) break;                  // before any tracked data
    const total = sumCost(sessionsInRange(from, to));
    if (total <= goal) streak++; else break;
  }
  return streak;
}
function renderGoalCard() {
  const goal = settings.weeklyGoal;
  if (!goal || goal <= 0) { el.goalCard.hidden = true; return; }
  el.goalCard.hidden = false;
  const off = reportPeriod === 'week' ? reportOffset : 0;
  const spent = weekTotal(off);
  const over = spent > goal;
  el.goalLabel.textContent = reportPeriod === 'week' ? (off === 0 ? 'This week' : el.periodLabel.textContent) : 'This week';
  el.goalSpent.textContent = formatMoney(spent, 2);
  el.goalTarget.textContent = formatMoney(goal, 0) + ' / wk';
  el.goalFill.style.width = clamp((spent / goal) * 100, 0, 100) + '%';
  el.goalCard.classList.toggle('over', over);
  el.goalStatus.textContent = over ? `Over by ${formatMoney(spent - goal, 2)}` : `${formatMoney(goal - spent, 2)} left`;
  const streak = computeStreak();
  el.goalStreak.textContent = streak > 0 ? `🔥 ${streak} week${streak > 1 ? 's' : ''} under budget` : 'Get a week under to start a streak';
}

function renderReports() {
  $$('.seg-opt', el.periodSeg).forEach(b => b.classList.toggle('is-on', b.dataset.period === reportPeriod));
  const { from, to, label } = periodRange(reportPeriod, reportOffset);
  el.periodLabel.textContent = label;
  el.periodNext.disabled = reportOffset >= 0;
  renderGoalCard();

  const inRange = sessionsInRange(from, to);
  const totalCost = sumCost(inRange);
  const totalSec = inRange.reduce((a, s) => a + s.durationSec, 0);

  el.rtMoney.textContent = formatMoney(totalCost, 2);
  el.rtTime.textContent = inRange.length ? fmtDuration(totalSec) + ' spent on distractions' : 'No time tracked yet';
  el.rtCap.textContent = inRange.length ? capFor(totalSec) : '';

  const saved = savedInRange(from, to);
  if (saved != null && saved >= MONEY_EPSILON) {
    el.reportSaved.hidden = false;
    el.reportSaved.textContent = `🌱 ${formatMoney(saved, 2)} saved vs your daily average`;
  } else {
    el.reportSaved.hidden = true;
  }

  renderReco(el.recoReport, sumCost(inRange.filter(s => !s.redirect)));
  renderTurnedAround(inRange);

  const empty = inRange.length === 0;
  el.reportEmpty.hidden = !empty;
  el.reportChart.style.display = empty ? 'none' : 'flex';
  el.reportBreakdown.style.display = empty ? 'none' : 'flex';
  if (empty) { el.reportChart.innerHTML = ''; el.reportBreakdown.innerHTML = ''; return; }

  renderChart(inRange, from, to);
  renderBreakdown(inRange, totalCost);
}

function capFor(totalSec) {
  const hrs = totalSec / 3600;
  if (val.hourly > 0) {
    const workDays = (totalSec * val.perSecond) / (val.hourly * 8);
    if (workDays >= 1) return `≈ ${workDays.toFixed(1)} full work day${workDays >= 2 ? 's' : ''} of your time`;
  }
  return hrs >= 1 ? `${hrs.toFixed(1)} hours you won't get back` : 'every minute counts';
}

function renderChart(inRange, from, to) {
  // bucket the range; sum cost per bucket
  let buckets;
  if (reportPeriod === 'day') {
    buckets = Array.from({ length: 12 }, (_, i) => ({ lbl: (i * 2) + '', from: from + i * 2 * 3600000, to: from + (i + 1) * 2 * 3600000, cost: 0 }));
  } else if (reportPeriod === 'week') {
    const wd = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    buckets = Array.from({ length: 7 }, (_, i) => ({ lbl: wd[i], from: from + i * DAY_MS, to: from + (i + 1) * DAY_MS, cost: 0 }));
  } else if (reportPeriod === 'month') {
    const days = Math.round((to - from) / DAY_MS);
    buckets = Array.from({ length: days }, (_, i) => ({ lbl: (i % 5 === 0) ? String(i + 1) : '', from: from + i * DAY_MS, to: from + (i + 1) * DAY_MS, cost: 0 }));
  } else {
    const mn = ['J','F','M','A','M','J','J','A','S','O','N','D'];
    const y = new Date(from).getFullYear();
    buckets = Array.from({ length: 12 }, (_, i) => ({ lbl: mn[i], from: new Date(y, i, 1).getTime(), to: new Date(y, i + 1, 1).getTime(), cost: 0 }));
  }
  for (const s of inRange) {
    const b = buckets.find(b => s.startMs >= b.from && s.startMs < b.to);
    if (b) b.cost += s.cost;
  }
  const max = Math.max(...buckets.map(b => b.cost), 0.0001);
  el.reportChart.innerHTML = '';
  for (const b of buckets) {
    const wrap = document.createElement('div'); wrap.className = 'bar-wrap';
    const h = b.cost > 0 ? Math.max(4, (b.cost / max) * 100) : 2;
    wrap.innerHTML = `<div class="bar ${b.cost > 0 ? '' : 'is-empty'}" style="height:${h}%" title="${formatMoney(b.cost, 2)}"></div><span class="bar-lbl">${b.lbl}</span>`;
    el.reportChart.appendChild(wrap);
  }
}

function renderBreakdown(inRange, totalCost) {
  const map = new Map();
  for (const s of inRange) {
    const k = s.label;
    const e = map.get(k) || { label: s.label, emoji: s.emoji, cost: 0, sec: 0 };
    e.cost += s.cost; e.sec += s.durationSec; map.set(k, e);
  }
  const rows = Array.from(map.values()).sort((a, b) => b.cost - a.cost);
  el.reportBreakdown.innerHTML = '';
  for (const r of rows) {
    const pct = totalCost > 0 ? (r.cost / totalCost) * 100 : 0;
    const limit = settings.activityLimits[r.label];
    let limitHtml = '';
    if (reportPeriod === 'week' && limit > 0) {
      const over = r.cost > limit;
      limitHtml = `<div class="bd-limit ${over ? 'over' : ''}">${over ? '⚠️ over' : '🎯'} ${formatMoney(r.cost, 0)} / ${formatMoney(limit, 0)} weekly limit</div>`;
    }
    const div = document.createElement('div'); div.className = 'bd-row';
    div.innerHTML = `
      <div class="bd-top">
        <span class="bd-emoji">${r.emoji || '⏱'}</span>
        <span class="bd-label">${escapeHtml(r.label)}</span>
        <span class="bd-time">${fmtDuration(r.sec)}</span>
        <span class="bd-cost">${formatMoney(r.cost, 2)}</span>
      </div>
      <div class="bd-bar-track"><div class="bd-bar-fill" style="width:${pct}%"></div></div>
      ${limitHtml}`;
    el.reportBreakdown.appendChild(div);
  }
}

/* ============================================================
   SETTINGS
   ============================================================ */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function buildCurrencyOptions() {
  el.currencySelect.innerHTML = '';
  const known = new Set(CURRENCIES.map(c => c[0]));
  const list = known.has(settings.currency) ? CURRENCIES : [[settings.currency, settings.currency], ...CURRENCIES];
  for (const [code, name] of list) {
    const o = document.createElement('option');
    o.value = code; o.textContent = code === name ? code : `${code} — ${name}`;
    el.currencySelect.appendChild(o);
  }
  el.currencySelect.value = settings.currency;
}

function renderIncomeList() {
  el.incomeList.innerHTML = '';
  settings.incomes.forEach((inc) => {
    const row = document.createElement('div');
    row.className = 'income-row'; row.dataset.id = inc.id;
    const opts = PERIODS.map(([v, l]) => `<option value="${v}" ${inc.period === v ? 'selected' : ''}>${l}</option>`).join('');
    row.innerHTML = `
      <input class="inc-label" type="text" value="${escapeHtml(inc.label)}" placeholder="Income name" aria-label="Income name" />
      <button class="inc-del" aria-label="Remove">×</button>
      <div class="inc-money">
        <input class="inc-amount num" style="max-width:none;flex:1" type="number" inputmode="decimal" step="any" min="0" value="${inc.amount}" aria-label="Amount" />
        <select class="inc-period select" aria-label="Period">${opts}</select>
      </div>
      <div class="inc-annual"></div>`;
    el.incomeList.appendChild(row);
    updateRowAnnual(row, inc);
    row.querySelector('.inc-label').addEventListener('input', e => { inc.label = e.target.value; saveSettings(); });
    row.querySelector('.inc-amount').addEventListener('input', e => { inc.amount = sanitizeAmount(e.target.value); /* D1 */ onSettingsChanged(); updateRowAnnual(row, inc); });
    row.querySelector('.inc-period').addEventListener('change', e => { inc.period = e.target.value; onSettingsChanged(); updateRowAnnual(row, inc); });
    row.querySelector('.inc-del').addEventListener('click', () => { settings.incomes = settings.incomes.filter(x => x.id !== inc.id); saveSettings(); renderIncomeList(); onSettingsChanged(); });
  });
}
function updateRowAnnual(row, inc) {
  row.querySelector('.inc-annual').textContent = '≈ ' + formatMoney(annualOf(inc), 0) + ' / year';
}

function renderBasisUI() {
  $$('.seg-opt', el.basisSeg).forEach(b => b.classList.toggle('is-on', b.dataset.basis === settings.valueBasis));
  el.hoursRow.style.display = settings.valueBasis === 'work' ? 'flex' : 'none';
  el.hoursWeek.value = settings.hoursPerWeek;
  el.basisHint.textContent = settings.valueBasis === 'all'
    ? 'Your income spread across every hour you are alive (24×7). A gentler number.'
    : 'What an hour of work earns you — the opportunity cost of the time you waste. Hits harder.';
}

function activityLimitTargets() {
  const seen = new Map();
  for (const a of ACTIVITIES) if (a.key !== 'other') seen.set(a.label, a.emoji);
  for (const s of sessions) if (!seen.has(s.label)) seen.set(s.label, s.emoji || '✏️');
  return Array.from(seen, ([label, emoji]) => ({ label, emoji }));
}
function renderLimitList() {
  el.limitList.innerHTML = '';
  for (const t of activityLimitTargets()) {
    const row = document.createElement('div'); row.className = 'limit-row';
    const cur = settings.activityLimits[t.label] || '';
    row.innerHTML = `
      <span class="l-emoji">${t.emoji}</span>
      <span class="l-name">${escapeHtml(t.label)}</span>
      <span class="inline-money"><input class="select num lim-input" type="number" inputmode="numeric" min="0" step="1" value="${cur}" aria-label="${escapeHtml(t.label)} weekly limit" /><em class="cur-suffix">${escapeHtml(settings.currency)}/wk</em></span>`;
    row.querySelector('.lim-input').addEventListener('input', e => {
      const v = Math.max(0, Number(e.target.value) || 0);
      if (v > 0) settings.activityLimits[t.label] = v; else delete settings.activityLimits[t.label];
      saveSettings();
      if (currentScreen === 'reports-screen') renderReports();
    });
    el.limitList.appendChild(row);
  }
}

function renderPenaltyUI() {
  const p = settings.penalty;
  el.penaltyToggle.classList.toggle('is-on', p.enabled);
  el.penaltyToggle.setAttribute('aria-checked', p.enabled ? 'true' : 'false');
  el.penaltyBody.classList.toggle('off', !p.enabled);
  $$('.rule-sw').forEach(b => {
    const r = b.dataset.rule;
    b.classList.toggle('is-on', p[r].on);
    b.setAttribute('aria-checked', p[r].on ? 'true' : 'false');
    const body = document.querySelector(`.rule-body[data-body="${r}"]`);
    if (body) body.classList.toggle('off', !p[r].on);
  });
  el.nightMult.value = p.night.mult; el.nightStart.value = p.night.start; el.nightEnd.value = p.night.end;
  el.holidayMult.value = p.holiday.mult;
  renderWeekendRates();
  renderHolidayList();
  renderDerivedNotes();
}
const round2 = (n) => Math.round(n * 100) / 100;
function renderWeekendRates() {
  el.weekendRates.innerHTML = '';
  const rates = settings.penalty.weekend.rates;
  for (const dow of [1, 2, 3, 4, 5, 6, 0]) {                  // Mon…Sun
    const cell = document.createElement('label');
    cell.className = 'dayrate-cell';
    const cur = rates[dow] != null ? rates[dow] : '';
    cell.innerHTML = `<span class="dr-day">${DAY_LABELS2[dow]}</span><span class="dr-x">×</span><input class="dr-input" type="number" inputmode="decimal" min="1" step="0.1" value="${cur}" aria-label="${dayName(dow)} rate" placeholder="1" />`;
    cell.querySelector('.dr-input').addEventListener('input', (e) => {
      const v = Number(e.target.value);
      if (isFinite(v) && v > 1) settings.penalty.weekend.rates[dow] = Math.min(v, 100);
      else delete settings.penalty.weekend.rates[dow];
      onSettingsChanged(); renderDerivedNotes();
    });
    el.weekendRates.appendChild(cell);
  }
}
function renderDerivedNotes() {
  const p = settings.penalty;
  const uplift = p.night.on ? (p.night.mult - 1) : 0;
  const days = Object.keys(p.weekend.rates).map(Number).filter(d => p.weekend.rates[d] > 1).sort((a, b) => a - b);
  if (!p.weekend.on || days.length === 0) {
    el.weekendNightNote.textContent = 'Set a per-day multiplier above (blank = normal pay).';
  } else if (uplift > 0) {
    el.weekendNightNote.textContent = 'Night adds ×' + round2(uplift) + ' → ' +
      days.map(d => `${dayName(d)} night ×${round2(weekendNightRate(d))}`).join(', ');
  } else {
    el.weekendNightNote.textContent = 'Weekend night = same as the day rate (night rule is off).';
  }
  if (el.holidayNightNote) {
    el.holidayNightNote.textContent = p.holiday.on
      ? `Holiday day ×${round2(p.holiday.mult)} · holiday night ×${round2(holidayNightRate())} (derived)`
      : '';
  }
}
function renderHolidayList() {
  el.holidayList.innerHTML = '';
  for (const ds of settings.penalty.holiday.dates.slice().sort()) {
    const row = document.createElement('div'); row.className = 'holiday-row';
    const label = new Date(ds + 'T00:00:00').toLocaleDateString(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' });
    row.innerHTML = `<span>${label}</span><button aria-label="Remove">×</button>`;
    row.querySelector('button').addEventListener('click', () => {
      settings.penalty.holiday.dates = settings.penalty.holiday.dates.filter(x => x !== ds);
      saveSettings(); renderHolidayList(); onSettingsChanged();
    });
    el.holidayList.appendChild(row);
  }
}

function renderNudgeGoalUI() {
  el.nudgeToggle.classList.toggle('is-on', settings.nudgeEnabled);
  el.nudgeToggle.setAttribute('aria-checked', settings.nudgeEnabled ? 'true' : 'false');
  el.nudgeEvery.value = settings.nudgeEvery;
  el.weeklyGoal.value = settings.weeklyGoal;
  el.nudgeCur.textContent = settings.currency;
  el.goalCur.textContent = settings.currency + ' / wk';
}

function renderSettings() {
  el.sumHour.textContent = formatMoney(val.hourly, 2);
  el.sumSub.textContent = `${formatMoney(val.annual, 0)} / year · ${formatMoney(val.perSecond, 4)} every second`;
}

/* ---------- central re-render after any settings change ---------- */
function onSettingsChanged() {
  saveSettings();
  computeValue();
  renderSettings();
  renderTimerScreen();
  if (currentScreen === 'reports-screen') renderReports();
}

/* ============================================================
   NAV + WIRING
   ============================================================ */
let currentScreen = 'timer-screen';
function showScreen(id) {
  currentScreen = id;
  $$('.screen').forEach(s => s.classList.toggle('is-active', s.id === id));
  $$('.tab', $('#tabbar')).forEach(t => t.classList.toggle('is-active', t.dataset.tab === id));
  window.scrollTo(0, 0);
  if (id === 'timer-screen') renderTimerScreen();
  if (id === 'reports-screen') renderReports();
  if (id === 'settings-screen') { renderSettings(); renderLimitList(); }
}

function initNav() {
  $$('.tab', $('#tabbar')).forEach(t => t.addEventListener('click', () => showScreen(t.dataset.tab)));
}

function initSettingsControls() {
  buildCurrencyOptions();
  renderIncomeList();
  renderBasisUI();
  renderNudgeGoalUI();
  renderLimitList();
  renderPenaltyUI();

  $('#add-income').addEventListener('click', () => {
    settings.incomes.push({ id: uid(), label: 'Extra income', amount: 0, period: 'month' });
    saveSettings(); renderIncomeList(); onSettingsChanged();
  });
  el.currencySelect.addEventListener('change', e => { settings.currency = e.target.value; onSettingsChanged(); renderIncomeList(); renderNudgeGoalUI(); renderLimitList(); });
  $$('.seg-opt', el.basisSeg).forEach(b => b.addEventListener('click', () => {
    settings.valueBasis = b.dataset.basis; renderBasisUI(); onSettingsChanged(); renderIncomeList();
  }));
  el.hoursWeek.addEventListener('input', e => {
    settings.hoursPerWeek = clamp(Number(e.target.value) || 40, 1, 168);
    onSettingsChanged(); renderIncomeList();
  });

  el.nudgeToggle.addEventListener('click', () => {
    settings.nudgeEnabled = !settings.nudgeEnabled; saveSettings(); renderNudgeGoalUI();
  });
  el.nudgeEvery.addEventListener('input', e => {
    settings.nudgeEvery = Math.max(1, Number(e.target.value) || 1); saveSettings();
  });
  el.weeklyGoal.addEventListener('input', e => {
    settings.weeklyGoal = Math.max(0, Number(e.target.value) || 0); saveSettings();
    if (currentScreen === 'reports-screen') renderReports();
  });

  // penalty / premium rates
  el.penaltyToggle.addEventListener('click', () => { settings.penalty.enabled = !settings.penalty.enabled; renderPenaltyUI(); onSettingsChanged(); });
  $$('.rule-sw').forEach(b => b.addEventListener('click', () => {
    const r = b.dataset.rule; settings.penalty[r].on = !settings.penalty[r].on; renderPenaltyUI(); onSettingsChanged();
  }));
  el.nightMult.addEventListener('input', e => { settings.penalty.night.mult = Math.max(1, Number(e.target.value) || 1); onSettingsChanged(); renderDerivedNotes(); });
  el.nightStart.addEventListener('change', e => { settings.penalty.night.start = e.target.value || '22:00'; onSettingsChanged(); });
  el.nightEnd.addEventListener('change', e => { settings.penalty.night.end = e.target.value || '06:00'; onSettingsChanged(); });
  el.holidayMult.addEventListener('input', e => { settings.penalty.holiday.mult = Math.max(1, Number(e.target.value) || 1); onSettingsChanged(); renderDerivedNotes(); });
  el.addHoliday.addEventListener('click', () => {
    const v = el.holidayDate.value;
    if (v && !settings.penalty.holiday.dates.includes(v)) {
      settings.penalty.holiday.dates.push(v); el.holidayDate.value = '';
      saveSettings(); renderHolidayList(); onSettingsChanged();
    }
  });

  el.exportBtn.addEventListener('click', exportData);
  el.importBtn.addEventListener('click', () => el.importFile.click());
  el.importFile.addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) importData(f); e.target.value = ''; });

  $('#reset-btn').addEventListener('click', () => {
    if (confirm('Reset income, settings, AND all tracked sessions?')) {
      settings = defaultSettings(); sessions = []; active = null; nudgeLevel = 0;
      activityLimitNudged.clear();
      saveSettings(); saveSessions(); saveActive();
      buildCurrencyOptions(); renderIncomeList(); renderBasisUI(); renderNudgeGoalUI(); renderLimitList(); renderPenaltyUI();
      stopTick(); computeValue(); showScreen('timer-screen');
    }
  });
}

function initReportsControls() {
  $$('.seg-opt', el.periodSeg).forEach(b => b.addEventListener('click', () => { reportPeriod = b.dataset.period; reportOffset = 0; renderReports(); }));
  el.periodPrev.addEventListener('click', () => { reportOffset -= 1; renderReports(); });
  el.periodNext.addEventListener('click', () => { if (reportOffset < 0) { reportOffset += 1; renderReports(); } });
}

function initModalsAndHints() {
  $('#info-btn').addEventListener('click', () => { $('#info-modal').hidden = false; });
  $('#info-close').addEventListener('click', () => { $('#info-modal').hidden = true; });
  $('#info-modal').addEventListener('click', e => { if (e.target.id === 'info-modal') e.target.hidden = true; });
  $('#stop-btn').addEventListener('click', stopActivity);
  el.startBtn.addEventListener('click', () => startActivity(QUICK_START.label, QUICK_START.emoji));

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (isIos && !standalone && localStorage.getItem('tim.iosHint') !== '1') {
    $('#ios-hint').hidden = false;
    $('#ios-hint-close').addEventListener('click', () => { $('#ios-hint').hidden = true; localStorage.setItem('tim.iosHint', '1'); });
  }
}

function initSW() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
  }
}

/* ---------- auth UI + per-user data loading ---------- */
function applyAuthState() {
  const gate = !currentUserId;                       // null → show the portal
  el.authScreen.hidden = !gate;
  document.getElementById('app').hidden = gate;
  document.getElementById('tabbar').hidden = gate;
}
function loadUserData() {
  settings = loadSettings();
  sessions = normalizeSessions(loadJSON(scopedKey('sessions.v1'), []));
  active = loadJSON(scopedKey('active.v1'), null);
  nudgeLevel = 0; activityLimitNudged.clear(); pendingRedirectId = null;
  computeValue();
  buildCurrencyOptions(); renderIncomeList(); renderBasisUI();
  renderNudgeGoalUI(); renderLimitList(); renderPenaltyUI(); renderAccountUI();
  showScreen('timer-screen');
  stopTick();
  if (active) {
    nudgeLevel = Math.floor(((Date.now() - active.startMs) / 1000 * val.perSecond) / Math.max(1, settings.nudgeEvery));
    startTick();
  }
}
async function signUp(name, email, password) {
  email = String(email || '').trim().toLowerCase();
  if (!/.+@.+\..+/.test(email)) throw new Error('Enter a valid email.');
  if (!password || password.length < 4) throw new Error('Password needs at least 4 characters.');
  if (findUserByEmail(email)) throw new Error('An account with that email already exists.');
  const salt = randomSaltHex();
  const hash = await hashPassword(password, salt);
  const user = { id: uid(), name: String(name || '').trim() || email.split('@')[0], email, salt, hash, createdAt: Date.now() };
  const list = loadUsers(); list.push(user); saveUsers(list);
  // offer to carry existing guest data into the new account so it isn't lost
  let guestSessions = [];
  try { const gs = JSON.parse(localStorage.getItem('tim.sessions.v1')); if (Array.isArray(gs)) guestSessions = gs; } catch (_) {}
  const carry = guestSessions.length > 0 &&
    confirm(`Bring your current guest data (${guestSessions.length} tracked session${guestSessions.length > 1 ? 's' : ''}) into this account?`);
  currentUserId = user.id; try { localStorage.setItem(CURRENT_USER_KEY, user.id); } catch (_) {}
  if (carry) {
    try {
      const gSettings = localStorage.getItem('tim.settings.v2');
      if (gSettings != null) localStorage.setItem(scopedKey('settings.v2'), gSettings);
      localStorage.setItem(scopedKey('sessions.v1'), JSON.stringify(guestSessions));
    } catch (_) {}
  }
  loadUserData(); applyAuthState();
}
async function signIn(email, password) {
  const user = findUserByEmail(email);
  if (!user) throw new Error('No account with that email.');
  const hash = await hashPassword(password, user.salt);
  if (hash !== user.hash) throw new Error('Wrong password.');
  currentUserId = user.id; try { localStorage.setItem(CURRENT_USER_KEY, user.id); } catch (_) {}
  loadUserData(); applyAuthState();
}
function continueAsGuest() {
  currentUserId = 'guest'; try { localStorage.setItem(CURRENT_USER_KEY, 'guest'); } catch (_) {}
  loadUserData(); applyAuthState();
}
function signOut() {
  stopTick();                                        // user's data stays saved under their namespace
  currentUserId = null; try { localStorage.removeItem(CURRENT_USER_KEY); } catch (_) {}
  applyAuthState(); showAuthTab('signin');
}
function showAuthTab(which) {
  const signup = which === 'signup';
  $$('#auth-tabs .seg-opt').forEach(b => b.classList.toggle('is-on', b.dataset.auth === which));
  el.authName.hidden = !signup; el.authName.required = signup;
  el.authPassword.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
  el.authPassword.type = 'password';                  // reset reveal state on tab switch
  if (el.authPwToggle) el.authPwToggle.textContent = 'Show';
  el.authSubmit.textContent = signup ? 'Create account' : 'Sign in';
  el.authError.hidden = true; el.authError.textContent = '';
  el.authForm.dataset.mode = which;
}
function initAuth() {
  $$('#auth-tabs .seg-opt').forEach(b => b.addEventListener('click', () => showAuthTab(b.dataset.auth)));
  el.authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = el.authForm.dataset.mode || 'signin';
    el.authError.hidden = true; el.authSubmit.disabled = true;
    try {
      if (mode === 'signup') await signUp(el.authName.value, el.authEmail.value, el.authPassword.value);
      else await signIn(el.authEmail.value, el.authPassword.value);
      el.authForm.reset();
    } catch (err) {
      el.authError.textContent = (err && err.message) || 'Something went wrong.'; el.authError.hidden = false;
    } finally { el.authSubmit.disabled = false; }
  });
  el.authGuest.addEventListener('click', continueAsGuest);
  if (el.authPwToggle) el.authPwToggle.addEventListener('click', () => {
    const showing = el.authPassword.type === 'text';
    el.authPassword.type = showing ? 'password' : 'text';
    el.authPwToggle.textContent = showing ? 'Show' : 'Hide';
  });
  el.accountAction.addEventListener('click', () => {
    if (isSignedIn()) signOut();
    else { currentUserId = null; try { localStorage.removeItem(CURRENT_USER_KEY); } catch (_) {} applyAuthState(); showAuthTab('signin'); }
  });
  showAuthTab('signin');
}
function renderAccountUI() {
  if (!el.accountStatus) return;
  if (isSignedIn()) {
    const u = findUserById(currentUserId);
    el.accountStatus.textContent = 'Signed in as ' + (u ? u.email : 'you');
    el.accountAction.textContent = 'Sign out';
  } else {
    el.accountStatus.textContent = 'Guest — not signed in';
    el.accountAction.textContent = 'Sign in';
  }
}

/* ---------- deep links: ?start=<label> / ?stop (for iOS Shortcuts etc.) ---------- */
function handleDeepLink() {
  if (!currentUserId) return;                         // ignore deep links until past the portal
  let params;
  try { params = new URLSearchParams(location.search); } catch (_) { return; }
  const startVal = params.get('start');
  const stopVal = params.get('stop');
  let acted = false;
  if (stopVal != null) { if (active) stopActivity(); acted = true; }
  if (startVal != null && startVal.trim()) {
    const q = startVal.trim();
    const preset = ACTIVITIES.find(a => a.key !== 'other' &&
      (a.key.toLowerCase() === q.toLowerCase() || a.label.toLowerCase() === q.toLowerCase()));
    if (preset) startActivity(preset.label, preset.emoji);
    else startActivity(q, '🔗');
    acted = true;
  }
  if (acted) {
    try { history.replaceState({}, '', location.pathname); } catch (_) {}  // drop the param so a refresh won't re-trigger
    showScreen('timer-screen');
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopTick(); }
  else { renderTimerScreen(); if (active) startTick(); if (currentScreen === 'reports-screen') renderReports(); }
});

/* ---------- boot ---------- */
{ // self-heal: rewrite sanitized sessions if the stored copy was corrupt or legacy
  const stored = localStorage.getItem(scopedKey('sessions.v1'));
  if (stored != null && stored !== JSON.stringify(sessions)) saveSessions();
}
computeValue();
buildActivityGrid();
initNav();
initSettingsControls();
initReportsControls();
initModalsAndHints();
initRedirectModal();
initEditModal();
initAuth();
initSW();
renderAccountUI();
renderTimerScreen();
applyAuthState();                         // show the portal if nobody is signed in / no guest choice yet
if (currentUserId && active) {           // only run the timer once we're actually in the app
  // resuming a timer left running: don't fire nudges for thresholds already passed
  nudgeLevel = Math.floor(((Date.now() - active.startMs) / 1000 * val.perSecond) / Math.max(1, settings.nudgeEvery));
  startTick();
}
handleDeepLink();
