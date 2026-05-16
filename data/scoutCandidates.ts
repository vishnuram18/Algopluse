import { ScoutCandidate } from '../types';

// All prices, RSI, scores and verdicts are fetched live — these are just the universe to screen.
// sector is used as fallback when Yahoo Finance assetProfile is unavailable.

const blank = {
  exchange: 'NSE', currency: '₹', price: 0, change: 0,
  indicator: { label: 'RSI 14', value: '—', tone: 'muted' as const },
  verdict:   { status: 'WATCH' as const, tone: 'watch' as const, body: 'Analysing…' },
};

export const SCOUT_MOMENTUM: ScoutCandidate[] = [
  // ── Technology ────────────────────────────────────────────────────────────
  { ...blank, ticker: 'TCS',        name: 'Tata Consultancy Services', sector: 'Technology' },
  { ...blank, ticker: 'INFY',       name: 'Infosys Ltd.',              sector: 'Technology' },
  { ...blank, ticker: 'WIPRO',      name: 'Wipro Ltd.',                sector: 'Technology' },
  { ...blank, ticker: 'HCLTECH',    name: 'HCL Technologies',          sector: 'Technology' },
  { ...blank, ticker: 'TECHM',      name: 'Tech Mahindra',             sector: 'Technology' },
  { ...blank, ticker: 'LTIM',       name: 'LTIMindtree',               sector: 'Technology' },

  // ── Financial Services ────────────────────────────────────────────────────
  { ...blank, ticker: 'HDFCBANK',   name: 'HDFC Bank',                 sector: 'Financial Services' },
  { ...blank, ticker: 'ICICIBANK',  name: 'ICICI Bank',                sector: 'Financial Services' },
  { ...blank, ticker: 'KOTAKBANK',  name: 'Kotak Mahindra Bank',       sector: 'Financial Services' },
  { ...blank, ticker: 'AXISBANK',   name: 'Axis Bank',                 sector: 'Financial Services' },
  { ...blank, ticker: 'SBIN',       name: 'State Bank of India',       sector: 'Financial Services' },
  { ...blank, ticker: 'BAJFINANCE', name: 'Bajaj Finance',             sector: 'Financial Services' },

  // ── Consumer Cyclical ─────────────────────────────────────────────────────
  { ...blank, ticker: 'TATAMOTORS', name: 'Tata Motors',               sector: 'Consumer Cyclical' },
  { ...blank, ticker: 'MARUTI',     name: 'Maruti Suzuki',             sector: 'Consumer Cyclical' },
  { ...blank, ticker: 'M&M',        name: 'Mahindra & Mahindra',       sector: 'Consumer Cyclical' },
  { ...blank, ticker: 'EICHERMOT',  name: 'Eicher Motors',             sector: 'Consumer Cyclical' },
  { ...blank, ticker: 'TITAN',      name: 'Titan Company',             sector: 'Consumer Cyclical' },

  // ── Energy & Basic Materials ──────────────────────────────────────────────
  { ...blank, ticker: 'RELIANCE',   name: 'Reliance Industries',       sector: 'Energy' },
  { ...blank, ticker: 'ONGC',       name: 'ONGC',                      sector: 'Energy' },
  { ...blank, ticker: 'JSWSTEEL',   name: 'JSW Steel',                 sector: 'Basic Materials' },
  { ...blank, ticker: 'HINDALCO',   name: 'Hindalco Industries',       sector: 'Basic Materials' },
  { ...blank, ticker: 'TATASTEEL',  name: 'Tata Steel',                sector: 'Basic Materials' },
  { ...blank, ticker: 'ASIANPAINT', name: 'Asian Paints',              sector: 'Basic Materials' },

  // ── Industrials & Infra ───────────────────────────────────────────────────
  { ...blank, ticker: 'LT',         name: 'Larsen & Toubro',           sector: 'Industrials' },
  { ...blank, ticker: 'ADANIPORTS', name: 'Adani Ports',               sector: 'Industrials' },
  { ...blank, ticker: 'SIEMENS',    name: 'Siemens India',             sector: 'Industrials' },
  { ...blank, ticker: 'ABB',        name: 'ABB India',                 sector: 'Industrials' },
  { ...blank, ticker: 'HAVELLS',    name: 'Havells India',             sector: 'Industrials' },

  // ── Telecom ───────────────────────────────────────────────────────────────
  { ...blank, ticker: 'BHARTIARTL', name: 'Bharti Airtel',             sector: 'Communication Services' },
];

export const SCOUT_VALUE: ScoutCandidate[] = [
  // ── Consumer Defensive (FMCG) ─────────────────────────────────────────────
  { ...blank, ticker: 'ITC',        name: 'ITC Limited',               sector: 'Consumer Defensive' },
  { ...blank, ticker: 'HUL',        name: 'Hindustan Unilever',        sector: 'Consumer Defensive' },
  { ...blank, ticker: 'NESTLEIND',  name: 'Nestle India',              sector: 'Consumer Defensive' },
  { ...blank, ticker: 'DABUR',      name: 'Dabur India',               sector: 'Consumer Defensive' },
  { ...blank, ticker: 'MARICO',     name: 'Marico Ltd.',               sector: 'Consumer Defensive' },
  { ...blank, ticker: 'GODREJCP',   name: 'Godrej Consumer Products',  sector: 'Consumer Defensive' },
  { ...blank, ticker: 'TATACONSUM', name: 'Tata Consumer Products',    sector: 'Consumer Defensive' },

  // ── Healthcare & Pharma ───────────────────────────────────────────────────
  { ...blank, ticker: 'SUNPHARMA',  name: 'Sun Pharmaceutical',        sector: 'Healthcare' },
  { ...blank, ticker: 'DRREDDY',    name: "Dr. Reddy's Laboratories",  sector: 'Healthcare' },
  { ...blank, ticker: 'CIPLA',      name: 'Cipla Ltd.',                sector: 'Healthcare' },
  { ...blank, ticker: 'DIVISLAB',   name: "Divi's Laboratories",       sector: 'Healthcare' },
  { ...blank, ticker: 'APOLLOHOSP', name: 'Apollo Hospitals',          sector: 'Healthcare' },

  // ── Financial Services (Value) ────────────────────────────────────────────
  { ...blank, ticker: 'BAJAJFINSV', name: 'Bajaj Finserv',             sector: 'Financial Services' },
  { ...blank, ticker: 'HDFCLIFE',   name: 'HDFC Life Insurance',       sector: 'Financial Services' },
  { ...blank, ticker: 'SBILIFE',    name: 'SBI Life Insurance',        sector: 'Financial Services' },

  // ── Industrials & Infra ───────────────────────────────────────────────────
  { ...blank, ticker: 'NTPC',       name: 'NTPC Limited',              sector: 'Utilities' },
  { ...blank, ticker: 'POWERGRID',  name: 'Power Grid Corp.',          sector: 'Utilities' },
  { ...blank, ticker: 'COALINDIA',  name: 'Coal India',                sector: 'Energy' },
  { ...blank, ticker: 'BPCL',       name: 'Bharat Petroleum',          sector: 'Energy' },
  { ...blank, ticker: 'ULTRACEMCO', name: 'UltraTech Cement',          sector: 'Basic Materials' },
  { ...blank, ticker: 'PIDILITIND', name: 'Pidilite Industries',       sector: 'Basic Materials' },

  // ── Consumer Cyclical (Value) ─────────────────────────────────────────────
  { ...blank, ticker: 'DMART',      name: 'Avenue Supermarts (D-Mart)',sector: 'Consumer Defensive' },
  { ...blank, ticker: 'HEROMOTOCO', name: 'Hero MotoCorp',             sector: 'Consumer Cyclical' },
  { ...blank, ticker: 'TVSMOTOR',   name: 'TVS Motor Company',         sector: 'Consumer Cyclical' },
];
