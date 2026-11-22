import { DESK } from "./config.js";

const BOOK_KEY = "desk:book";
const LOG_KEY = "desk:log";

type Kv = {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
};

export type PaperPosition = {
  mint: string;
  symbol: string;
  openedAt: string;
  entryUsd: number;
  /** Token market cap USD at paper open, when known. */
  entryMcapUsd?: number;
  sizeUsd: number;
  exitRule: string;
  snap?: {
    devPct: number;
    top10CombinedPct: number;
    liqUsd: number;
  };
};

export type DeskBook = {
  /** Always DESK.startingFundUsd — fixed virtual signal bankroll. */
  startingFundUsd: number;
  /** Cash not in open paper positions. */
  cashUsd: number;
  /** Lifetime realized PnL vs the $100 fund (sum of closed trade PnL). */
  realizedPnlUsd: number;
  closedWins: number;
  closedLosses: number;
  closedFlats: number;
  positions: Record<string, PaperPosition>;
  day: string;
  dayPnlUsd: number;
  entriesToday: number;
};

export type LogLine = {
  time: string;
  kind: string;
  /** Contract address (Solana mint). */
  mint?: string;
  symbol?: string;
  detail: string;
  sizeUsd?: number;
  pnlUsd?: number;
  cashUsd?: number;
  equityUsd?: number;
  openExposureUsd?: number;
  /** Token USD price at paper open. */
  entryUsd?: number;
  /** Token USD price at paper close / mark. */
  exitUsd?: number;
  /** Market cap USD at paper open. */
  entryMcapUsd?: number;
  /** Market cap USD at paper close. */
  exitMcapUsd?: number;
};

export type BankrollSnapshot = {
  startingFundUsd: number;
  cashUsd: number;
  openExposureUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  equityUsd: number;
  returnPctVsFund: number;
  openCount: number;
  closedTrades: number;
  wins: number;
  losses: number;
  flats: number;
  winRate: number | null;
  dayPnlUsd: number;
};

export function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyBook(): DeskBook {
  return {
    startingFundUsd: DESK.startingFundUsd,
    cashUsd: DESK.startingFundUsd,
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

function asBook(v: unknown): DeskBook {
  const base = emptyBook();
  if (!v || typeof v !== "object" || Array.isArray(v)) return base;
  const o = v as Record<string, unknown>;
  const book: DeskBook = {
    startingFundUsd: DESK.startingFundUsd,
    cashUsd:
      typeof o.cashUsd === "number" ? o.cashUsd : DESK.startingFundUsd,
    realizedPnlUsd:
      typeof o.realizedPnlUsd === "number" ? o.realizedPnlUsd : 0,
    closedWins: typeof o.closedWins === "number" ? o.closedWins : 0,
    closedLosses: typeof o.closedLosses === "number" ? o.closedLosses : 0,
    closedFlats: typeof o.closedFlats === "number" ? o.closedFlats : 0,
    positions: (o.positions as DeskBook["positions"]) ?? {},
    day: typeof o.day === "string" ? o.day : today(),
    dayPnlUsd: typeof o.dayPnlUsd === "number" ? o.dayPnlUsd : 0,
    entriesToday: typeof o.entriesToday === "number" ? o.entriesToday : 0,
  };
  // Migrate books that predate the $100 fund fields.
  if (typeof o.cashUsd !== "number") {
    const deployed = Object.values(book.positions).reduce(
      (s, p) => s + p.sizeUsd,
      0,
    );
    book.cashUsd = money(DESK.startingFundUsd - deployed);
  }
  if (book.day !== today()) {
    book.day = today();
    book.dayPnlUsd = 0;
    book.entriesToday = 0;
  }
  return book;
}

function asLog(v: unknown): LogLine[] {
  if (!Array.isArray(v)) return [];
  return v as LogLine[];
}

export async function loadBook(kv: Kv): Promise<DeskBook> {
  return asBook(await kv.get(BOOK_KEY));
}

export async function saveBook(kv: Kv, book: DeskBook): Promise<void> {
  await kv.put(BOOK_KEY, book);
}

export async function appendLog(kv: Kv, line: LogLine): Promise<void> {
  const log = asLog(await kv.get(LOG_KEY));
  log.push(line);
  await kv.put(LOG_KEY, log.slice(-500));
}

export async function readLog(kv: Kv): Promise<LogLine[]> {
  return asLog(await kv.get(LOG_KEY));
}

export function openExposureUsd(book: DeskBook): number {
  return money(
    Object.values(book.positions).reduce((s, p) => s + p.sizeUsd, 0),
  );
}

/** Mark map: mint → current token USD price. Missing marks use entry (unrealized 0). */
export function bankrollSnapshot(
  book: DeskBook,
  marks?: Record<string, number>,
): BankrollSnapshot {
  let markValue = 0;
  let cost = 0;
  for (const p of Object.values(book.positions)) {
    cost += p.sizeUsd;
    const mark = marks?.[p.mint];
    const px = mark != null && mark > 0 ? mark : p.entryUsd;
    markValue += (px / p.entryUsd) * p.sizeUsd;
  }
  const openExposureUsd = money(cost);
  const unrealizedPnlUsd = money(markValue - cost);
  const equityUsd = money(book.cashUsd + markValue);
  const closedTrades = book.closedWins + book.closedLosses + book.closedFlats;
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
    openCount: Object.keys(book.positions).length,
    closedTrades,
    wins: book.closedWins,
    losses: book.closedLosses,
    flats: book.closedFlats,
    winRate: decided === 0 ? null : money((book.closedWins / decided) * 100),
    dayPnlUsd: money(book.dayPnlUsd),
  };
}

export function guardOpen(book: DeskBook, mint: string, sizeUsd: number): string | null {
  if (book.dayPnlUsd <= -DESK.dailyLossHaltUsd) return "halted_daily_loss";
  if (book.positions[mint]) return "already_open";
  if (Object.keys(book.positions).length >= DESK.maxOpen) return "max_open";
  if (book.entriesToday >= DESK.maxEntriesPerDay) return "max_entries_today";
  if (book.cashUsd + 1e-9 < sizeUsd) return "insufficient_cash";
  return null;
}

export function defaultExitRule(): string {
  if (DESK.exit.altFull2xAndStop50) return "full_2x_or_stop_50";
  return `trail_${DESK.exit.trailPct}_after_take_${DESK.exit.takePct}`;
}
