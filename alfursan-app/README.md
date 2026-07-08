# أميال الفرسان — Fully-automated Alfursan miles search

A real app (not a landing page): a **phone web UI** + a **backend that drives
saudia.com for you** — logs into your Alfursan account, switches to *pay with
miles*, searches your route/date, and shows the award flights. The city boxes
autocomplete from Saudia's destination list (type `J` → Jeddah, Jakarta,
Johannesburg…).

## Why it needs a backend (the honest part)

A web page **cannot** log into saudia.com by itself — every browser blocks one
site from logging into another. So the automation runs in a small server
(Node + Playwright) on **your computer**, and your **phone opens that server**
over Wi-Fi. Your Alfursan password stays in a file on your computer; it never
goes anywhere else.

```
 Your phone  ──Wi-Fi──►  Your computer (this app)  ──►  saudia.com
  (the UI)                (Playwright automation)        (your Alfursan)
```

## Setup (once, on a computer that can reach saudia.com)

Install [Node.js 18+](https://nodejs.org). Then:

```bash
cd alfursan-app
npm install                 # installs Express, Playwright + Chromium
cp .env.example .env        # optional: add your Alfursan user/pass
npm start
```

The terminal prints two addresses:

```
 • on this computer : http://localhost:3000
 • from your phone  : http://192.168.x.x:3000   (same Wi-Fi)
```

## Use it

1. On your **phone** (same Wi-Fi), open the `http://192.168.x.x:3000` address.
2. First time only: tap **تسجيل الدخول**. A browser window opens **on the
   computer** — finish the Alfursan login there (incl. any CAPTCHA/OTP). The
   banner turns green when you're in. (After that, set `HEADLESS=true` in `.env`
   and restart to run searches invisibly.)
3. Type a city letter — pick from the Saudia list — set date, passengers,
   cabin — tap **ابحث بالأميال**. The server does the whole search and shows the
   award flights, highlighting the ones with miles availability in your cabin.

## Notes & honesty

- **Selectors:** I could not reach saudia.com from where this was built, so the
  Saudia field/button selectors are best-effort and centralised in
  `automation.js` (`CFG`). If a search comes back empty, the server saves a
  screenshot in `screenshots/` — send it over and the selectors get tuned in
  minutes.
- **Airports:** the built-in list (`airports.js`) covers Saudia's network. To
  pull the live list instead, wire `SAUDIA_URL`'s airport endpoint in
  `automation.js` later.
- **Security:** `.env`, the saved browser session (`user-profile/`), and
  screenshots are git-ignored — never committed.
- **Access from outside your home:** keep it on your own Wi-Fi. Exposing it to
  the public internet would put your Alfursan session online — don't, unless you
  add real authentication first.
