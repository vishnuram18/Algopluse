# AlgoPulse — NSE Stock Advisor

A personal stock analysis system for NSE-listed Indian equities. The mobile app discovers buy candidates from the Nifty 500 universe, scores them with a weighted technical algorithm, and tracks open positions with real-time target / stop-loss alerts.

---

## Architecture

```
┌──────────────────────────────────────┐     Tailscale VPN
│  PC Server (Spring Boot · port 8080) │ ←─────────────────── Phone
│  • Scans Nifty 200 at market close   │                      (anywhere)
│  • Sends Telegram alerts             │
│  • PostgreSQL position database      │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│  Mobile App (Expo · React Native)    │
│  • Scout tab — today's picks         │
│  • Portfolio tab — open positions    │
│  • Standalone when PC is off         │
└──────────────────────────────────────┘
```

**Scan flow:**
1. Phone pings PC server via Tailscale (`dlr.tail8391d7.ts.net:8080/health`)
2. If PC is on → `GET /api/scan/eod?topN=15` — PC scans 200 stocks, returns top 15
3. If PC is off → phone scans top 100 Nifty stocks locally, keeps best 15 that pass the scoring gate

---

## Repositories

| Repo | Stack |
|------|-------|
| `algopulse-mobile` (this repo) | Expo SDK 54, React Native 0.81.5, TypeScript |
| `Stock advisor` (PC server) | Spring Boot 3.3.5, Java 21, PostgreSQL |

---

## Mobile App

### Features

- **Scout tab** — runs EOD scan, shows ranked stock cards with swing / intraday scores (0–100)
- **Portfolio tab** — tracks open positions, shows P&L, fires local notifications on target or stop-loss hit
- **Dynamic universe** — Nifty 500 constituent list fetched live from NSE India CSV, cached 7 days in SQLite, static fallback if offline
- **PC-first scan** — tries PC server first, falls back to phone scan automatically
- **Auto-refresh** — configurable interval (manual / 5m / 10m / 30m / 1h)
- **Claude AI verdicts** — each stock gets an APPROVED / WATCH / DECLINED verdict with reasoning

### Tech stack

| Library | Purpose |
|---------|---------|
| Expo SDK 54 | Build toolchain, OTA updates |
| expo-router 6 | File-based navigation |
| expo-sqlite 16 | Local cache (candidates, positions, settings) |
| Zustand 5 | Global state (portfolio, alerts) |
| expo-notifications | Local target / stop-loss push alerts |
| expo-background-fetch | Background scan trigger |

### Key services

| File | What it does |
|------|-------------|
| `services/stockAnalysis.ts` | RSI, EMA, MACD, Bollinger, ATR, support/resistance, breakout detection, weighted scoring |
| `services/niftyUniverseService.ts` | Fetches Nifty 500 / 100 CSVs from NSE India, caches in SQLite |
| `services/database.ts` | All SQLite operations (candidates cache, positions, universe, settings) |
| `services/marketData.ts` | Batch price fetch from Yahoo Finance |
| `services/liveDayTradeScanner.ts` | Volume shocker detection during market hours |
| `services/claudeAnalysisService.ts` | Claude API — generates stock verdict |
| `services/telegramService.ts` | Sends target / stop-loss Telegram alerts from phone |
| `data/nifty500.ts` | Static fallback universe (200 stocks, offline use only) |

### Setup

```bash
cd algopulse-mobile
npm install
```

Create `.env` in the project root (never commit this file):

```env
EXPO_PUBLIC_CLAUDE_API_KEY=your_claude_api_key
EXPO_PUBLIC_TELEGRAM_BOT_TOKEN=your_telegram_bot_token
```

Start dev server:

```bash
npx expo start --tunnel
```

### Build (EAS)

```powershell
$env:EAS_NO_VCS = "1"
npx eas build --profile preview --platform android --non-interactive
```

> On Windows, git may not be in the default shell PATH — `EAS_NO_VCS=1` bypasses the git requirement.

---

## PC Server

### Features

- `GET /api/scan/eod?topN=N` — scans Nifty 200, returns top N candidates scored by the same algorithm as the mobile app
- `GET /health` — reachability ping used by the phone
- `@Scheduled` polling every 15 min during market hours (9:15–15:30 IST) — checks portfolio positions, sends Telegram alerts on target / stop-loss hit
- 4-hour in-memory cache so repeated phone calls don't re-scan

### Tech stack

| Library | Purpose |
|---------|---------|
| Spring Boot 3.3.5 | Web server, scheduling |
| Java 21+ | Runtime (Java 25 tested) |
| PostgreSQL | Position database |
| RestTemplate | Yahoo Finance HTTP calls |
| Hibernate / JPA | ORM |

### Prerequisites

- Java 21 or higher (`JAVA_HOME` must point to it)
- PostgreSQL running locally on port 5432
- Maven 3.9+

### Setup

1. Create the database:

```sql
CREATE DATABASE algopulse;
```

2. Set environment variables (do not hardcode tokens):

```powershell
$env:TELEGRAM_BOT_TOKEN = "your_bot_token"
$env:JAVA_HOME = "C:\Program Files\Java\jdk-25"
```

3. Update `src/main/resources/application.properties` if your PostgreSQL password differs from `postgres`.

4. Run:

```powershell
cd "E:\Stock advisor\Stock advisor"
mvn clean spring-boot:run
```

Server starts on `http://localhost:8080`. The first EOD scan call will take ~1–2 minutes (200ms delay per ticker to avoid Yahoo Finance rate limits).

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Returns `{"status":"ok"}` |
| `GET` | `/api/scan/eod?topN=15` | Runs / returns cached EOD scan |
| `GET` | `/api/portfolio` | List all tracked positions |
| `POST` | `/api/portfolio` | Add a new position |

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

**Gate:** `swingScore >= 55`

### Intraday Score

| Signal | Max pts | Condition |
|--------|---------|-----------|
| RSI extreme | 25 | `<30` = 25, `30–40` = 15 |
| Volume ratio | 30 | `>5×` = 30, `>3×` = 15, `>1.5×` = 8 |
| MACD momentum | 25 | positive + rising = 25, positive = 15 |
| Breakout | 20 | crossed resistance in last 3 bars with volume ≥ 1.5× avg |

**Gate:** `intradayScore >= 60`

A stock appears in the Scout tab only if it passes at least one gate.

---

## Connectivity (PC ↔ Phone)

Uses **Tailscale** — an encrypted peer-to-peer VPN.

- PC runs Spring Boot on port 8080, Tailscale keeps it reachable from anywhere (Wi-Fi or mobile data)
- Phone connects to `http://dlr.tail8391d7.ts.net:8080`
- When PC is off, the phone detects timeout on `/health` and runs its own scan automatically
- Set the PC server URL in **Portfolio → Settings** on the phone

---

## Data Sources

| Data | Source | Cost |
|------|--------|------|
| OHLCV (1-year daily) | Yahoo Finance unofficial API | Free |
| Current price | Yahoo Finance `regularMarketPrice` | Free |
| Nifty 500 universe | NSE India constituent CSV | Free |
| Stock verdicts | Claude API (Anthropic) | Pay-per-use |
| Telegram alerts | Telegram Bot API | Free |

Yahoo Finance URL pattern:
```
https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}.NS?interval=1d&range=1y
```

NSE India universe CSVs:
```
https://www.niftyindices.com/IndexConstituents/ind_nifty500list.csv
https://www.niftyindices.com/IndexConstituents/ind_nifty100list.csv
```

---

## Environment Variables

### Mobile (`.env` — never commit)

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_CLAUDE_API_KEY` | Claude API key from console.anthropic.com |
| `EXPO_PUBLIC_TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather |

### PC Server (shell environment — never in code)

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Same Telegram bot token |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID (default: configured in properties) |

---

## Project Structure

```
algopulse-mobile/
├── app/
│   ├── (tabs)/
│   │   ├── index.tsx          # Scout tab — EOD scan + display
│   │   └── portfolio.tsx      # Portfolio tab — positions + P&L
│   └── modal.tsx
├── components/
│   ├── StockCard.tsx          # Score bar, verdict, EMA dots
│   ├── HandshakeDrawer.tsx    # Add-to-portfolio bottom sheet
│   └── AlertBanner.tsx        # Target / stop-loss banner
├── services/
│   ├── stockAnalysis.ts       # All technical indicators + scoring
│   ├── niftyUniverseService.ts # NSE CSV fetch + SQLite cache
│   ├── database.ts            # SQLite schema + all queries
│   ├── marketData.ts          # Yahoo Finance batch price fetch
│   └── liveDayTradeScanner.ts # Volume shocker scanner
├── store/
│   └── useAppStore.ts         # Zustand store (portfolio, alerts)
├── data/
│   └── nifty500.ts            # 200-stock offline fallback universe
└── types/
    └── index.ts               # All shared TypeScript types
```

---

## Disclaimer

This app is a personal analysis tool. Nothing here is financial advice. All trades are executed manually on Groww or any other broker. The developer takes no responsibility for investment decisions made using this software.
