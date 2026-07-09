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
const botWall = /access denied|request blocked|are you a human|verify you are|captcha|unusual traffic|reference #\d/i;

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
    if (status >= 400 || botWall.test(html)) blocked = true;

    if (reachable && !blocked) {
      // best-effort miles search
      const miles = await firstVisible(page, [
        () => page.getByRole('tab', { name: /pay with miles|redeem|الأميال|استبدال/i }),
        () => page.getByRole('button', { name: /pay with miles|redeem|الأميال|استبدال/i }),
        () => page.getByText(/pay with miles|redeem|الأميال|استبدال/i),
      ]);
      if (miles) { await miles.click().catch(() => {}); await page.waitForTimeout(1000); }

      for (const [which, code] of [['from', FROM], ['to', TO]]) {
        const lab = which === 'from' ? /from|origin|من|المغادرة/i : /to|destination|إلى|الوصول/i;
        const box = await firstVisible(page, [
          () => page.getByLabel(lab), () => page.getByPlaceholder(lab),
          () => page.locator(`input[name*="${which}" i], input[id*="${which}" i]`),
        ]);
        if (box) {
          await box.click().catch(() => {}); await box.fill('').catch(() => {});
          await box.type(code, { delay: 100 }); await page.waitForTimeout(1200);
          const opt = await firstVisible(page, [() => page.getByRole('option'), () => page.locator('[role="option"], li[class*="option" i]')]);
          if (opt) await opt.click().catch(() => {}); else await page.keyboard.press('Enter').catch(() => {});
        }
      }
      const dateBox = await firstVisible(page, [
        () => page.getByLabel(/depart|date|التاريخ|المغادرة/i),
        () => page.locator('input[name*="depart" i], input[id*="depart" i], input[type="date"]'),
      ]);
      if (dateBox) { await dateBox.click().catch(() => {}); await dateBox.fill(DATE).catch(() => {}); await page.keyboard.press('Escape').catch(() => {}); }

      const go = await firstVisible(page, [
        () => page.getByRole('button', { name: /search|find flights?|بحث|عرض/i }),
        () => page.getByText(/search|find flights?|بحث|عرض/i),
      ]);
      if (go) { await go.click().catch(() => {}); }
      await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(3500);

      const afterHtml = (await page.content().catch(() => '')).slice(0, 200000);
      if (loginWall.test(afterHtml)) needLogin = true;
      if (botWall.test(afterHtml)) blocked = true;

      const loc = page.locator('[class*="flight" i][class*="card" i], [data-testid*="flight" i], [class*="fare" i][class*="option" i], li[class*="flight" i]');
      const n = await loc.count().catch(() => 0);
      for (let i = 0; i < Math.min(n, 40); i++) {
        const t = (await loc.nth(i).innerText().catch(() => '')).trim();
        if (t) cards.push(t);
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
