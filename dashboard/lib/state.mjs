/**
 * File-backed PAPER desk state for the local dashboard.
 * Mirrors bot/lib/book.ts shapes; never touches wallets or LIVE controls.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = process.env.PAPER_DESK_DATA_DIR
  ? path.resolve(process.env.PAPER_DESK_DATA_DIR)
  : path.join(ROOT, ".data");
const STATE_PATH = path.join(DATA_DIR, "paper-desk.json");

export const STARTING_FUND_USD = 100;
export const TICKET_USD = 25;

function money(n) {
  return Math.round(n * 100) / 100;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyBook() {
  return {
    startingFundUsd: STARTING_FUND_USD,
    cashUsd: STARTING_FUND_USD,
    realizedPnlUsd: 0,
    closedWins: 0,
    closedLosses: 0,
    closedFlats: 0,
    positions: {},
    day: today(),
    dayPnlUsd: 0,
    entriesToday: 0,
  };
}

/**
 * Real token mint CAs for kill-tape examples (Axiom resolves as tokens).
 * Sample does NOT invent +TP wins against these charts — large-caps are shown as mcap_band kills.
 */
const DEMO = {
  bonk: {
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    symbol: "BONK",
  },
  wif: {
    mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    symbol: "WIF",
  },
  popcat: {
    mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
    symbol: "POPCAT",
  },
  fartcoin: {
    mint: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump",
    symbol: "FARTCOIN",
  },
  pengu: {
    mint: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv",
    symbol: "PENGU",
  },
};

export function bankrollSnapshot(book, marks = {}) {
  let markValue = 0;
  let cost = 0;
  for (const p of Object.values(book.positions ?? {})) {
    cost += p.sizeUsd;
    const mark = marks[p.mint];
    const px = mark != null && mark > 0 ? mark : p.entryUsd;
    markValue += (px / p.entryUsd) * p.sizeUsd;
  }
  const openExposureUsd = money(cost);
  const unrealizedPnlUsd = money(markValue - cost);
  const equityUsd = money(book.cashUsd + markValue);
  const closedTrades =
    book.closedWins + book.closedLosses + book.closedFlats;
  const decided = book.closedWins + book.closedLosses;
  return {
    startingFundUsd: book.startingFundUsd,
    cashUsd: money(book.cashUsd),
    openExposureUsd,
    unrealizedPnlUsd,
    realizedPnlUsd: money(book.realizedPnlUsd),
    equityUsd,
    returnPctVsFund: money(
      ((equityUsd - book.startingFundUsd) / book.startingFundUsd) * 100,
    ),
    openCount: Object.keys(book.positions ?? {}).length,
    closedTrades,
    wins: book.closedWins,
    losses: book.closedLosses,
    flats: book.closedFlats,
    winRate: decided === 0 ? null : money((book.closedWins / decided) * 100),
    dayPnlUsd: money(book.dayPnlUsd),
  };
}

function defaultState() {
  const now = Date.now();
  const t = (minsAgo) => new Date(now - minsAgo * 60_000).toISOString();
  const book = emptyBook();
  // Honest sample: no open tickets, no invented TP wins. Tape shows large-caps killed for mcap_band.
  book.cashUsd = STARTING_FUND_USD;
  book.realizedPnlUsd = 0;
  book.closedWins = 0;
  book.closedLosses = 0;
  book.closedFlats = 0;
  book.dayPnlUsd = 0;
  book.entriesToday = 0;
  book.positions = {};

  const log = [
    {
      time: t(180),
      kind: "scan",
      detail:
        "paper-signal-scan — early-mcap band $20k–$1M; reject saturated large-caps",
    },
    {
      time: t(175),
      kind: "kill",
      mint: DEMO.bonk.mint,
      symbol: DEMO.bonk.symbol,
      detail: "kill:top10,insiders,too_old,mcap_band",
    },
    {
      time: t(120),
      kind: "kill",
      mint: DEMO.wif.mint,
      symbol: DEMO.wif.symbol,
      detail: "kill:mcap_band (above $1M early-band max — not a paper open)",
    },
    {
      time: t(90),
      kind: "kill",
      mint: DEMO.popcat.mint,
      symbol: DEMO.popcat.symbol,
      detail:
        "kill:mcap_band,too_old — no synthetic +40% close; chart must print the mark",
    },
    {
      time: t(60),
      kind: "kill",
      mint: DEMO.fartcoin.mint,
      symbol: DEMO.fartcoin.symbol,
      detail: "kill:mcap_band",
    },
    {
      time: t(30),
      kind: "kill",
      mint: DEMO.pengu.mint,
      symbol: DEMO.pengu.symbol,
      detail: "kill:mcap_band,too_old",
    },
    {
      time: t(2),
      kind: "scan",
      detail:
        "idle — $100 cash, 0 opens, 0 synthetic wins; waiting for early-band leads",
    },
  ];

  return {
    mode: "paper",
    startingFundUsd: STARTING_FUND_USD,
    ticketUsd: TICKET_USD,
    book,
    log,
    lastScanAt: t(2),
    updatedAt: new Date().toISOString(),
    marks: {},
    note: "SAMPLE UI ONLY: no invented take-profit fills. Large-cap CAs appear as mcap_band kills. Live paper_close requires fresh fetch_token_facts marks.",
    sampleDisclaimer:
      "Synthetic TP fills removed. Hosted metrics are a clean $100 book until the live paper loop writes real opens/closes.",
  };
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadState() {
  ensureDir();
  if (!fs.existsSync(STATE_PATH)) {
    const seeded = defaultState();
    fs.writeFileSync(STATE_PATH, JSON.stringify(seeded, null, 2));
    return seeded;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    if (!raw.book) return defaultState();
    return raw;
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  ensureDir();
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  return state;
}

export function resetSampleState() {
  return saveState(defaultState());
}

export function buildDashboardPayload(state = loadState()) {
  const book = state.book ?? emptyBook();
  const fund = bankrollSnapshot(book, state.marks ?? {});
  const log = Array.isArray(state.log) ? state.log : [];
  const kills = log.filter(
    (l) => l.kind === "kill" || String(l.detail ?? "").startsWith("kill:"),
  );
  const verdicts = log.filter((l) => l.kind === "verdict");
  const opens = log.filter((l) => l.kind === "paper_open");
  const closes = log.filter((l) => l.kind === "paper_close");
  const recent = [...log].slice(-80).reverse();

  return {
    mode: "paper",
    badge: "PAPER",
    live: false,
    walletControls: false,
    startingFundUsd: STARTING_FUND_USD,
    ticketUsd: TICKET_USD,
    earlyMcapBand: { minUsd: 20_000, maxUsd: 1_000_000 },
    fund,
    openPositions: Object.values(book.positions ?? {}),
    entriesToday: book.entriesToday ?? 0,
    lastScanAt: state.lastScanAt ?? null,
    updatedAt: state.updatedAt ?? null,
    heliusOptional: true,
    marksApplied: Object.keys(state.marks ?? {}).length > 0,
    recent,
    logCounts: {
      total: log.length,
      kills: kills.length,
      verdicts: verdicts.length,
      opens: opens.length,
      closes: closes.length,
    },
    note: state.note ?? null,
    sampleDisclaimer: state.sampleDisclaimer ?? null,
    source: "api",
  };
}

/** Static snapshot for Cursor hosting (no Node API). */
export function writeStaticDeskJson(publicDir) {
  const payload = buildDashboardPayload(loadState());
  payload.source = "static";
  payload.note =
    payload.note ||
    "Sample PAPER desk snapshot for hosted static preview.";
  const out = path.join(publicDir, "desk.json");
  fs.writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
  return out;
}

export { STATE_PATH, DATA_DIR };
