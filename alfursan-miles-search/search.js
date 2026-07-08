#!/usr/bin/env node
/**
 * Alfursan Miles Search
 * ---------------------
 * Opens Saudia (saudia.com) in a real Chrome window, makes sure you are
 * logged into your Alfursan account, then searches AWARD (miles) availability
 * for a date + destination you give on the command line — no cash fares.
 *
 * Usage:
 *   node search.js --from JED --to DXB --date 2026-08-15
 *   node search.js --from RUH --to LHR --date 2026-09-01 --return 2026-09-10 --adults 2
 *   node search.js --from JED --to CAI --date 2026-08-15 --headful   (watch it work)
 *
 * First run: a Chrome window opens. Log into Alfursan by hand (this also
 * handles CAPTCHA / OTP). Your session is saved in ./user-profile so later
 * runs skip the login. Nothing about your account leaves your computer.
 */

import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

// dotenv and playwright are loaded lazily inside main() so that --help and
// argument validation work even before `npm install` has been run.
try { (await import('dotenv')).default.config(); } catch {}

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

/* ============================================================
 * CONFIG — the parts most likely to need tweaking live in here.
 * If a run fails on a step, adjust the matching entry below.
 * Locators use forgiving, text-based matching so small site
 * changes usually don't break them.
 * ============================================================ */
const CONFIG = {
  siteUrl: process.env.SAUDIA_URL || 'https://www.saudia.com/',
  profileDir: path.join(__dirname, 'user-profile'),
  screenshotDir: path.join(__dirname, 'screenshots'),
  resultsDir: path.join(__dirname, 'results'),
  timeoutMs: 45000,

  // Text used to detect / toggle the "pay with miles" (redeem) mode.
  milesToggleText: [/pay with miles/i, /redeem/i, /use miles/i, /استبدال/i, /الأميال/i],
  // Text that signals we're logged in (an account / member area link).
  loggedInText: [/alfursan/i, /my account/i, /log ?out/i, /sign ?out/i, /الفرسان/i, /تسجيل الخروج/i],
  // Text on the search / find-flights submit button.
  searchButtonText: [/search/i, /find flights?/i, /show flights?/i, /بحث/i, /عرض/i],
  // Cabin classes: how to pick them in the widget + how to spot them in results.
  cabins: {
    economy:  { pick: /economy|guest|الاقتصادية|السياحية/i, seen: /economy|الاقتصادية|السياحية/i },
    business: { pick: /business|رجال ?الأعمال/i,           seen: /business|رجال ?الأعمال/i },
    first:    { pick: /first|الأولى/i,                     seen: /first|الأولى/i },
  },
  // Words that mean "award seats are actually available" vs "not".
  availableHints: [/mile/i, /ميل/i, /point/i, /نقاط/i, /award/i, /استبدال/i, /الأميال/i],
  soldOutHints: [/sold ?out|not available|unavailable|no seats|غير متاح|غير متوفر|نفد|لا توجد مقاعد/i],
};

/* ---------------- CLI args ---------------- */
function parseArgs(argv) {
  const a = { adults: Number(process.env.ADULTS || 1), headful: false, cabin: 'economy', watch: 0 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case '--from': a.from = v?.toUpperCase(); i++; break;
      case '--to': a.to = v?.toUpperCase(); i++; break;
      case '--date': a.date = v; i++; break;
      case '--return': a.ret = v; i++; break;
      case '--adults': a.adults = Number(v); i++; break;
      case '--cabin': a.cabin = (v || 'economy').toLowerCase(); i++; break;
      case '--watch': a.watch = Number(v || 15); i++; break;
      case '--headful': a.headful = true; break;
      case '--help': case '-h': a.help = true; break;
    }
  }
  if (!CONFIG.cabins[a.cabin]) a.cabin = 'economy';
  return a;
}

function help() {
  console.log(`
Alfursan Miles Search

  node search.js --from <IATA> --to <IATA> --date <YYYY-MM-DD> [options]

Options:
  --from    Origin airport code       (e.g. JED, RUH, DMM)
  --to      Destination airport code  (e.g. DXB, LHR, CAI)
  --date    Departure date            (YYYY-MM-DD)
  --return  Return date (optional; omit for one-way)
  --adults  Passengers (default 1)
  --cabin   economy | business | first   (default economy)
  --watch   N   keep checking every N minutes and ALERT when award
                seats appear for the chosen cabin (e.g. --watch 15)
  --headful Show the browser window (default: it is shown anyway on first login)
  --help    This help

Examples:
  node search.js --from JED --to DXB --date 2026-08-15
  node search.js --from RUH --to LHR --date 2026-09-01 --return 2026-09-10 --adults 2
  node search.js --from JED --to LHR --date 2026-09-01 --cabin business --watch 15

Alerts (optional): put a Telegram bot token + chat id in .env and a message
is pushed to your PHONE the moment award seats show up. Without them, the
watcher just beeps and prints in the terminal.
`);
}

/* ---------------- helpers ---------------- */
const ask = (q) =>
  new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (ans) => { rl.close(); res(ans.trim()); });
  });

function ensureDirs() {
  for (const d of [CONFIG.screenshotDir, CONFIG.resultsDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

async function shot(page, name) {
  const file = path.join(CONFIG.screenshotDir, `${name}.png`);
  try { await page.screenshot({ path: file, fullPage: true }); } catch {}
  return file;
}

// Try several locator strategies; return the first that is visible.
async function firstVisible(page, buildFns) {
  for (const build of buildFns) {
    try {
      const loc = build();
      if (await loc.first().isVisible({ timeout: 2500 }).catch(() => false)) return loc.first();
    } catch {}
  }
  return null;
}

async function anyTextVisible(page, regexes) {
  for (const re of regexes) {
    const loc = page.getByText(re).first();
    if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) return true;
  }
  return false;
}

/* ---------------- login ---------------- */
async function ensureLoggedIn(page) {
  await page.goto(CONFIG.siteUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  if (await anyTextVisible(page, CONFIG.loggedInText)) {
    console.log('✓ Alfursan session detected — already logged in.');
    return;
  }

  // Optional automated typing if credentials are provided.
  if (process.env.ALFURSAN_USER && process.env.ALFURSAN_PASS) {
    console.log('→ Attempting automated login with credentials from .env …');
    const loginLink = await firstVisible(page, [
      () => page.getByRole('link', { name: /log ?in|sign ?in|تسجيل الدخول/i }),
      () => page.getByRole('button', { name: /log ?in|sign ?in|تسجيل الدخول/i }),
      () => page.getByText(/log ?in|sign ?in|تسجيل الدخول/i),
    ]);
    if (loginLink) { await loginLink.click().catch(() => {}); await page.waitForTimeout(2000); }
    const userBox = await firstVisible(page, [
      () => page.getByLabel(/email|member|username|الفرسان|البريد/i),
      () => page.getByPlaceholder(/email|member|username|الفرسان|البريد/i),
      () => page.locator('input[type="email"], input[name*="user" i], input[name*="member" i]'),
    ]);
    const passBox = await firstVisible(page, [
      () => page.getByLabel(/password|كلمة المرور/i),
      () => page.getByPlaceholder(/password|كلمة المرور/i),
      () => page.locator('input[type="password"]'),
    ]);
    if (userBox && passBox) {
      await userBox.fill(process.env.ALFURSAN_USER);
      await passBox.fill(process.env.ALFURSAN_PASS);
      const submit = await firstVisible(page, [
        () => page.getByRole('button', { name: /log ?in|sign ?in|continue|تسجيل الدخول/i }),
      ]);
      if (submit) await submit.click().catch(() => {});
      await page.waitForTimeout(4000);
    }
  }

  if (await anyTextVisible(page, CONFIG.loggedInText)) {
    console.log('✓ Logged in.');
    return;
  }

  // Manual login — the reliable path (handles CAPTCHA / OTP).
  console.log('\n──────────────────────────────────────────────');
  console.log('  Please log into your Alfursan account in the');
  console.log('  Chrome window that just opened.');
  console.log('  (Solve any CAPTCHA / OTP there — it is safe.)');
  console.log('──────────────────────────────────────────────');
  await ask('  When you are logged in, press ENTER here to continue… ');
}

/* ---------------- search ---------------- */
async function runSearch(page, args) {
  // 1) Switch the booking widget into "pay with miles" mode.
  const milesToggle = await firstVisible(page, [
    () => page.getByRole('tab', { name: CONFIG.milesToggleText[0] }),
    () => page.getByRole('button', { name: CONFIG.milesToggleText[0] }),
    () => page.getByText(CONFIG.milesToggleText[0]),
    () => page.getByText(CONFIG.milesToggleText[1]),
  ]);
  if (milesToggle) {
    await milesToggle.click().catch(() => {});
    console.log('✓ Switched to "Pay with miles".');
    await page.waitForTimeout(1200);
  } else {
    console.log('! Could not find the "Pay with miles" toggle automatically.');
    await shot(page, 'no-miles-toggle');
    const go = await ask('  Turn on "Pay with miles" in the window, then press ENTER (or type skip): ');
    if (go.toLowerCase() === 'skip') console.log('  Continuing without confirming miles mode.');
  }

  // 2) Fill From / To.
  await fillCity(page, 'from', args.from);
  await fillCity(page, 'to', args.to);

  // 3) Dates.
  await fillDate(page, args.date, args.ret);

  // 3b) Cabin class.
  await pickCabin(page, args.cabin);

  // 4) Submit.
  const searchBtn = await firstVisible(page, CONFIG.searchButtonText.map(
    (re) => () => page.getByRole('button', { name: re })
  ).concat(CONFIG.searchButtonText.map((re) => () => page.getByText(re))));
  if (searchBtn) {
    await searchBtn.click().catch(() => {});
    console.log('→ Searching…');
  } else {
    await shot(page, 'no-search-button');
    await ask('  Could not find the Search button. Click it in the window, then press ENTER… ');
  }

  await page.waitForLoadState('networkidle', { timeout: CONFIG.timeoutMs }).catch(() => {});
  await page.waitForTimeout(3500);
}

async function fillCity(page, which, code) {
  if (!code) return;
  const labels = which === 'from'
    ? [/from|origin|departing|leaving|من|المغادرة/i]
    : [/to|destination|arriving|going|إلى|الوصول/i];
  const box = await firstVisible(page, [
    () => page.getByLabel(labels[0]),
    () => page.getByPlaceholder(labels[0]),
    () => page.locator(`input[name*="${which}" i], input[id*="${which}" i]`),
  ]);
  if (!box) { console.log(`! Could not find the "${which}" field for ${code}.`); await shot(page, `no-${which}-field`); return; }
  await box.click().catch(() => {});
  await box.fill('').catch(() => {});
  await box.type(code, { delay: 120 });
  await page.waitForTimeout(1500);
  // pick the first autocomplete suggestion
  const opt = await firstVisible(page, [
    () => page.getByRole('option'),
    () => page.locator('[role="option"], li[class*="option" i], .autocomplete-suggestion'),
  ]);
  if (opt) await opt.click().catch(() => {});
  else await page.keyboard.press('Enter').catch(() => {});
  console.log(`✓ ${which.toUpperCase()} = ${code}`);
}

async function pickCabin(page, cabin) {
  const re = CONFIG.cabins[cabin]?.pick;
  if (!re) return;
  // open a cabin/class chooser if there is one, then pick the option
  const opener = await firstVisible(page, [
    () => page.getByRole('button', { name: /class|cabin|economy|business|الدرجة|المقصورة/i }),
    () => page.getByText(/class|cabin|الدرجة|المقصورة/i),
  ]);
  if (opener) { await opener.click().catch(() => {}); await page.waitForTimeout(700); }
  const opt = await firstVisible(page, [
    () => page.getByRole('option', { name: re }),
    () => page.getByRole('radio', { name: re }),
    () => page.getByText(re),
  ]);
  if (opt) { await opt.click().catch(() => {}); console.log(`✓ Cabin = ${cabin}`); }
  else console.log(`! Could not set cabin "${cabin}" automatically (will read it from results instead).`);
  await page.keyboard.press('Escape').catch(() => {});
}

async function fillDate(page, dateStr, retStr) {
  const dateBox = await firstVisible(page, [
    () => page.getByLabel(/depart|date|going|التاريخ|المغادرة/i),
    () => page.getByPlaceholder(/depart|date|going|التاريخ/i),
    () => page.locator('input[name*="depart" i], input[id*="depart" i], input[type="date"]'),
  ]);
  if (dateBox) {
    await dateBox.click().catch(() => {});
    // Works for native date inputs; calendar widgets may need manual picking.
    await dateBox.fill(dateStr).catch(async () => {
      await page.keyboard.type(dateStr).catch(() => {});
    });
    console.log(`✓ Depart = ${dateStr}`);
  } else {
    console.log('! Could not find the date field.');
    await shot(page, 'no-date-field');
    await ask(`  Pick ${dateStr}${retStr ? ' → ' + retStr : ''} in the calendar, then press ENTER… `);
  }
  await page.keyboard.press('Escape').catch(() => {});
}

/* ---------------- scrape results ---------------- */
async function scrapeResults(page) {
  // Grab the visible flight cards. Selectors are intentionally broad;
  // if the printed results look wrong, send me a screenshot from ./screenshots
  // and I'll tighten these.
  const cards = page.locator(
    '[class*="flight" i][class*="card" i], [data-testid*="flight" i], [class*="fare" i][class*="option" i], li[class*="flight" i]'
  );
  const n = await cards.count().catch(() => 0);
  const out = [];
  for (let i = 0; i < Math.min(n, 40); i++) {
    const t = (await cards.nth(i).innerText().catch(() => '')).replace(/\s+\n/g, '\n').trim();
    if (t) out.push(t);
  }
  return out;
}

/* ---------------- availability + alerts ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Decide whether the captured results contain bookable AWARD seats for a cabin.
function evaluateAvailability(results, cabin) {
  const seen = CONFIG.cabins[cabin]?.seen;
  const matches = results.filter((t) => {
    const milesOK = CONFIG.availableHints.some((re) => re.test(t));
    const notSold = !CONFIG.soldOutHints.some((re) => re.test(t));
    const cabinOK = seen ? seen.test(t) : true;
    return milesOK && notSold && cabinOK;
  });
  return { available: matches.length > 0, matches };
}

// Push an alert to your phone via Telegram (if configured); always beeps locally.
async function notify(title, text) {
  process.stdout.write('\x07'); // terminal bell
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: `${title}\n\n${text}`.slice(0, 3900) }),
    });
    console.log(res.ok ? '  → Telegram alert sent to your phone.' : `  ! Telegram error ${res.status}`);
  } catch (e) {
    console.log('  ! Telegram send failed:', e.message);
  }
}

/* ---------------- main ---------------- */
(async () => {
  const args = parseArgs(process.argv);
  if (args.help || !args.from || !args.to || !args.date) {
    help();
    if (!args.help) console.log('\n! Missing required --from / --to / --date.\n');
    process.exit(args.help ? 0 : 1);
  }
  ensureDirs();

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('\n✗ Playwright is not installed yet. Run:  npm install\n');
    process.exit(1);
  }

  console.log(`\nAlfursan miles search: ${args.from} → ${args.to}  on ${args.date}` +
    `${args.ret ? '  (return ' + args.ret + ')' : ''}  ·  ${args.adults} adult(s)  ·  cabin: ${args.cabin}` +
    `${args.watch ? '  ·  WATCH every ' + args.watch + ' min' : ''}\n`);

  const context = await chromium.launchPersistentContext(CONFIG.profileDir, {
    headless: false, // a real window — needed for first login and for reliability
    viewport: { width: 1360, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(CONFIG.timeoutMs);

  const stamp = args.date + '_' + args.from + '-' + args.to + '_' + args.cabin;

  // one full search + scrape, returning the captured cards
  const doSearch = async () => {
    await page.goto(CONFIG.siteUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2500);
    await runSearch(page, args);
    return scrapeResults(page);
  };

  try {
    await ensureLoggedIn(page);

    if (args.watch > 0) {
      // ===== WATCH MODE: keep checking, alert when award seats appear =====
      console.log(`\n👀 Watching ${args.from} → ${args.to} · ${args.cabin} · every ${args.watch} min.`);
      console.log(process.env.TELEGRAM_BOT_TOKEN
        ? '   Alerts will be pushed to your phone via Telegram.'
        : '   (No Telegram configured — it will beep + print here. Add TELEGRAM_* to .env for phone alerts.)');
      console.log('   Press Ctrl+C to stop.\n');

      let round = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        round++;
        const when = new Date().toLocaleTimeString();
        const results = await doSearch().catch((e) => { console.log('  check failed:', e.message); return []; });
        const { available, matches } = evaluateAvailability(results, args.cabin);
        await shot(page, `watch_${stamp}_${round}`);

        if (available) {
          const body = `${args.from} ← ${args.to}\n${args.date}${args.ret ? ' → ' + args.ret : ''} · ${args.cabin} · ${args.adults} pax\n\n`
            + matches.slice(0, 3).join('\n———\n');
          console.log('\n' + '★'.repeat(40));
          console.log(`🎉 AWARD SEATS FOUND (${args.cabin})  [${when}]`);
          console.log(body);
          console.log('★'.repeat(40) + '\n');
          await notify(`🎉 Alfursan: ${args.from}→${args.to} ${args.cabin} seats!`, body);
          const ans = await Promise.race([
            ask('Seats found! Press ENTER to keep watching, or type stop to finish: '),
            sleep(60000).then(() => ''),
          ]);
          if (String(ans).toLowerCase() === 'stop') break;
        } else {
          console.log(`[${when}] check #${round}: no ${args.cabin} award seats yet — next in ${args.watch} min.`);
        }
        await sleep(args.watch * 60 * 1000);
      }
    } else {
      // ===== SINGLE SEARCH =====
      const results = await doSearch();
      const { available, matches } = evaluateAvailability(results, args.cabin);
      const jsonFile = path.join(CONFIG.resultsDir, `award_${stamp}.json`);
      const shotFile = await shot(page, `results_${stamp}`);
      fs.writeFileSync(jsonFile, JSON.stringify({ query: args, available, capturedText: results }, null, 2));

      console.log(`\n══════════════ AWARD RESULTS (${args.cabin}) ══════════════`);
      if (results.length) {
        results.forEach((r, i) => console.log(`\n[${i + 1}]\n${r}`));
        console.log(`\n${available ? '✅ Looks like award seats ARE available for ' + args.cabin
          : '⚠️  No clear ' + args.cabin + ' award availability detected in the captured cards.'}`);
      } else {
        console.log('No flight cards were captured automatically.');
        console.log(`Look at the screenshot to see what loaded:\n  ${shotFile}`);
      }
      console.log('\n────────────────────────────────────────────');
      console.log(`Full page screenshot : ${shotFile}`);
      console.log(`Raw data saved to    : ${jsonFile}`);
      console.log('\nLeaving the browser open so you can book with miles if you like.');
      await ask('Press ENTER to close the browser… ');
    }
  } catch (err) {
    console.error('\n✗ Something went wrong:', err.message);
    const f = await shot(page, 'error');
    console.error(`A screenshot was saved to help debug: ${f}`);
  } finally {
    await context.close();
  }
})();
