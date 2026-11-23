/**
 * Offline check: the public snapshot is the scan book, not a synthetic fill.
 * Run: npx --yes tsx scripts/public-desk-selfcheck.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BankrollSnapshot } from "../bot/lib/book.js";
import { materializeScan, type ScanTapeRow } from "../bot/lib/public-desk.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const fund = (cash: number, exposure: number): BankrollSnapshot => ({
  startingFundUsd: 100,
  cashUsd: cash,
  openExposureUsd: exposure,
  unrealizedPnlUsd: 0,
  realizedPnlUsd: 0,
  equityUsd: cash + exposure,
  returnPctVsFund: cash + exposure - 100,
  openCount: exposure > 0 ? 1 : 0,
  closedTrades: 0,
  wins: 0,
  losses: 0,
  flats: 0,
  winRate: null,
  dayPnlUsd: 0,
});

const kill: ScanTapeRow = {
  symbol: "MCAT",
  mint: "BzPyyYCTmQNq2BcfQ4ANAvCYk54rnmQEXMFvFT8RhWMi",
  mcapUsd: 376455,
  detail: "hardKill:top10,insiders",
  kind: "kill",
  open: null,
};

const judgePass: ScanTapeRow = {
  symbol: "UCASH",
  mint: "7cFiqdT46zs7ooHWLFiLSaSQKLMibtokh9dBinsspump",
  mcapUsd: 630213,
  detail: "judge:action_pass",
  kind: "kill",
  open: { opened: false, sizeUsd: 25, entryUsd: 0.1, entryMcapUsd: 630213, exitRule: null },
};

const bought: ScanTapeRow = {
  symbol: "EXAMPLE",
  mint: "So11111111111111111111111111111111111111112",
  mcapUsd: 400000,
  detail: "size=25;exit=trail_20_after_take_80",
  kind: "paper_open",
  open: {
    opened: true,
    sizeUsd: 25,
    entryUsd: 0.01,
    entryMcapUsd: 400000,
    exitRule: "trail_20_after_take_80",
  },
};

const synthetic: ScanTapeRow = {
  symbol: "POPCAT",
  mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
  mcapUsd: 400000,
  detail: "eval_bankroll_math_only_not_axiom_tp",
  kind: "paper_close",
  markSource: "script_synthetic",
  open: null,
};

const at = "2026-11-23T07:27:08.745Z";
const { publicDesk, state } = materializeScan({
  scannedAt: at,
  minMcapUsd: 20_000,
  maxMcapUsd: 1_000_000,
  ticketUsd: 25,
  fund: fund(75, 25),
  rows: [kill, judgePass, synthetic, bought],
  control: {
    symbol: "BONK",
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    mcapUsd: 1_200_000_000,
    detail: "control:top10,insiders,too_old,volume_1h,mcap_band",
    kind: "kill",
    open: null,
  },
});

assert(publicDesk.mode === "paper" && publicDesk.walletControls === false, "paper only");
assert(publicDesk.sampleDisclaimer == null, "no sample banner");
assert(publicDesk.fund.cashUsd === 75 && publicDesk.fund.equityUsd === 100, "fund copied");
assert(publicDesk.openPositions.length === 1, "only the judge buy is an open ticket");
assert(publicDesk.openPositions[0]?.symbol === "EXAMPLE", "open symbol");
assert(publicDesk.entriesToday === 1, "entries");
assert(
  !JSON.stringify(publicDesk).includes("script_synthetic") &&
    !JSON.stringify(publicDesk).includes("eval_bankroll"),
  "synthetic fill dropped",
);
assert(
  !publicDesk.recent.some((line) => line.symbol === "POPCAT"),
  "synthetic row dropped",
);
const mcat = publicDesk.recent.find((line) => line.symbol === "MCAT");
assert(mcat?.detail === "kill:top10,insiders" && mcat.mcapUsd === 376455, "kill tape");
const bonk = publicDesk.recent.find((line) => line.symbol === "BONK");
assert(
  bonk?.detail === "kill:top10,insiders,too_old,volume_1h,mcap_band · control",
  "control tape",
);
const ucash = publicDesk.recent.find((line) => line.symbol === "UCASH");
assert(ucash?.kind === "kill" && ucash.detail === "judge:action_pass", "judge pass is not an open");
assert(publicDesk.recent[0]?.kind === "scan", "scan header first");
assert(state.book.cashUsd === 75, "state cash");
assert(state.book.positions[bought.mint]?.sizeUsd === 25, "state position");
assert(state.log[state.log.length - 1]?.kind === "scan", "state log oldest-first");
assert(state.sampleDisclaimer == null, "state is not a sample");

const idle = materializeScan({
  scannedAt: at,
  minMcapUsd: 20_000,
  maxMcapUsd: 1_000_000,
  ticketUsd: 25,
  fund: fund(100, 0),
  rows: [kill, judgePass],
  control: null,
  emptyMarker: undefined,
});
assert(idle.publicDesk.openPositions.length === 0, "no invented open");
assert(idle.publicDesk.fund.cashUsd === 100 && idle.publicDesk.fund.equityUsd === 100, "flat fund");

const appJs = fs.readFileSync(path.join(root, "dashboard/public/app.js"), "utf8");
assert(!appJs.includes("raw.githubusercontent.com"), "browser must not fetch GitHub");
assert(!appJs.includes("LIVE_BOOK_URL"), "no third-party desk url");
assert(appJs.includes('fetchJsonUrl("/desk.json")'), "same-origin desk.json");
assert(appJs.includes('fetchJsonUrl("/api/desk")'), "same-origin api");

console.log(JSON.stringify({ ok: true, tape: publicDesk.recent.length }));
