// server.js — the backend. Serves the phone UI and exposes the automation API.
// Run on a computer that can reach saudia.com; open it from your phone on the
// same Wi-Fi at  http://<computer-ip>:3000
import express from 'express';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';
import { searchAirports, AIRPORTS } from './airports.js';

try { (await import('dotenv')).default.config(); } catch {}

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── City autocomplete (Saudia destinations) ──
app.get('/api/airports', (req, res) => {
  res.json(searchAirports(req.query.q || '', 8));
});

// ── Login status / trigger (automation loaded lazily so the server boots
//    even before `npx playwright install`) ──
app.get('/api/status', async (_req, res) => {
  try { const a = await import('./automation.js'); res.json(await a.getStatus()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/login', async (_req, res) => {
  try { const a = await import('./automation.js'); res.json(await a.login()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── The fully-automated search ──
app.post('/api/search', async (req, res) => {
  const { from, to, date } = req.body || {};
  if (!from || !to || !date) return res.status(400).json({ ok: false, error: 'from, to and date are required' });
  try {
    const a = await import('./automation.js');
    res.json(await a.search(req.body));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, airports: AIRPORTS.length }));

function lanURLs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) out.push(`http://${ni.address}:${PORT}`);
  }
  return out;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Alfursan app running:`);
  console.log(`   • on this computer : http://localhost:${PORT}`);
  for (const u of lanURLs()) console.log(`   • from your phone  : ${u}   (same Wi-Fi)`);
  console.log(`\n  First time: open it, tap "تسجيل الدخول", finish the Alfursan login`);
  console.log(`  in the browser window that opens on THIS computer. Then search from your phone.\n`);
});
