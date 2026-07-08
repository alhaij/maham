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

fs.mkdirSync(CFG.shotDir, { recursive: true });

async function ctx() {
  if (_ctx) return _ctx;
  const { chromium } = await import('playwright');
  _ctx = await chromium.launchPersistentContext(CFG.profileDir, {
    headless: CFG.headless,
    viewport: { width: 1360, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
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
  await _page.goto(CFG.siteUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await _page.waitForTimeout(2000);
  const loggedIn = await anyText(_page, CFG.loggedIn);
  return { loggedIn, busy: _busy, headless: CFG.headless };
}

// Open Saudia and (optionally) type credentials, then leave the window for the
// user to finish (CAPTCHA / OTP). Requires HEADLESS=false the first time.
export async function login() {
  await ctx();
  await _page.goto(CFG.siteUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await _page.waitForTimeout(2000);
  if (await anyText(_page, CFG.loggedIn)) return { loggedIn: true };

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
  await shot('login');
  return { loggedIn, note: loggedIn ? 'logged in' : 'finish login in the browser window on the computer running this server (CAPTCHA/OTP)' };
}

async function fillCity(which, code) {
  const labels = which === 'from'
    ? /from|origin|departing|leaving|من|المغادرة/i
    : /to|destination|arriving|going|إلى|الوصول/i;
  const box = await firstVisible(_page, [
    () => _page.getByLabel(labels),
    () => _page.getByPlaceholder(labels),
    () => _page.locator(`input[name*="${which}" i], input[id*="${which}" i]`),
  ]);
  if (!box) { await shot(`no-${which}`); return false; }
  await box.click().catch(() => {});
  await box.fill('').catch(() => {});
  await box.type(code, { delay: 110 });
  await _page.waitForTimeout(1400);
  const opt = await firstVisible(_page, [
    () => _page.getByRole('option'),
    () => _page.locator('[role="option"], li[class*="option" i], .autocomplete-suggestion'),
  ]);
  if (opt) await opt.click().catch(() => {}); else await _page.keyboard.press('Enter').catch(() => {});
  return true;
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

    if (!(await anyText(_page, CFG.loggedIn))) {
      return { ok: false, needLogin: true, error: 'Not logged into Alfursan yet. Log in once on the computer, then retry.' };
    }

    // switch to miles mode
    const miles = await firstVisible(_page, [
      () => _page.getByRole('tab', { name: CFG.milesToggle[0] }),
      () => _page.getByRole('button', { name: CFG.milesToggle[0] }),
      () => _page.getByText(CFG.milesToggle[0]),
      () => _page.getByText(CFG.milesToggle[1]),
    ]);
    if (miles) { await miles.click().catch(() => {}); await _page.waitForTimeout(900); }

    const okFrom = await fillCity('from', from);
    const okTo = await fillCity('to', to);

    const dateBox = await firstVisible(_page, [
      () => _page.getByLabel(/depart|date|going|التاريخ|المغادرة/i),
      () => _page.getByPlaceholder(/depart|date|going|التاريخ/i),
      () => _page.locator('input[name*="depart" i], input[id*="depart" i], input[type="date"]'),
    ]);
    if (dateBox) {
      await dateBox.click().catch(() => {});
      await dateBox.fill(date).catch(async () => { await _page.keyboard.type(date).catch(() => {}); });
      await _page.keyboard.press('Escape').catch(() => {});
    }

    await pickCabin(cabin);

    const go = await firstVisible(_page,
      CFG.searchBtn.map((re) => () => _page.getByRole('button', { name: re }))
        .concat(CFG.searchBtn.map((re) => () => _page.getByText(re))));
    if (go) await go.click().catch(() => {});
    await _page.waitForLoadState('networkidle', { timeout: CFG.timeout }).catch(() => {});
    await _page.waitForTimeout(3500);

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
      calibrated: okFrom && okTo && cards.length > 0,
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
