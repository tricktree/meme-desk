/**
 * After a hard-kill pass, run the existing meme gates and closed judge,
 * then book the flat paper ticket only when the judge returns buy.
 * The fact feed has no holder-growth series and no mcap/ATH, so the scan
 * does not claim organic=yes or late=no. A later gate fail takes no ticket.
 */

import { DESK } from "./config.js";
import {
  bankrollSnapshot,
  defaultExitRule,
  guardOpen,
  money,
  type BankrollSnapshot,
  type DeskBook,
} from "./book.js";
import { judgeGate, memeGates, type JudgeAnswers } from "./gates.js";
import type { TokenFacts } from "./feeds.js";

export type MemeStep = { verdict: "kill" | "pass"; reasons: string[] };

export type JudgeStep = {
  verdict: "buy" | "watch" | "pass" | "recheck_in_30m";
  killReason: string | null;
  answers: JudgeAnswers;
};

export type OpenStep = {
  opened: boolean;
  sizeUsd: number;
  entryUsd: number | null;
  entryMcapUsd: number;
  exitRule: string | null;
  cashUsd: number;
  equityUsd: number;
  openExposureUsd: number;
  reason: string | null;
};

export type FunnelLog = { kind: "kill" | "paper_open"; detail: string };

export type FunnelFollowThrough = {
  memeGates: MemeStep | null;
  judge: JudgeStep | null;
  open: OpenStep | null;
  /** Set when this step ran. A non-buy is a kill and takes no ticket. */
  log: FunnelLog | null;
};

export function freshScanBook(): DeskBook {
  return {
    startingFundUsd: DESK.startingFundUsd,
    cashUsd: DESK.startingFundUsd,
    realizedPnlUsd: 0,
    closedWins: 0,
    closedLosses: 0,
    closedFlats: 0,
    positions: {},
    day: new Date().toISOString().slice(0, 10),
    dayPnlUsd: 0,
    entriesToday: 0,
  };
}

/** Ticket share of the pool, on the same 1–5 scale the judge already uses. */
export function exitRiskFromLiquidity(liquidityUsd: number | null): number {
  if (liquidityUsd == null || !(liquidityUsd > 0)) return 5;
  const share = DESK.ticketUsd / liquidityUsd;
  if (share <= 0.002) return 1;
  if (share <= 0.005) return 2;
  if (share <= DESK.entry.maxTicketShare) return 3;
  return 5;
}

/**
 * Closed-judge answers the scan is allowed to submit.
 * Missing organic and late evidence stays a non-buy. Thresholds are untouched.
 */
export function scanJudgeAnswers(liquidityUsd: number | null): JudgeAnswers {
  return {
    action: "pass",
    actionP: 0,
    organic: "no",
    organicP: 0,
    late: "yes",
    exitRisk: exitRiskFromLiquidity(liquidityUsd),
  };
}

function idleOpen(book: DeskBook, entryMcapUsd: number, reason: string): OpenStep {
  const snap = bankrollSnapshot(book);
  return {
    opened: false,
    sizeUsd: DESK.ticketUsd,
    entryUsd: null,
    entryMcapUsd,
    exitRule: null,
    cashUsd: snap.cashUsd,
    equityUsd: snap.equityUsd,
    openExposureUsd: snap.openExposureUsd,
    reason,
  };
}

/** Same debit as paper_open: flat ticket, exit attached, no signing. */
export function bookPaperOpen(
  book: DeskBook,
  input: {
    mint: string;
    symbol: string | null;
    entryUsd: number | null;
    entryMcapUsd: number;
    snapDevPct: number | null;
    snapTop10: number | null;
    snapLiqUsd: number | null;
  },
): OpenStep {
  const sizeUsd = DESK.ticketUsd;
  const symbol = input.symbol?.trim() ?? "";
  if (!symbol) return idleOpen(book, input.entryMcapUsd, "missing_symbol");
  if (input.entryUsd == null || !(input.entryUsd > 0)) {
    return idleOpen(book, input.entryMcapUsd, "missing_entry_usd");
  }
  if (
    input.entryMcapUsd < DESK.entry.minMcapUsd ||
    input.entryMcapUsd > DESK.entry.maxMcapUsd
  ) {
    return idleOpen(book, input.entryMcapUsd, "mcap_band");
  }
  const blocked = guardOpen(book, input.mint, sizeUsd);
  if (blocked) return idleOpen(book, input.entryMcapUsd, blocked);

  const exitRule = defaultExitRule();
  book.cashUsd = money(book.cashUsd - sizeUsd);
  book.positions[input.mint] = {
    mint: input.mint,
    symbol,
    openedAt: new Date().toISOString(),
    entryUsd: input.entryUsd,
    entryMcapUsd: input.entryMcapUsd,
    sizeUsd,
    exitRule,
    snap: {
      devPct: input.snapDevPct ?? 0,
      top10CombinedPct: input.snapTop10 ?? 0,
      liqUsd: input.snapLiqUsd ?? 0,
    },
  };
  book.entriesToday += 1;
  const snap = bankrollSnapshot(book, { [input.mint]: input.entryUsd });
  return {
    opened: true,
    sizeUsd,
    entryUsd: input.entryUsd,
    entryMcapUsd: input.entryMcapUsd,
    exitRule,
    cashUsd: snap.cashUsd,
    equityUsd: snap.equityUsd,
    openExposureUsd: snap.openExposureUsd,
    reason: null,
  };
}

export function followHardKillPass(
  book: DeskBook,
  row: {
    mint: string;
    symbol: string | null;
    mcapUsd: number;
    liquidityUsd: number | null;
    facts: TokenFacts;
    hardKillPass: boolean;
  },
): FunnelFollowThrough {
  if (!row.hardKillPass) return { memeGates: null, judge: null, open: null, log: null };

  const memeGatesResult = memeGates({
    fromCopyList: false,
    volume24Usd: row.facts.vol24Usd,
    mcapUsd: row.mcapUsd,
    quoteIsSolOrStable: row.facts.quoteIsSolOrStable,
  });
  if (memeGatesResult.verdict !== "pass") {
    return {
      memeGates: memeGatesResult,
      judge: null,
      open: null,
      log: { kind: "kill", detail: `meme:${memeGatesResult.reasons.join(",")}` },
    };
  }

  const answers = scanJudgeAnswers(row.liquidityUsd ?? row.facts.liquidityUsd);
  const judged = judgeGate(answers);
  const judge: JudgeStep = { ...judged, answers };
  if (judge.verdict !== "buy") {
    return {
      memeGates: memeGatesResult,
      judge,
      open: null,
      log: { kind: "kill", detail: `judge:${judge.killReason ?? judge.verdict}` },
    };
  }

  const open = bookPaperOpen(book, {
      mint: row.mint,
      symbol: row.symbol,
      entryUsd: row.facts.priceUsd,
      entryMcapUsd: row.mcapUsd,
      snapDevPct: row.facts.devPct,
      snapTop10: row.facts.top10PctExPool,
      snapLiqUsd: row.liquidityUsd ?? row.facts.liquidityUsd,
    });
  return {
    memeGates: memeGatesResult,
    judge,
    open,
    log: open.opened
      ? {
          kind: "paper_open",
          detail: `size=${open.sizeUsd};exit=${open.exitRule};entryMcap=${open.entryMcapUsd}`,
        }
      : { kind: "kill", detail: `open:${open.reason ?? "blocked"}` },
  };
}

export function scanBookSnapshot(book: DeskBook): BankrollSnapshot {
  const marks: Record<string, number> = {};
  for (const pos of Object.values(book.positions)) marks[pos.mint] = pos.entryUsd;
  return bankrollSnapshot(book, marks);
}
