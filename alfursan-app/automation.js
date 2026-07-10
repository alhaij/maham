// automation.js — the Playwright engine that actually drives saudia.com.
// Exposed to the server as: getStatus(), login(), search(params).
// One shared persistent browser is reused across requests (a mutex serialises
// them, since a single Saudia session can't run two searches at once).

import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const CFG = {
  siteUrl: process.env.SAUDIA_URL || 'https://www.saudia.com/',
  profileDir: path.join(__dirname, 'user-profile'),
  shotDir: path.join(__dirname, 'screenshots'),
  headless: process.env.HEADLESS === 'true',
  timeout: 45000,
  loggedIn: [/alfursan/i, /my account/i, /log ?out/i, /sign ?out/i, /الفرسان/i, /تسجيل الخروج/i],
  milesToggle: [/pay with miles/i, /redeem/i, /use miles/i, /استبدال/i, /الأميال/i],
  searchBtn: [/search/i, /find flights?/i, /show flights?/i, /بحث/i, /عرض/i],
  cabins: {
    economy:  { pick: /economy|guest|الاقتصادية|السياحية/i, seen: /economy|الاقتصادية|السياحية/i },
    business: { pick: /business|رجال ?الأعمال/i,           seen: /business|رجال ?الأعمال/i },
    first:    { pick: /first|الأولى/i,                     seen: /first|الأولى/i },
  },
  availHints: [/mile/i, /ميل/i, /point/i, /نقاط/i, /award/i, /استبدال/i, /الأميال/i],
  soldOut: [/sold ?out|not available|unavailable|no seats|غير متاح|غير متوفر|نفد|لا توجد مقاعد/i],
};

let _ctx = null;      // persistent browser context
let _page = null;
let _busy = false;    // simple mutex
let _loggedIn = false; // sticky: once logged in, stay logged in (no re-login loop)

fs.mkdirSync(CFG.shotDir, { recursive: true });

async function ctx() {
  if (_ctx) return _ctx;
  const { chromium } = await import('playwright');
  // Anti-detection: drive the REAL Google Chrome (genuine fingerprint), hide the
  // automation flags, and remove navigator.webdriver — so Saudia doesn't flag
  // the session as a bot and log the user straight back out.
  const opts = {
    headless: CFG.headless,
    viewport: { width: 1360, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--no-default-browser-check'],
    ignoreDefaultArgs: ['--enable-automation'],
  };
  try {
    _ctx = await chromium.launchPersistentContext(CFG.profileDir, { ...opts, channel: 'chrome' });
    console.log('  (using your installed Google Chrome)');
  } catch {
    _ctx = await chromium.launchPersistentContext(CFG.profileDir, opts);
    console.log('  (Chrome not found — using bundled Chromium)');
  }
  await _ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  _page = _ctx.pages()[0] || (await _ctx.newPage());
  _page.setDefaultTimeout(CFG.timeout);
  return _ctx;
}

async function firstVisible(page, builders) {
  for (const b of builders) {
    try {
      const loc = b();
      if (await loc.first().isVisible({ timeout: 2000 }).catch(() => false)) return loc.first();
    } catch {}
  }
  return null;
}
async function anyText(page, res) {
  for (const re of res) {
    if (await page.getByText(re).first().isVisible({ timeout: 1200 }).catch(() => false)) return true;
  }
  return false;
}
async function shot(name) {
  const f = path.join(CFG.shotDir, `${name}.png`);
  try { await _page.screenshot({ path: f, fullPage: true }); } catch {}
  return f;
}

export async function getStatus() {
  await ctx();
  // Never reload while a search is running or once we already know we're in —
  // reloading the window is what used to kick the user out.
  if (_busy || _loggedIn) return { loggedIn: _loggedIn, busy: _busy, headless: CFG.headless };
  // Only navigate if we're not already sitting on Saudia (first check).
  if (!/saudia\.com/i.test(_page.url() || '')) {
    await _page.goto(CFG.siteUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await _page.waitForTimeout(1500);
  }
  if (await anyText(_page, CFG.loggedIn)) _loggedIn = true;
  return { loggedIn: _loggedIn, busy: _busy, headless: CFG.headless };
}

// Open Saudia and (optionally) type credentials, then leave the window for the
// user to finish (CAPTCHA / OTP). Requires HEADLESS=false the first time.
export async function login() {
  await ctx();
  if (!/saudia\.com/i.test(_page.url() || '')) {
    await _page.goto(CFG.siteUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await _page.waitForTimeout(1500);
  }
  if (await anyText(_page, CFG.loggedIn)) { _loggedIn = true; return { loggedIn: true }; }

  const user = process.env.ALFURSAN_USER, pass = process.env.ALFURSAN_PASS;
  const link = await firstVisible(_page, [
    () => _page.getByRole('link', { name: /log ?in|sign ?in|تسجيل الدخول/i }),
    () => _page.getByRole('button', { name: /log ?in|sign ?in|تسجيل الدخول/i }),
    () => _page.getByText(/log ?in|sign ?in|تسجيل الدخول/i),
  ]);
  if (link) { await link.click().catch(() => {}); await _page.waitForTimeout(1500); }
  if (user && pass) {
    const u = await firstVisible(_page, [
      () => _page.getByLabel(/email|member|username|الفرسان|البريد/i),
      () => _page.getByPlaceholder(/email|member|username|الفرسان|البريد/i),
      () => _page.locator('input[type="email"], input[name*="user" i], input[name*="member" i]'),
    ]);
    const p = await firstVisible(_page, [
      () => _page.getByLabel(/password|كلمة المرور/i),
      () => _page.getByPlaceholder(/password|كلمة المرور/i),
      () => _page.locator('input[type="password"]'),
    ]);
    if (u && p) {
      await u.fill(user); await p.fill(pass);
      const btn = await firstVisible(_page, [() => _page.getByRole('button', { name: /log ?in|sign ?in|continue|تسجيل الدخول/i })]);
      if (btn) await btn.click().catch(() => {});
      await _page.waitForTimeout(4000);
    }
  }
  const loggedIn = await anyText(_page, CFG.loggedIn);
  if (loggedIn) _loggedIn = true;
  await shot('login');
  return { loggedIn, note: loggedIn ? 'logged in' : 'finish login in the browser window on the computer running this server (CAPTCHA/OTP)' };
}

// Saudia's booking widget is Angular Material (calibrated from the live DOM):
// From = #mat-input-4, To = #mat-input-5, suggestions are <mat-option>.
async function fillCity(which, code) {
  const sel = which === 'from' ? '#mat-input-4' : '#mat-input-5';
  const labels = which === 'from' ? /from|origin|من|المغادرة/i : /to|destination|إلى|الوصول/i;
  const box = await firstVisible(_page, [
    () => _page.locator(sel),
    () => _page.getByPlaceholder(labels),
    () => _page.getByLabel(labels),
    () => _page.locator(`input[name*="${which}" i], input[id*="${which}" i]`),
  ]);
  if (!box) { await shot(`no-${which}`); return false; }
  await box.click().catch(() => {});
  await box.fill('').catch(() => {});
  await box.type(code, { delay: 120 });
  await _page.waitForTimeout(1600);
  const opt = await firstVisible(_page, [
    () => _page.locator('mat-option'),
    () => _page.getByRole('option'),
    () => _page.locator('[role="option"], li[class*="option" i]'),
  ]);
  if (opt) await opt.click().catch(() => {}); else await _page.keyboard.press('Enter').catch(() => {});
  await _page.waitForTimeout(400);
  return true;
}

// Material / Saudia fare calendar: open it, page to the month, click the day.
// Saudia's day cells render as "15\n621" (day + fare), so we also match by the
// leading day number when the standard aria-label isn't present.
async function pickDate(date) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const d = new Date(date + 'T00:00:00');
  const mon = months[d.getMonth()], day = d.getDate(), year = d.getFullYear();
  const calShown = () => _page.locator('.mat-calendar-body-cell, [role="gridcell"]').first().isVisible({ timeout: 1200 }).catch(() => false);

  if (!(await calShown())) {
    const opener = await firstVisible(_page, [
      () => _page.locator('#mat-input-6'),
      () => _page.getByText('event').first(),
      () => _page.getByText(/^Depart|Departure|Select date|Departing/i),
    ]);
    if (opener) { await opener.click().catch(() => {}); await _page.waitForTimeout(1000); }
  }

  for (let i = 0; i < 18; i++) {
    let cell = await firstVisible(_page, [
      () => _page.locator(`[aria-label="${mon} ${day}, ${year}"]`),
      () => _page.locator(`[aria-label*="${mon} ${day}"][aria-label*="${year}"]`),
    ]);
    if (!cell) {
      const cells = _page.locator('.mat-calendar-body-cell, [role="gridcell"], button');
      const cnt = await cells.count().catch(() => 0);
      for (let j = 0; j < Math.min(cnt, 400); j++) {
        const t = (await cells.nth(j).innerText().catch(() => '')).trim();
        if (t.split(/[\s\n]+/)[0] === String(day) && await cells.nth(j).isVisible().catch(() => false)) { cell = cells.nth(j); break; }
      }
    }
    if (cell) { await cell.click().catch(() => {}); await _page.waitForTimeout(500); return true; }
    const next = await firstVisible(_page, [() => _page.getByRole('button', { name: /next month/i }), () => _page.getByText('Next month')]);
    if (next) { await next.click().catch(() => {}); await _page.waitForTimeout(400); } else break;
  }
  return false;
}

async function pickCabin(cabin) {
  const re = CFG.cabins[cabin]?.pick; if (!re) return;
  const opener = await firstVisible(_page, [
    () => _page.getByRole('button', { name: /class|cabin|economy|business|الدرجة|المقصورة/i }),
    () => _page.getByText(/class|cabin|الدرجة|المقصورة/i),
  ]);
  if (opener) { await opener.click().catch(() => {}); await _page.waitForTimeout(600); }
  const opt = await firstVisible(_page, [
    () => _page.getByRole('option', { name: re }),
    () => _page.getByRole('radio', { name: re }),
    () => _page.getByText(re),
  ]);
  if (opt) await opt.click().catch(() => {});
  await _page.keyboard.press('Escape').catch(() => {});
}

function evaluate(cards, cabin) {
  const seen = CFG.cabins[cabin]?.seen;
  const matches = cards.filter((t) =>
    CFG.availHints.some((r) => r.test(t)) &&
    !CFG.soldOut.some((r) => r.test(t)) &&
    (seen ? seen.test(t) : true));
  return { available: matches.length > 0, matches };
}

// The main entry the server calls.
export async function search(params) {
  const { from, to, date, ret = '', adults = 1, cabin = 'economy' } = params;
  if (_busy) return { ok: false, error: 'A search is already running — try again in a moment.' };
  _busy = true;
  try {
    await ctx();
    await _page.goto(CFG.siteUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await _page.waitForTimeout(2000);

    if (!_loggedIn) {
      return { ok: false, needLogin: true, error: 'Not logged into Alfursan yet. Log in once on the computer, then retry.' };
    }

    // accept the cookie banner if present
    const cookie = await firstVisible(_page, [() => _page.getByRole('button', { name: /yes, i accept|accept all|accept|موافق/i })]);
    if (cookie) { await cookie.click().catch(() => {}); await _page.waitForTimeout(500); }

    // trip type
    if (!ret) {
      const oneWay = await firstVisible(_page, [() => _page.getByText('One way', { exact: true }), () => _page.getByRole('radio', { name: /one way/i })]);
      if (oneWay) { await oneWay.click().catch(() => {}); await _page.waitForTimeout(400); }
    }

    // switch to "Book with Miles" (logged in, this shows award / miles pricing)
    const miles = await firstVisible(_page, [
      () => _page.getByText('Book with Miles', { exact: true }),
      () => _page.getByText(/book with miles/i),
      () => _page.getByRole('button', { name: CFG.milesToggle[0] }),
      () => _page.getByText(CFG.milesToggle[0]),
    ]);
    if (miles) { await miles.click().catch(() => {}); await _page.waitForTimeout(900); }

    const okFrom = await fillCity('from', from);
    const okTo = await fillCity('to', to);

    const okDate = await pickDate(date);
    await pickCabin(cabin);

    const go = await firstVisible(_page, [
      () => _page.getByRole('button', { name: /search flights/i }),
      () => _page.getByText(/Search Flights/i),
      ...CFG.searchBtn.map((re) => () => _page.getByRole('button', { name: re })),
    ]);
    if (go) await go.click().catch(() => {});
    await _page.waitForLoadState('networkidle', { timeout: CFG.timeout }).catch(() => {});
    await _page.waitForTimeout(4000);

    const cardsLoc = _page.locator(
      '[class*="flight" i][class*="card" i], [data-testid*="flight" i], [class*="fare" i][class*="option" i], li[class*="flight" i]'
    );
    const n = await cardsLoc.count().catch(() => 0);
    const cards = [];
    for (let i = 0; i < Math.min(n, 40); i++) {
      const t = (await cardsLoc.nth(i).innerText().catch(() => '')).replace(/\s+\n/g, '\n').trim();
      if (t) cards.push(t);
    }
    const { available, matches } = evaluate(cards, cabin);
    const shotFile = await shot(`search_${date}_${from}-${to}_${cabin}`);
    return {
      ok: true, available, cabin, from, to, date, ret, adults,
      count: cards.length, flights: cards, matches,
      filled: { from: okFrom, to: okTo, date: okDate },
      calibrated: okFrom && okTo && okDate && cards.length > 0,
      screenshot: path.basename(shotFile),
    };
  } catch (e) {
    await shot('error');
    return { ok: false, error: e.message };
  } finally {
    _busy = false;
  }
}

export async function shutdown() { try { await _ctx?.close(); } catch {} _ctx = null; _page = null; }
