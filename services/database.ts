import * as SQLite from 'expo-sqlite';
import { Position, StrategyType, PositionStatus } from '../types';

let db: SQLite.SQLiteDatabase;

export async function initDatabase() {
  db = await SQLite.openDatabaseAsync('algopulse.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS positions (
      id           TEXT PRIMARY KEY,
      ticker       TEXT NOT NULL,
      name         TEXT NOT NULL,
      entry        REAL NOT NULL,
      current      REAL NOT NULL,
      target       REAL NOT NULL,
      stop_loss    REAL NOT NULL,
      qty          INTEGER NOT NULL,
      opened       TEXT NOT NULL,
      pnl          REAL DEFAULT 0,
      status       TEXT DEFAULT 'Tracking',
      strategy_type TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS verdict_cache (
      ticker     TEXT PRIMARY KEY,
      status     TEXT NOT NULL,
      body       TEXT NOT NULL,
      cached_at  INTEGER NOT NULL
    );
  `);
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
       (id, ticker, name, entry, current, target, stop_loss, qty, opened, pnl, status, strategy_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [pos.id, pos.ticker, pos.name, pos.entry, pos.current, pos.target,
     pos.stopLoss, pos.qty, pos.opened, pos.pnl, pos.status, pos.strategyType]
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
  };
}
