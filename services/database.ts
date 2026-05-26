import * as SQLite from 'expo-sqlite';
import { Position, StrategyType, PositionStatus, CalendarEntry, CalendarEntryType } from '../types';
import { NiftyStock } from '../data/nifty500';

let db: SQLite.SQLiteDatabase;

export async function initDatabase() {
  db = await SQLite.openDatabaseAsync('algopulse.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS positions (
      id             TEXT PRIMARY KEY,
      ticker         TEXT NOT NULL,
      name           TEXT NOT NULL,
      entry          REAL NOT NULL,
      current        REAL NOT NULL,
      target         REAL NOT NULL,
      stop_loss      REAL NOT NULL,
      qty            INTEGER NOT NULL,
      opened         TEXT NOT NULL,
      pnl            REAL DEFAULT 0,
      status         TEXT DEFAULT 'Tracking',
      strategy_type  TEXT NOT NULL,
      expected_days  INTEGER
    );

    CREATE TABLE IF NOT EXISTS verdict_cache (
      ticker     TEXT PRIMARY KEY,
      status     TEXT NOT NULL,
      body       TEXT NOT NULL,
      cached_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trading_calendar (
      date   TEXT PRIMARY KEY,   -- YYYY-MM-DD IST
      type   TEXT NOT NULL,      -- 'HOLIDAY' | 'SPECIAL_TRADING'
      label  TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS nifty_universe (
      ticker      TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      sector      TEXT NOT NULL,
      is_nifty100 INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Migrate: add expected_days to pre-existing positions tables that lack it
  await db.execAsync(
    `ALTER TABLE positions ADD COLUMN expected_days INTEGER;`
  ).catch(() => {});
}

export async function getAllPositions(): Promise<Position[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM positions ORDER BY rowid DESC'
  );
  return rows.map(toPosition);
}

export async function savePosition(pos: Position): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO positions
       (id, ticker, name, entry, current, target, stop_loss, qty, opened, pnl, status, strategy_type, expected_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [pos.id, pos.ticker, pos.name, pos.entry, pos.current, pos.target,
     pos.stopLoss, pos.qty, pos.opened, pos.pnl, pos.status, pos.strategyType,
     pos.expectedDays ?? null]
  );
}

export async function deletePosition(id: string): Promise<void> {
  await db.runAsync('DELETE FROM positions WHERE id = ?', [id]);
}

export async function updatePositionPrice(
  ticker: string, price: number, pnl: number, status: string
): Promise<void> {
  await db.runAsync(
    'UPDATE positions SET current = ?, pnl = ?, status = ? WHERE ticker = ?',
    [price, pnl, status, ticker]
  );
}

// ── Scout candidates cache (Local Mode) ──────────────────────────────────────
// Stores the full enriched candidates list so the app can render stale-but-useful
// data when Yahoo Finance / Claude are unreachable.

export async function saveCandidatesCache(json: string): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO app_state (key, value) VALUES ('candidates_cache', ?)`,
    [json]
  );
  await db.runAsync(
    `INSERT OR REPLACE INTO app_state (key, value) VALUES ('candidates_cache_at', ?)`,
    [Date.now().toString()]
  );
}

export async function getCandidatesCache(): Promise<{ json: string; cachedAt: number } | null> {
  const [dataRow, tsRow] = await Promise.all([
    db.getFirstAsync<{ value: string }>(`SELECT value FROM app_state WHERE key = 'candidates_cache'`),
    db.getFirstAsync<{ value: string }>(`SELECT value FROM app_state WHERE key = 'candidates_cache_at'`),
  ]);
  if (!dataRow) return null;
  return { json: dataRow.value, cachedAt: tsRow ? parseInt(tsRow.value, 10) : 0 };
}

// ── Sync timestamp (fail-safe heartbeat) ─────────────────────────────────────

export async function getScanIntervalMins(): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_state WHERE key = 'scan_interval_mins'`
  );
  return row ? parseInt(row.value, 10) : 0;
}

export async function setScanIntervalMins(mins: number): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO app_state (key, value) VALUES ('scan_interval_mins', ?)`,
    [mins.toString()]
  );
}

export async function getLastSyncAt(): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_state WHERE key = 'last_sync_at'`
  );
  return row ? parseInt(row.value, 10) : 0;
}

export async function setLastSyncAt(ts: number): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO app_state (key, value) VALUES ('last_sync_at', ?)`,
    [ts.toString()]
  );
}

// Verdicts are cached for 24 hours to avoid re-calling Claude API unnecessarily.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function getCachedVerdict(
  ticker: string
): Promise<{ status: string; body: string } | null> {
  const row = await db.getFirstAsync<{ status: string; body: string }>(
    'SELECT status, body FROM verdict_cache WHERE ticker = ? AND cached_at > ?',
    [ticker, Date.now() - CACHE_TTL_MS]
  );
  return row ?? null;
}

export async function saveVerdictCache(
  ticker: string, status: string, body: string
): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO verdict_cache (ticker, status, body, cached_at) VALUES (?, ?, ?, ?)',
    [ticker, status, body, Date.now()]
  );
}

// ── Trading calendar ──────────────────────────────────────────────────────────

export async function getTradingCalendarEntry(
  date: string,
): Promise<CalendarEntry | null> {
  const row = await db.getFirstAsync<{ type: string; label: string }>(
    'SELECT type, label FROM trading_calendar WHERE date = ?',
    [date]
  );
  if (!row) return null;
  return { date, type: row.type as CalendarEntryType, label: row.label };
}

export async function upsertTradingCalendarEntry(
  entry: CalendarEntry,
): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO trading_calendar (date, type, label) VALUES (?, ?, ?)',
    [entry.date, entry.type, entry.label]
  );
}

export async function deleteTradingCalendarEntry(date: string): Promise<void> {
  await db.runAsync('DELETE FROM trading_calendar WHERE date = ?', [date]);
}

export async function getAllCalendarEntries(): Promise<CalendarEntry[]> {
  const rows = await db.getAllAsync<{ date: string; type: string; label: string }>(
    'SELECT date, type, label FROM trading_calendar ORDER BY date ASC'
  );
  return rows.map(r => ({ date: r.date, type: r.type as CalendarEntryType, label: r.label }));
}

export async function getUpcomingTradingCalendar(
  fromDate: string,
  limit = 10,
): Promise<CalendarEntry[]> {
  const rows = await db.getAllAsync<{ date: string; type: string; label: string }>(
    'SELECT date, type, label FROM trading_calendar WHERE date >= ? ORDER BY date ASC LIMIT ?',
    [fromDate, limit]
  );
  return rows.map(r => ({ date: r.date, type: r.type as CalendarEntryType, label: r.label }));
}

// ── Nifty universe cache ──────────────────────────────────────────────────────

export async function saveNiftyUniverse(
  stocks:        NiftyStock[],
  top100Tickers: Set<string>,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM nifty_universe');
    for (const s of stocks) {
      await db.runAsync(
        'INSERT INTO nifty_universe (ticker, name, sector, is_nifty100) VALUES (?, ?, ?, ?)',
        [s.ticker, s.name, s.sector, top100Tickers.has(s.ticker) ? 1 : 0],
      );
    }
  });
  await db.runAsync(
    `INSERT OR REPLACE INTO app_state (key, value) VALUES ('nifty_universe_cached_at', ?)`,
    [Date.now().toString()],
  );
}

export async function getNiftyUniverseFromDb(): Promise<{
  stocks:       NiftyStock[];
  top100Stocks: NiftyStock[];
  cachedAt:     number | null;
}> {
  const [rows, tsRow] = await Promise.all([
    db.getAllAsync<{ ticker: string; name: string; sector: string; is_nifty100: number }>(
      'SELECT ticker, name, sector, is_nifty100 FROM nifty_universe',
    ),
    db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_state WHERE key = 'nifty_universe_cached_at'`,
    ),
  ]);
  const stocks       = rows.map(r => ({ ticker: r.ticker, name: r.name, sector: r.sector }));
  const top100Stocks = rows
    .filter(r => r.is_nifty100 === 1)
    .map(r => ({ ticker: r.ticker, name: r.name, sector: r.sector }));
  return { stocks, top100Stocks, cachedAt: tsRow ? parseInt(tsRow.value, 10) : null };
}

function toPosition(row: Record<string, unknown>): Position {
  return {
    id:           String(row.id),
    ticker:       String(row.ticker),
    name:         String(row.name),
    entry:        Number(row.entry),
    current:      Number(row.current),
    target:       Number(row.target),
    stopLoss:     Number(row.stop_loss),
    qty:          Number(row.qty),
    opened:       String(row.opened),
    pnl:          Number(row.pnl),
    status:       String(row.status) as PositionStatus,
    strategyType: String(row.strategy_type) as StrategyType,
    expectedDays: row.expected_days != null ? Number(row.expected_days) : undefined,
  };
}
