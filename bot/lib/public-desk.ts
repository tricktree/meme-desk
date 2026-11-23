/**
 * PAPER snapshot for the hosted dashboard.
 * Built only from a scan's own book and tape. Never includes the in-memory
 * synthetic open/close (that path is bankroll arithmetic, not a fill).
 */
import type { BankrollSnapshot, DeskBook, PaperPosition } from "./book.js";

export const LIVE_BOOK_BRANCH = "cursor/paper-live-book-b14c";
export const LIVE_BOOK_FILE = "dashboard/public/desk.json";

const MAX_TAPE = 80;
const MAX_DETAIL = 500;

const FORBIDDEN =
  /script_synthetic|eval_bankroll_math|private[_ ]?key|secret[_ ]?key|seed phrase|HELIUS_API_KEY|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/i;

export type ScanTapeRow = {
  symbol: string | null;
  mint: string;
  mcapUsd: number | null;
  /** Raw loop detail (`hardKill:…`, `judge:…`, `control:…`, `meme:…`). */
  detail: string | null;
  kind: "kill" | "paper_open" | "paper_close" | "verdict" | null;
  markSource?: string | null;
  open?: {
    opened: boolean;
    sizeUsd: number;
    entryUsd: number | null;
    entryMcapUsd: number;
    exitRule: string | null;
  } | null;
};

export type ScanMaterial = {
  scannedAt: string;
  minMcapUsd: number;
  maxMcapUsd: number;
  ticketUsd: number;
  fund: BankrollSnapshot;
  /** In-band rows, discovery order. */
  rows: ScanTapeRow[];
  control: ScanTapeRow | null;
  /** Set only when the filtered band was empty. */
  emptyMarker?: string;
};

export type PublicLogLine = {
  time: string;
  kind: "scan" | "kill" | "verdict" | "paper_open" | "paper_close";
  detail: string;
  mint?: string;
  symbol?: string;
  mcapUsd?: number;
  entryUsd?: number;
  entryMcapUsd?: number;
  sizeUsd?: number;
  markSource?: string;
};

export type PublicDesk = {
  mode: "paper";
  badge: "PAPER";
  /** Trading mode is paper. The page's pill is a separate feed clock. */
  live: false;
  walletControls: false;
  startingFundUsd: number;
  ticketUsd: number;
  earlyMcapBand: { minUsd: number; maxUsd: number };
  fund: BankrollSnapshot;
  openPositions: PaperPosition[];
  entriesToday: number;
  lastScanAt: string;
  updatedAt: string;
  heliusOptional: true;
  marksApplied: false;
  recent: PublicLogLine[];
  logCounts: {
    total: number;
    kills: number;
    verdicts: number;
    opens: number;
    closes: number;
  };
  note: string;
  sampleDisclaimer: null;
  source: "scan";
};

export type DeskStateFile = {
  mode: "paper";
  startingFundUsd: number;
  ticketUsd: number;
  book: DeskBook;
  log: PublicLogLine[];
  lastScanAt: string;
  updatedAt: string;
  marks: Record<string, number>;
  note: string;
  sampleDisclaimer: null;
};

function cleanDetail(detail: string, role: "row" | "control"): string | null {
  let text = detail.trim().slice(0, MAX_DETAIL);
  if (!text || FORBIDDEN.test(text)) return null;
  if (text.startsWith("hardKill:")) text = `kill:${text.slice("hardKill:".length)}`;
  if (text.startsWith("control:")) {
    text = `kill:${text.slice("control:".length)} · control`;
  } else if (role === "control" && !text.includes("control")) {
    text = `${text} · control`;
  }
  return text;
}

function rowLine(row: ScanTapeRow, scannedAt: string, role: "row" | "control"): PublicLogLine | null {
  if (FORBIDDEN.test(row.mint) || (row.symbol != null && FORBIDDEN.test(row.symbol))) {
    return null;
  }
  const opened = row.open?.opened === true;
  let kind = row.kind;
  if (opened) kind = "paper_open";
  if (kind === "paper_close" && row.markSource !== "fetch_token_facts") return null;
  if (kind !== "kill" && kind !== "paper_open" && kind !== "verdict" && kind !== "paper_close") {
    kind = "kill";
  }
  const detail = cleanDetail(row.detail ?? "", role);
  if (!detail) return null;
  const line: PublicLogLine = {
    time: scannedAt,
    kind,
    detail,
    mint: row.mint,
  };
  if (row.symbol) line.symbol = row.symbol;
  if (typeof row.mcapUsd === "number" && Number.isFinite(row.mcapUsd)) {
    line.mcapUsd = row.mcapUsd;
  }
  if (opened && row.open) {
    line.kind = "paper_open";
    line.sizeUsd = row.open.sizeUsd;
    if (row.open.entryUsd != null && row.open.entryUsd > 0) line.entryUsd = row.open.entryUsd;
    line.entryMcapUsd = row.open.entryMcapUsd;
  }
  if (kind === "paper_close" && row.markSource === "fetch_token_facts") {
    line.markSource = "fetch_token_facts";
  }
  return line;
}

function positionFrom(row: ScanTapeRow, scannedAt: string): PaperPosition | null {
  const open = row.open;
  if (!open?.opened) return null;
  if (open.entryUsd == null || !(open.entryUsd > 0)) return null;
  const symbol = row.symbol?.trim() ?? "";
  if (!symbol || !row.mint) return null;
  return {
    mint: row.mint,
    symbol,
    openedAt: scannedAt,
    entryUsd: open.entryUsd,
    entryMcapUsd: open.entryMcapUsd,
    sizeUsd: open.sizeUsd,
    exitRule: open.exitRule ?? "",
  };
}

function capTape(lines: PublicLogLine[]): PublicLogLine[] {
  if (lines.length <= MAX_TAPE) return lines;
  const pinned = lines.filter((line) => line.kind === "scan" || line.kind === "paper_open");
  const rest = lines.filter((line) => line.kind !== "scan" && line.kind !== "paper_open");
  const room = Math.max(0, MAX_TAPE - pinned.length);
  return [...pinned, ...rest.slice(0, room)];
}

function counts(lines: PublicLogLine[]): PublicDesk["logCounts"] {
  return {
    total: lines.length,
    kills: lines.filter((line) => line.kind === "kill").length,
    verdicts: lines.filter((line) => line.kind === "verdict").length,
    opens: lines.filter((line) => line.kind === "paper_open").length,
    closes: lines.filter((line) => line.kind === "paper_close").length,
  };
}

/** Display order: scan header, control kill, then in-band rows. */
export function materializeScan(input: ScanMaterial): {
  publicDesk: PublicDesk;
  state: DeskStateFile;
} {
  const scannedAt = input.scannedAt;
  const positions: PaperPosition[] = [];
  const seen = new Set<string>();
  for (const row of input.rows) {
    const pos = positionFrom(row, scannedAt);
    if (!pos || seen.has(pos.mint)) continue;
    seen.add(pos.mint);
    positions.push(pos);
  }

  const headerBits = [
    `early band $${input.minMcapUsd}–$${input.maxMcapUsd}`,
    input.emptyMarker
      ? input.emptyMarker
      : `in-band ${input.rows.length}`,
    `opened ${positions.length}`,
  ];
  const header: PublicLogLine = {
    time: scannedAt,
    kind: "scan",
    detail: headerBits.join(" · "),
  };

  const body: PublicLogLine[] = [];
  if (input.control) {
    const line = rowLine(input.control, scannedAt, "control");
    if (line) body.push(line);
  }
  for (const row of input.rows) {
    const line = rowLine(row, scannedAt, "row");
    if (line) body.push(line);
  }

  const display = capTape([header, ...body]);
  const logCounts = counts(display);
  const note =
    "Latest PAPER scan. A ticket is booked only after the judge buys. No synthetic fills.";

  const book: DeskBook = {
    startingFundUsd: input.fund.startingFundUsd,
    cashUsd: input.fund.cashUsd,
    realizedPnlUsd: input.fund.realizedPnlUsd,
    closedWins: input.fund.wins,
    closedLosses: input.fund.losses,
    closedFlats: input.fund.flats,
    positions: Object.fromEntries(positions.map((pos) => [pos.mint, pos])),
    day: scannedAt.slice(0, 10),
    dayPnlUsd: input.fund.dayPnlUsd,
    entriesToday: positions.length,
  };

  const publicDesk: PublicDesk = {
    mode: "paper",
    badge: "PAPER",
    live: false,
    walletControls: false,
    startingFundUsd: input.fund.startingFundUsd,
    ticketUsd: input.ticketUsd,
    earlyMcapBand: { minUsd: input.minMcapUsd, maxUsd: input.maxMcapUsd },
    fund: input.fund,
    openPositions: positions,
    entriesToday: positions.length,
    lastScanAt: scannedAt,
    updatedAt: scannedAt,
    heliusOptional: true,
    marksApplied: false,
    recent: display,
    logCounts,
    note,
    sampleDisclaimer: null,
    source: "scan",
  };

  const state: DeskStateFile = {
    mode: "paper",
    startingFundUsd: input.fund.startingFundUsd,
    ticketUsd: input.ticketUsd,
    book,
    log: [...display].reverse(),
    lastScanAt: scannedAt,
    updatedAt: scannedAt,
    marks: Object.fromEntries(positions.map((pos) => [pos.mint, pos.entryUsd])),
    note,
    sampleDisclaimer: null,
  };

  assertPublishable(publicDesk);
  return { publicDesk, state };
}

export function assertPublishable(desk: PublicDesk): void {
  if (desk.mode !== "paper" || desk.walletControls !== false || desk.live !== false) {
    throw new Error("refusing_non_paper");
  }
  if (desk.sampleDisclaimer != null) throw new Error("refusing_sample_banner");
  const raw = JSON.stringify(desk);
  if (FORBIDDEN.test(raw)) throw new Error("refusing_forbidden_text");
  if (raw.length > 500_000) throw new Error("refusing_oversize");
  for (const line of desk.recent) {
    if (line.kind === "paper_close" && line.markSource !== "fetch_token_facts") {
      throw new Error("refusing_unmarked_close");
    }
  }
}
