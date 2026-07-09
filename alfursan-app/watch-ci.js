#!/usr/bin/env node
// watch-ci.js — headless probe + watcher that runs on GitHub's servers.
// It (1) checks whether saudia.com is even reachable from a GitHub runner,
// (2) attempts a miles (award) search, (3) reports a clear PROBE RESULT to the
// logs, and (4) pushes an ntfy notification if award seats appear (or, in DIAG
// mode, a status note). This is how we learn if the server-side path is viable
// at all, since Saudia may block datacenter IPs or require a login.
import { chromium } from 'playwright';

const FROM = process.env.WATCH_FROM, TO = process.env.WATCH_TO;
const DATE = process.env.WATCH_DATE, CABIN = (process.env.WATCH_CABIN || 'economy').toLowerCase();
const TOPIC = process.env.NTFY_TOPIC || '';
const DIAG = process.env.DIAG === '1';
const SITE = process.env.SAUDIA_URL || 'https://www.saudia.com/';

const availHints = [/mile/i, /ميل/i, /point/i, /نقاط/i, /award/i, /استبدال/i, /الأميال/i];
const soldOut = [/sold ?out|not available|unavailable|no seats|غير متاح|غير متوفر|نفد|لا توجد مقاعد/i];
const cabins = { economy: /economy|guest|الاقتصادية|السياحية/i, business: /business|رجال ?الأعمال/i, first: /first|الأولى/i };
const loginWall = /log ?in to (see|view|book)|sign in to|please log ?in|سجّل الدخول|تسجيل الدخول لعرض|يجب تسجيل الدخول/i;
const botWall = /access denied|request unsuccessful|pardon our interruption|are you a human|unusual traffic|reference #\d{2}/i;
function botMatch(html) { const m = html.match(botWall); if (m) { console.log('BOT-WALL matched:', JSON.stringify(html.slice(Math.max(0, m.index - 30), m.index + 70))); return true; } return false; }

async function ntfy(title, body, tags = 'airplane', priority = 'default') {
  if (!TOPIC) { console.log('[ntfy] no NTFY_TOPIC — skipping push'); return; }
  try {
    const r = await fetch('https://ntfy.sh/' + TOPIC, {
      method: 'POST', headers: { Title: title, Tags: tags, Priority: priority }, body,
    });
    console.log('[ntfy]', r.ok ? 'sent: ' + title : 'error ' + r.status);
  } catch (e) { console.log('[ntfy] failed:', e.message); }
}

async function firstVisible(page, builders) {
  for (const b of builders) {
    try { const l = b(); if (await l.first().isVisible({ timeout: 2000 }).catch(() => false)) return l.first(); } catch {}
  }
  return null;
}

// Report the live page structure to the logs so selectors can be calibrated
// without seeing the screen (the artifact download is firewalled).
async function dump(page, label) {
  try {
    const info = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const inputs = [...document.querySelectorAll('input,select')].filter(vis).slice(0, 40)
        .map((e) => ({ tag: e.tagName, type: e.type || '', name: e.name || '', id: e.id || '', ph: e.placeholder || '', al: e.getAttribute('aria-label') || '' }));
      const buttons = [...document.querySelectorAll('button,[role="button"],a')].filter(vis)
        .map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim()).filter((t) => t && t.length < 40).slice(0, 60);
      const milesTxt = [...document.querySelectorAll('*')].filter(vis)
        .map((e) => (e.innerText || '').trim()).filter((t) => /mile|redeem|الأميال|استبدال/i.test(t) && t.length < 60).slice(0, 8);
      return { title: document.title, url: location.href, iframes: document.querySelectorAll('iframe').length, inputs, buttons: [...new Set(buttons)], milesTxt: [...new Set(milesTxt)] };
    });
    console.log(`\n===== DOM DUMP [${label}] =====`);
    console.log('title  :', info.title);
    console.log('url    :', info.url);
    console.log('iframes:', info.iframes);
    console.log('inputs :', JSON.stringify(info.inputs));
    console.log('buttons:', JSON.stringify(info.buttons));
    console.log('milesTx:', JSON.stringify(info.milesTxt));
    console.log('================================\n');
  } catch (e) { console.log(`[dump ${label}] failed:`, e.message); }
}

// Type into a Material autocomplete and pick the first suggestion.
async function fillAuto(page, sel, value) {
  const box = page.locator(sel);
  if (!(await box.count().catch(() => 0))) { console.log('field missing:', sel); return false; }
  await box.click().catch(() => {});
  await box.fill('').catch(() => {});
  await box.type(value, { delay: 130 });
  await page.waitForTimeout(1800);
  const opt = await firstVisible(page, [() => page.locator('mat-option'), () => page.locator('[role="option"]')]);
  if (opt) {
    const t = (await opt.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    await opt.click().catch(() => {});
    console.log(`autocomplete ${value} -> "${t.slice(0, 50)}"`);
    await page.waitForTimeout(500);
    return true;
  }
  console.log(`no autocomplete option for ${value} in ${sel}`);
  return false;
}

// Drive the Material datepicker: open it, page to the target month, click the day.
async function pickDate(page, dateStr) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const d = new Date(dateStr + 'T00:00:00');
  const mon = months[d.getMonth()], day = d.getDate(), year = d.getFullYear();

  const calShown = () => page.locator('.mat-calendar-body-cell, [role="gridcell"]').first().isVisible({ timeout: 1500 }).catch(() => false);

  // Open the calendar if it isn't already.
  if (!(await calShown())) {
    const opener = await firstVisible(page, [
      () => page.locator('#mat-input-6'),
      () => page.locator('#mat-input-7'),
      () => page.getByText('event').first(),
      () => page.getByText(/^Departure$|^Depart$|Select date|Departing/i),
    ]);
    if (opener) { await opener.click().catch(() => {}); await page.waitForTimeout(1200); }
  }
  const open = await calShown();
  console.log('calendar open:', open);

  // Report the real cell/header format so we can see what Saudia uses.
  try {
    const info = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.mat-calendar-body-cell, [role="gridcell"]')].slice(0, 10)
        .map((e) => e.getAttribute('aria-label') || e.textContent.trim());
      const hdr = document.querySelector('.mat-calendar-period-button, [class*="period-button"]');
      return { header: hdr ? hdr.textContent.trim() : '', cells };
    });
    console.log('calendar header:', info.header, '| cells:', JSON.stringify(info.cells));
  } catch (e) { console.log('cal dump failed:', e.message); }

  // Navigate to the target month and click the day (several label formats).
  for (let i = 0; i < 24; i++) {
    const cell = await firstVisible(page, [
      () => page.locator(`[aria-label="${mon} ${day}, ${year}"]`),
      () => page.locator(`[aria-label*="${mon} ${day}"][aria-label*="${year}"]`),
      () => page.locator(`[aria-label*="${day} ${mon} ${year}"]`),
      () => page.getByRole('gridcell', { name: new RegExp(`(^|\\D)${day}(\\D|$)`) }).filter({ hasText: new RegExp(`^\\s*${day}\\s*$`) }),
    ]);
    if (cell) {
      await cell.click().catch(() => {});
      console.log(`picked date ${mon} ${day}, ${year}`);
      await page.waitForTimeout(500);
      return true;
    }
    const next = await firstVisible(page, [() => page.getByRole('button', { name: /next month/i }), () => page.getByText('Next month')]);
    if (next) { await next.click().catch(() => {}); await page.waitForTimeout(400); } else break;
  }
  console.log('could not pick date', mon, day, year);
  return false;
}

// On the results page, sample any price / miles / cabin text so we can learn
// the card structure and see whether miles pricing shows without login.
async function dumpResults(page) {
  try {
    const info = await page.evaluate(() => {
      const leaf = [...document.querySelectorAll('*')].filter((e) => e.childElementCount === 0);
      const txt = leaf.map((e) => (e.innerText || '').trim())
        .filter((t) => t && t.length < 40 && /SAR|SR |miles|mile|ميل|نقاط|Economy|Business|First|\b\d{1,3},\d{3}\b|:\d\d/i.test(t));
      return { url: location.href, samples: [...new Set(txt)].slice(0, 30) };
    });
    console.log('RESULTS url    :', info.url);
    console.log('RESULTS samples:', JSON.stringify(info.samples));
  } catch (e) { console.log('dumpResults failed:', e.message); }
}

(async () => {
  if (!FROM || !TO || !DATE) { console.error('Missing WATCH_FROM / WATCH_TO / WATCH_DATE'); process.exit(1); }
  console.log(`\n=== Alfursan miles probe: ${FROM} -> ${TO}  ${DATE}  ${CABIN} ===\n`);

  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    viewport: { width: 1360, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);

  let reachable = false, status = 0, blocked = false, needLogin = false, cards = [];
  try {
    const resp = await page.goto(SITE, { waitUntil: 'domcontentloaded' }).catch((e) => { console.log('goto error:', e.message); return null; });
    reachable = !!resp;
    status = resp ? resp.status() : 0;
    console.log(`HTTP ${status}  final=${page.url()}`);
    await page.waitForTimeout(3500);
    const html = (await page.content().catch(() => '')).slice(0, 200000);
    if (status >= 400 || botMatch(html)) blocked = true;
    await dump(page, 'landing');

    if (reachable && !blocked) {
      // Saudia = Angular Material booking widget (calibrated from the live DOM).
      // 1) accept cookies if the banner is up
      const cookie = await firstVisible(page, [() => page.getByRole('button', { name: /yes, i accept|accept all|accept|موافق/i })]);
      if (cookie) { await cookie.click().catch(() => {}); await page.waitForTimeout(600); console.log('accepted cookies'); }

      // 2) One way
      const oneWay = await firstVisible(page, [() => page.getByText('One way', { exact: true }), () => page.getByRole('radio', { name: /one way/i })]);
      if (oneWay) { await oneWay.click().catch(() => {}); await page.waitForTimeout(500); console.log('set One way'); }

      // 3) Book with Miles
      const miles = await firstVisible(page, [() => page.getByText('Book with Miles', { exact: true }), () => page.getByText(/book with miles/i)]);
      if (miles) { await miles.click().catch(() => {}); await page.waitForTimeout(900); console.log('clicked Book with Miles'); }
      else console.log('Book with Miles toggle not found');

      // 4) From / To via Material autocomplete
      await fillAuto(page, '#mat-input-4', FROM);
      await fillAuto(page, '#mat-input-5', TO);

      // 5) Departure date via the Material calendar
      await pickDate(page, DATE);

      // 6) Search Flights
      const go = await firstVisible(page, [
        () => page.getByRole('button', { name: /search flights/i }),
        () => page.getByText(/Search Flights/i),
      ]);
      if (go) { await go.click().catch(() => {}); console.log('clicked Search Flights'); }
      else console.log('Search Flights button not found');

      await page.waitForTimeout(6000);
      await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(2500);

      const afterHtml = (await page.content().catch(() => '')).slice(0, 300000);
      if (loginWall.test(afterHtml)) needLogin = true;
      if (botMatch(afterHtml)) blocked = true;
      const resultsUrl = page.url();
      const navigated = !/^https?:\/\/[^/]+\/?$/.test(resultsUrl);
      console.log('post-search url:', resultsUrl, '| navigated to results page:', navigated);
      const pwVisible = await page.locator('input[type="password"]:visible').first().isVisible({ timeout: 1000 }).catch(() => false);
      if (pwVisible) console.log('note: a password field is visible after search (possible login prompt)');
      await dump(page, 'results');
      await dumpResults(page);

      const loc = page.locator('[class*="flight" i], [class*="fare" i], [class*="result" i], [data-testid*="flight" i], mat-card, [class*="journey" i]');
      const n = await loc.count().catch(() => 0);
      console.log('candidate result nodes:', n);
      for (let i = 0; i < Math.min(n, 40); i++) {
        const t = (await loc.nth(i).innerText().catch(() => '')).replace(/\s+\n/g, '\n').trim();
        if (t && t.length > 8) cards.push(t);
      }
    }
  } catch (e) {
    console.log('probe error:', e.message);
  }
  await page.screenshot({ path: 'watch-shot.png', fullPage: true }).catch(() => {});
  await browser.close();

  const seen = cabins[CABIN];
  const matches = cards.filter((t) => availHints.some((r) => r.test(t)) && !soldOut.some((r) => r.test(t)) && (seen ? seen.test(t) : true));
  const available = matches.length > 0;

  console.log('\n────────── PROBE RESULT ──────────');
  console.log('reachable       :', reachable);
  console.log('http status     :', status);
  console.log('blocked by bot  :', blocked);
  console.log('login required  :', needLogin);
  console.log('flight cards    :', cards.length);
  console.log('miles matches   :', matches.length);
  console.log('VERDICT         :',
    blocked ? 'BLOCKED — Saudia refused the GitHub server (this path is not viable)'
    : !reachable ? 'UNREACHABLE — could not open saudia.com'
    : needLogin ? 'LOGIN REQUIRED — award search needs a signed-in session (CI cannot do CAPTCHA)'
    : available ? 'AWARD SEATS FOUND'
    : cards.length ? 'reachable, searched, no clear miles seats for this cabin'
    : 'reachable but no results captured (selectors may need tuning)');
  console.log('──────────────────────────────────\n');

  if (available) await ntfy(`🎉 مقاعد أميال: ${FROM}→${TO}`, `${DATE} · ${CABIN}\n\n` + matches.slice(0, 2).join('\n—\n'), 'tada', 'high');
  else if (DIAG && blocked) await ntfy('⚠ السعودية حجبت المراقب', 'موقع السعودية منع الوصول الآلي من خوادم GitHub — هذا المسار غير صالح.', 'warning', 'high');
  else if (DIAG && needLogin) await ntfy('⚠ يحتاج تسجيل دخول', 'بحث الأميال يتطلب حسابًا مسجّلًا، والمراقب الآلي ما يقدر يتخطى الكابتشا.', 'warning', 'default');
})();
