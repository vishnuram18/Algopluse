# AlgoPulse — NSE Stock Advisor

A personal stock analysis app for NSE-listed Indian equities. Discovers buy candidates from the
Nifty 500 universe, scores them with a weighted technical algorithm, tracks open positions, and
fires real-time target / stop-loss push notifications — even when the app is backgrounded.

---

## Architecture

```
┌──────────────────────────────────────┐
│  Firebase Realtime Database          │
│  • Stores EOD scan results (cloud)   │
│  • Phone reads cached candidates     │
└──────────────────────────────────────┘
              ↕  read/write
┌──────────────────────────────────────┐
│  Mobile App (Expo · React Native)    │
│  • Scout tab  — Swing / Intraday     │
│  • Portfolio tab — positions + P&L   │
│  • Background monitor (9:15–15:30)   │
│  • Local auth (fingerprint + PIN)    │
└──────────────────────────────────────┘
```

**Scan flow:**
1. On Scout tab load → check Firebase for a cached EOD scan
2. If cache is fresh → display immediately
3. If stale → phone runs its own live scan against the Nifty 500 universe

---

## Features

- **Scout tab** — ranks stocks with Swing and Intraday sub-tabs; all analyzed stocks shown, sorted by score
- **Portfolio tab** — tracks open positions, live P&L, fires local notifications on target hit or drawdown
- **Background position monitor** — checks tracked positions every 15 min between 9:15 AM and 3:30 PM IST; exits immediately outside market hours (no battery drain)
- **Background day-trade scan** — fail-safe scan at three IST checkpoints (9:15, 12:30, 15:30) if the foreground scanner goes quiet
- **Local authentication** — fingerprint on return visits; username + password on first launch; credentials stored encrypted in SecureStore
- **Export / Import backup** — full JSON backup includes positions, calendar overrides, candidates cache, and hashed credentials; importing restores everything and redirects to login
- **Claude AI verdicts** — APPROVED / WATCH / DECLINED verdict with reasoning for each stock
- **Dynamic universe** — Nifty 500 constituent list fetched from NSE India CSV, cached 7 days in SQLite, static fallback if offline
- **Market calendar** — respects NSE holidays and special trading days

---

## Tech Stack

| Library | Purpose |
|---------|---------|
| Expo SDK 54 | Build toolchain |
| expo-router 6 | File-based navigation |
| expo-sqlite 16 | Local cache (candidates, positions, settings) |
| expo-secure-store | Encrypted credential storage |
| expo-local-authentication | Fingerprint / biometric login |
| expo-crypto | SHA-256 password hashing |
| expo-background-fetch | Background scan + position monitor |
| expo-notifications | Local push alerts |
| Zustand 5 | Global state (portfolio, alerts, session) |
| Firebase Realtime Database | Cloud EOD scan cache |

---

## Key Services

| File | What it does |
|------|-------------|
| `services/stockAnalysis.ts` | RSI, EMA, MACD, Bollinger, ATR, support/resistance, weighted scoring |
| `services/strategyEngine.ts` | Orchestrates full stock scan, returns ranked candidates |
| `services/niftyUniverseService.ts` | Fetches Nifty 500 / 100 CSVs from NSE India, caches in SQLite |
| `services/database.ts` | All SQLite operations (candidates, positions, universe, settings) |
| `services/marketData.ts` | Batch price fetch from Yahoo Finance |
| `services/liveDayTradeScanner.ts` | Volume shocker detection during market hours |
| `services/claudeAnalysisService.ts` | Claude API — generates stock verdict |
| `services/localAuthService.ts` | Account creation, SHA-256 hashing, biometric auth, session management |
| `services/localBackupService.ts` | Export / import JSON backup including encrypted credentials |
| `services/notifications.ts` | Target-hit and stop-loss push notification helpers |
| `services/marketCalendarService.ts` | NSE holiday / special trading day calendar |

---

## Background Tasks

| File | Task name | When it runs |
|------|-----------|-------------|
| `tasks/dayTradeScanTask.ts` | `ALGOPULSE_DAY_TRADE_SCAN` | Near 9:15, 12:30, 15:30 IST (±15 min); only if foreground scanner is stale |
| `tasks/positionMonitorTask.ts` | `ALGOPULSE_POSITION_MONITOR` | Every 15 min; exits immediately outside 9:15–15:30 IST and on holidays |

Both tasks run with `stopOnTerminate: false, startOnBoot: true`.

---

## Scoring Algorithm

Each stock gets two independent scores (0–100):

### Swing Score (2–10 day hold)

| Signal | Max pts | Condition |
|--------|---------|-----------|
| RSI zone | 15 | `<35` = 15, `35–45` = 8, `45–55` = 4 |
| MACD | 15 | histogram > 0 AND macdLine > 0 = 15, histogram > 0 = 8 |
| EMA stack | 15 | EMA20 > EMA50 > SMA200 = 15, EMA20 > EMA50 = 8 |
| Volume surge | 15 | ratio > 3× = 15, > 1.5× = 8 |
| Support proximity | 15 | within 1.5% of support = 15, within 3% = 8 |

### Intraday Score

| Signal | Max pts | Condition |
|--------|---------|-----------|
| RSI extreme | 25 | `<30` = 25, `30–40` = 15 |
| Volume ratio | 30 | `>5×` = 30, `>3×` = 15, `>1.5×` = 8 |
| MACD momentum | 25 | positive + rising = 25, positive = 15 |
| Breakout | 20 | crossed resistance in last 3 bars with volume ≥ 1.5× avg |

All analyzed stocks are shown in the Scout tab, sorted by score descending.

---

## Setup

```bash
cd algopulse-mobile
npm install
```

Create `.env` in the project root (never commit this file):

```env
EXPO_PUBLIC_CLAUDE_API_KEY=your_claude_api_key
EXPO_PUBLIC_FIREBASE_DB_URL=https://your-project-default-rtdb.firebaseio.com
```

Start dev server:

```bash
npx expo start
```

Scan the QR code in Expo Go or run on a connected Android device.

### Build (EAS)

```powershell
$env:EAS_NO_VCS = "1"
npx eas build --profile preview --platform android --non-interactive
```

---

## Data Sources

| Data | Source | Cost |
|------|--------|------|
| OHLCV (1-year daily) | Yahoo Finance unofficial API | Free |
| Current price | Yahoo Finance `regularMarketPrice` | Free |
| Nifty 500 universe | NSE India constituent CSV | Free |
| EOD scan cache | Firebase Realtime Database | Free tier |
| Stock verdicts | Claude API (Anthropic) | Pay-per-use |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_CLAUDE_API_KEY` | Claude API key from console.anthropic.com |
| `EXPO_PUBLIC_FIREBASE_DB_URL` | Firebase Realtime Database URL |

---

## Project Structure

```
algopulse-mobile/
├── app/
│   ├── (tabs)/
│   │   ├── index.tsx           # Scout tab — scan results, Swing / Intraday
│   │   └── portfolio.tsx       # Portfolio tab — positions, P&L, backup
│   ├── login.tsx               # Local auth (create account / fingerprint / password)
│   └── _layout.tsx             # Root layout, DB init, task registration
├── components/
│   ├── StockCard.tsx           # Score bar, verdict badge, EMA dots
│   ├── HandshakeDrawer.tsx     # Add-to-portfolio bottom sheet
│   └── AlertBanner.tsx         # Target / stop-loss banner
├── services/
│   ├── stockAnalysis.ts        # Technical indicators + scoring
│   ├── strategyEngine.ts       # Full scan orchestration
│   ├── niftyUniverseService.ts # NSE CSV fetch + SQLite cache
│   ├── database.ts             # SQLite schema + all queries
│   ├── marketData.ts           # Yahoo Finance batch price fetch
│   ├── liveDayTradeScanner.ts  # Volume shocker scanner
│   ├── claudeAnalysisService.ts # Claude AI verdicts
│   ├── localAuthService.ts     # Auth: account, biometrics, session
│   ├── localBackupService.ts   # Export / import JSON backup
│   ├── notifications.ts        # Push notification helpers
│   └── marketCalendarService.ts # NSE holiday calendar
├── tasks/
│   ├── dayTradeScanTask.ts     # Background fail-safe scan
│   └── positionMonitorTask.ts  # Background position monitor
├── store/
│   └── useAppStore.ts          # Zustand store
├── data/
│   └── nifty500.ts             # Static fallback universe
└── types/
    └── index.ts                # Shared TypeScript types
```

---

## Disclaimer

This app is a personal analysis tool. Nothing here is financial advice. All trades are executed
manually on Groww or any other broker. The developer takes no responsibility for investment
decisions made using this software.
