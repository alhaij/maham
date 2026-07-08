# Alfursan Miles Search

A small tool that opens **Saudia (saudia.com)**, uses your logged-in
**Alfursan** account, and searches **award (miles) availability** for a date and
destination you give it — flights you can book with miles, no cash fares.

> **Why it runs on a computer, not inside your phone:** a program can only
> control a login + search on saudia.com through a real browser it drives
> (Chrome on a laptop/PC). A phone browser can't do that. Once it's running on a
> computer you can, of course, book the flight it finds from your phone.

---

## What it does

1. Opens a real Chrome window.
2. Makes sure you're logged into Alfursan (**you log in by hand the first
   time** — this also clears CAPTCHA/OTP, which is safer and more reliable).
   Your session is saved, so later runs skip the login.
3. Switches the search to **"Pay with miles."**
4. Fills in your **from / to / date** and searches.
5. Prints the award flights it finds, saves a screenshot + the raw data, and
   leaves the browser open so you can book with miles if you want.

---

## One-time setup (on a laptop or PC)

You need [Node.js](https://nodejs.org) (version 18 or newer) installed. Then, in
a terminal:

```bash
cd alfursan-miles-search
npm install          # installs Playwright + downloads Chrome for it
cp .env.example .env # optional: only if you want it to type your password
```

Editing `.env` is **optional**. By default you just log in by hand in the
window that opens — nothing is stored except your browser session, on your own
machine.

---

## Run a search

```bash
# one-way, JED → Dubai on 15 Aug 2026
node search.js --from JED --to DXB --date 2026-08-15

# round trip, Riyadh → London, 2 passengers
node search.js --from RUH --to LHR --date 2026-09-01 --return 2026-09-10 --adults 2

# Cairo, one-way
node search.js --from JED --to CAI --date 2026-08-15
```

| Option     | Meaning                                        |
|------------|------------------------------------------------|
| `--from`   | Origin airport code (JED, RUH, DMM, …)         |
| `--to`     | Destination airport code (DXB, LHR, CAI …)     |
| `--date`   | Departure date, `YYYY-MM-DD`                   |
| `--return` | Return date (leave out for one-way)            |
| `--adults` | Number of passengers (default 1)               |
| `--cabin`  | `economy` \| `business` \| `first` (default economy) |
| `--watch`  | Keep checking every N minutes and **alert** when award seats appear |
| `--help`   | Show usage                                      |

### Alerts — get told the moment seats open (by cabin)

```bash
# check Business award seats JED→London every 15 minutes, alert when they appear
node search.js --from JED --to LHR --date 2026-09-01 --cabin business --watch 15
```

Leave this running on your computer. Each round it re-searches, and when it
finds **award (miles) seats in your chosen cabin** it:

- **beeps** and prints the flights, and
- **pushes a message to your phone via Telegram** — so you get pinged even
  when you're away from the computer.

Setting up the Telegram phone-ping takes about 5 minutes (free) — the steps are
in `.env.example`. If you skip it, `--watch` still beeps and prints locally.

> Seat detection reads the results Saudia shows and looks for miles/award
> wording in your cabin. On the very first run, glance at a screenshot in
> `screenshots/` to confirm it's reading the right thing — if not, send it to me
> and I'll tune the `CONFIG` at the top of `search.js`.

**The first run:** a Chrome window opens → log into Alfursan → come back to the
terminal and press **ENTER**. From then on it remembers you.

---

## If a step doesn't work

Saudia changes its website from time to time, and the button/field names can
drift. When that happens the tool doesn't crash — it **takes a screenshot** (in
`screenshots/`) and **pauses**, asking you to do that one step by hand, then it
continues.

If the results look wrong or empty, open the screenshot in `screenshots/` — it
shows exactly what the page looked like. Send me that screenshot and I'll tune
the selectors in `search.js` (the `CONFIG` block at the top is built for exactly
this).

---

## Privacy

- Your Alfursan login lives only on your computer.
- `.env`, your saved browser session (`user-profile/`), screenshots, and
  results are all **git-ignored** — they are never committed or uploaded.
- The tool does **not** auto-solve CAPTCHAs or bypass any security — you do the
  login yourself, once.
