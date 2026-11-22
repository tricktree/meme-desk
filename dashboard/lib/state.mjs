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
  // Seed a realistic PAPER session: one closed win, one open ticket, kills in the log.
  book.cashUsd = 75;
  book.realizedPnlUsd = 10;
  book.closedWins = 1;
  book.closedLosses = 0;
  book.closedFlats = 0;
  book.dayPnlUsd = 10;
  book.entriesToday = 2;
  book.positions = {
    SynthOpenMint11111111111111111111111111: {
      mint: "SynthOpenMint11111111111111111111111111",
      symbol: "WAVE",
      openedAt: t(42),
      entryUsd: 0.0042,
      entryMcapUsd: 380_000,
      sizeUsd: 25,
      exitRule: "trail_20_after_take_80",
      snap: { devPct: 1.1, top10CombinedPct: 16, liqUsd: 72_000 },
    },
  };

  const log = [
    {
      time: t(180),
      kind: "scan",
      detail: "paper-signal-scan tick — 6 leads scored",
    },
    {
      time: t(175),
      kind: "kill",
      mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      symbol: "BONK",
      detail: "kill:top10,insiders,too_old,mcap_band",
    },
    {
      time: t(120),
      kind: "kill",
      mint: "KillMintA1111111111111111111111111111111",
      symbol: "RUGX",
      detail: "kill:dev_pct,lp_unlocked",
    },
    {
      time: t(90),
      kind: "verdict",
      mint: "PassMintB111111111111111111111111111111",
      symbol: "PASS",
      detail: "judge:buy actionP=0.78 organicP=0.72 exitRisk=2",
    },
    {
      time: t(88),
      kind: "paper_open",
      mint: "PassMintB111111111111111111111111111111",
      symbol: "PASS",
      detail: "paper_open ticket=$25 exit=trail_20_after_take_80",
      sizeUsd: 25,
      cashUsd: 75,
      equityUsd: 100,
      openExposureUsd: 25,
      entryUsd: 0.01,
      entryMcapUsd: 400_000,
    },
    {
      time: t(55),
      kind: "paper_close",
      mint: "PassMintB111111111111111111111111111111",
      symbol: "PASS",
      detail: "paper_close +40% trail hit",
      sizeUsd: 25,
      pnlUsd: 10,
      cashUsd: 110,
      equityUsd: 110,
      openExposureUsd: 0,
      entryUsd: 0.01,
      exitUsd: 0.014,
      entryMcapUsd: 400_000,
      exitMcapUsd: 560_000,
    },
    {
      time: t(44),
      kind: "verdict",
      mint: "SynthOpenMint11111111111111111111111111",
      symbol: "WAVE",
      detail: "judge:buy actionP=0.81 organicP=0.70 exitRisk=2",
    },
    {
      time: t(42),
      kind: "paper_open",
      mint: "SynthOpenMint11111111111111111111111111",
      symbol: "WAVE",
      detail: "paper_open ticket=$25 exit=trail_20_after_take_80",
      sizeUsd: 25,
      cashUsd: 85,
      equityUsd: 110,
      openExposureUsd: 25,
      entryUsd: 0.0042,
      entryMcapUsd: 380_000,
    },
    {
      time: t(8),
      kind: "kill",
      mint: "KillMintC1111111111111111111111111111111",
      symbol: "LATE",
      detail: "kill:too_old,late_zone",
    },
    {
      time: t(2),
      kind: "scan",
      detail: "paper-signal-scan tick — idle, 1 open, cash=$85",
    },
  ];

  // Align cash with open exposure after close+reopen: started 100, +10 realized, -25 open → 85
  // Wait: after close cash was 110, then open WAVE for 25 → cash 85. Seed above said 75 — fix.
  book.cashUsd = 85;

  return {
    mode: "paper",
    startingFundUsd: STARTING_FUND_USD,
    ticketUsd: TICKET_USD,
    book,
    log,
    lastScanAt: t(2),
    updatedAt: new Date().toISOString(),
    marks: {},
    note: "Sample PAPER desk state for local dashboard. Replace via POST /api/seed or by writing .data/paper-desk.json.",
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
  const recent = [...log].slice(-40).reverse();

  return {
    mode: "paper",
    badge: "PAPER",
    live: false,
    walletControls: false,
    startingFundUsd: STARTING_FUND_USD,
    ticketUsd: TICKET_USD,
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
    source: "api",
  };
}

/** Static snapshot for Cursor hosting (no Node API). */
export function writeStaticDeskJson(publicDir) {
  const payload = buildDashboardPayload(loadState());
  payload.source = "static";
  payload.note =
    payload.note ||
    "Sample PAPER desk snapshot for hosted static preview. Local `npm run dashboard` serves live /api/desk.";
  const out = path.join(publicDir, "desk.json");
  fs.writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
  return out;
}

export { STATE_PATH, DATA_DIR };
