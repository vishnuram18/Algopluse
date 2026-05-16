import { create } from 'zustand';
import { Position, ScoutCandidate, ScoutTab, PositionStatus } from '../types';
import { getAllPositions, savePosition, updatePositionPrice } from '../services/database';
import { getBatchPrices } from '../services/marketData';
import { fireTargetNotification, fireStopLossNotification } from '../services/notifications';

interface Alert { ticker: string; name: string; price: number }

interface AppState {
  positions:     Position[];
  scoutTab:      ScoutTab;
  selectedStock: ScoutCandidate | null;
  alert:         Alert | null;

  loadPositions:   () => Promise<void>;
  commitPosition:  (pos: Position) => Promise<void>;
  refreshPrices:   () => Promise<void>;
  setSelectedStock:(s: ScoutCandidate | null) => void;
  setScoutTab:     (t: ScoutTab) => void;
  dismissAlert:    () => void;
}

function deriveStatus(pnl: number, current: number, target: number): PositionStatus {
  if (current >= target)          return 'Target hit';
  if (current >= target * 0.95)   return 'Near Target';
  if (pnl < -3)                   return 'Drawdown';
  return 'Tracking';
}

export const useAppStore = create<AppState>((set, get) => ({
  positions:     [],
  scoutTab:      'momentum',
  selectedStock: null,
  alert:         null,

  loadPositions: async () => {
    const positions = await getAllPositions();
    set({ positions });
  },

  commitPosition: async (pos) => {
    await savePosition(pos);
    set(s => ({ positions: [pos, ...s.positions.filter(p => p.ticker !== pos.ticker)] }));
  },

  refreshPrices: async () => {
    const { positions } = get();
    if (positions.length === 0) return;

    const tickers = positions.map(p => p.ticker);
    const priceMap = await getBatchPrices(tickers);

    const updated: Position[] = [];
    let newAlert: Alert | null = null;

    for (const pos of positions) {
      const price = priceMap[pos.ticker];
      if (!price || price <= 0) { updated.push(pos); continue; }

      const pnl    = Math.round(((price - pos.entry) / pos.entry) * 10000) / 100;
      const status = deriveStatus(pnl, price, pos.target);

      await updatePositionPrice(pos.ticker, price, pnl, status);
      updated.push({ ...pos, current: price, pnl, status });

      if (status === 'Target hit' && pos.status !== 'Target hit') {
        newAlert = { ticker: pos.ticker, name: pos.name, price };
        fireTargetNotification(pos.ticker, pos.name, price).catch(() => {});
      }
      if (status === 'Drawdown' && pos.status !== 'Drawdown') {
        fireStopLossNotification(pos.ticker, pos.name, price).catch(() => {});
      }
    }

    set(s => ({ positions: updated, alert: newAlert ?? s.alert }));
  },

  setSelectedStock: (selectedStock) => set({ selectedStock }),
  setScoutTab:      (scoutTab)      => set({ scoutTab }),
  dismissAlert:     ()              => set({ alert: null }),
}));
