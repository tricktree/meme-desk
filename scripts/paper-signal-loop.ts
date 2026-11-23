/**
 * End-to-end PAPER signal loop against the $100 fund.
 * Early-mcap discovery (the 5-minute timer path) plus one BONK control kill
 * and an in-memory bankroll check. Loads HELIUS from .env via feeds.loadRpcDotEnv.
 *
 * When the band list succeeds, writes `.data/paper-desk.json` and pushes the
 * same PAPER snapshot (no synthetic fills) for the hosted page.
 *
 * Run: npx tsx scripts/paper-signal-loop.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DESK } from "../bot/lib/config.js";
import {
  bankrollSnapshot,
  defaultExitRule,
  guardOpen,
  money,
  type DeskBook,
  type LogLine,
} from "../bot/lib/book.js";
import { hardKill, judgeGate, memeGates } from "../bot/lib/gates.js";
import { fetchTokenFacts } from "../bot/lib/feeds.js";
import {
  emptyBandMarker,
  hardKillFromFacts,
  scanEarlyMcapBand,
} from "../bot/lib/discovery.js";
import { materializeScan, type ScanTapeRow } from "../bot/lib/public-desk.js";
import { publishPublicDesk, redactSecrets } from "./publish-public-desk.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function writeDeskState(state: unknown) {
  const dir = process.env.PAPER_DESK_DATA_DIR
    ? path.resolve(process.env.PAPER_DESK_DATA_DIR)
    : path.join(REPO_ROOT, ".data");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "paper-desk.json");
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, file);
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
    day: new Date().toISOString().slice(0, 10),
    dayPnlUsd: 0,
    entriesToday: 0,
  };
}

function dossierFromFacts(facts: Record<string, unknown>) {
  return {
    lead_id: "loop-1",
    ...facts,
    note: "facts-only stub; no adjectives",
  };
}

/** One saturated-name control. Not the candidate set. */
async function controlKillPath() {
  const mint = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"; // BONK
  const facts = await fetchTokenFacts(mint);
  const hk = hardKillFromFacts(facts);
  const log: LogLine = {
    time: new Date().toISOString(),
    kind: "kill",
    mint,
    symbol: facts.symbol ?? undefined,
    detail: `control:${hk.reasons.join(",")}`,
  };
  return {
    role: "control_kill" as const,
    mint,
    symbol: facts.symbol,
    mcapUsd: facts.mcapUsd,
    ageMin: facts.ageMin,
    liquidityUsd: facts.liquidityUsd,
    rpcSource: facts.rpcSource,
    sources: facts.sources,
    hardKill: hk,
    opened: false,
    log,
    expectKill: true,
    ok: hk.verdict === "kill",
  };
}

async function syntheticOpenClosePath() {
  // Bankroll arithmetic only (not an Axiom TP claim). Mint is real POPCAT CA;
  // facts are synthetic and mcap stays inside early band ($20k–$1M).
  const mint = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";
  const symbol = "POPCAT";
  const entryUsd = 0.01;
  const entryMcapUsd = 400_000;
  const facts = {
    mintAuthorityEnabled: false,
    freezeAuthorityEnabled: false,
    lpLockedOrBurned: true,
    top10PctExPool: 15,
    devPct: 1,
    insiders: 0,
    liquidityUsd: 90_000,
    ageMin: 120,
    riskScore: 8,
    vol1hUsd: 55_000,
    buys1h: 200,
    sells1h: 150,
    mcapUsd: 400_000,
  };
  const hk = hardKill(facts);
  const mg = memeGates({
    officialCaMatches: true,
    hasOfficialCaSource: true,
    volume24Usd: 80_000,
    mcapUsd: 400_000,
    quoteIsSolOrStable: true,
    mcapOverAth: 0.5,
    athAgeHours: 0.8,
    eventThemed: false,
  });
  const dossier = dossierFromFacts({
    mint,
    symbol,
    ...facts,
    organic_hint: "holders up vs price last hour — many wallets",
    late_hint: "mcap/ATH 0.5 — not late",
  });
  const jg = judgeGate({
    action: "buy",
    actionP: 0.78,
    organic: "yes",
    organicP: 0.72,
    late: "no",
    exitRisk: 2,
  });

  const book = emptyBook();
  const fundStart = bankrollSnapshot(book);
  const size = DESK.ticketUsd;
  const logs: LogLine[] = [];

  if (hk.verdict !== "pass" || mg.verdict !== "pass" || jg.verdict !== "buy") {
    return {
      path: "synthetic_open_close",
      ok: false,
      error: "gates_blocked",
      hardKill: hk,
      memeGates: mg,
      judge: jg,
      fundStart,
    };
  }

  const blocked = guardOpen(book, mint, size);
  if (blocked) {
    return { path: "synthetic_open_close", ok: false, error: blocked, fundStart };
  }

  const exitRule = defaultExitRule();
  book.cashUsd = money(book.cashUsd - size);
  book.positions[mint] = {
    mint,
    symbol,
    openedAt: new Date().toISOString(),
    entryUsd,
    entryMcapUsd,
    sizeUsd: size,
    exitRule,
    snap: { devPct: 1, top10CombinedPct: 15, liqUsd: 90_000 },
  };
  book.entriesToday += 1;
  const afterOpen = bankrollSnapshot(book, { [mint]: entryUsd });
  logs.push({
    time: new Date().toISOString(),
    kind: "paper_open",
    mint,
    symbol,
    detail: `size=${size};exit=${exitRule}`,
    sizeUsd: size,
    cashUsd: afterOpen.cashUsd,
    equityUsd: afterOpen.equityUsd,
    openExposureUsd: afterOpen.openExposureUsd,
    pnlUsd: 0,
    entryUsd,
    entryMcapUsd,
  });

  // Close at +40% mark
  const markUsd = entryUsd * 1.4;
  const exitMcapUsd = entryMcapUsd * 1.4;
  const pos = book.positions[mint]!;
  const tradePnlUsd = money(((markUsd - pos.entryUsd) / pos.entryUsd) * pos.sizeUsd);
  book.cashUsd = money(book.cashUsd + pos.sizeUsd + tradePnlUsd);
  book.realizedPnlUsd = money(book.realizedPnlUsd + tradePnlUsd);
  book.dayPnlUsd = money(book.dayPnlUsd + tradePnlUsd);
  book.closedWins += 1;
  delete book.positions[mint];
  const afterClose = bankrollSnapshot(book);
  logs.push({
    time: new Date().toISOString(),
    kind: "paper_close",
    mint,
    symbol,
    detail: "eval_bankroll_math_only_not_axiom_tp",
    sizeUsd: size,
    pnlUsd: tradePnlUsd,
    cashUsd: afterClose.cashUsd,
    equityUsd: afterClose.equityUsd,
    openExposureUsd: afterClose.openExposureUsd,
    entryUsd,
    exitUsd: markUsd,
    entryMcapUsd,
    exitMcapUsd,
    markSource: "script_synthetic",
    movePct: 40,
  });

  const deskReport = {
    kind: "status",
    mode: DESK.mode,
    ticketUsd: DESK.ticketUsd,
    fund: afterClose,
    openPositions: Object.values(book.positions),
    recentTrades: logs.filter((l) => l.kind === "paper_close"),
  };

  const ok =
    afterOpen.cashUsd === 75 &&
    afterOpen.equityUsd === 100 &&
    afterClose.cashUsd === 110 &&
    afterClose.equityUsd === 110 &&
    afterClose.realizedPnlUsd === 10 &&
    afterClose.winRate === 100;

  return {
    path: "synthetic_open_close",
    countsAsScanBook: false,
    ok,
    hardKill: hk,
    memeGates: mg,
    judge: jg,
    dossier,
    exitRule,
    tradePnlUsd,
    fundStart,
    afterOpen,
    afterClose,
    deskReport,
    logs,
  };
}

async function main() {
  const early = await scanEarlyMcapBand();
  const control = await controlKillPath();
  const synth = await syntheticOpenClosePath();
  const earlyBand: Record<string, unknown> = {
    minMcapUsd: early.minMcapUsd,
    maxMcapUsd: early.maxMcapUsd,
    candidateCount: early.candidates.length,
    candidates: early.candidates.map((row) => ({
      symbol: row.symbol,
      mint: row.mint,
      mcapUsd: row.mcapUsd,
      ageMin: row.ageMin,
      liquidityUsd: row.liquidityUsd,
      source: row.source,
      hardKill: row.hardKill,
      memeGates: row.memeGates,
      judge: row.judge,
      open: row.open,
      log: row.log,
    })),
    listsOk: early.listsOk,
    discovery: early.discovery,
  };
  const empty = emptyBandMarker(early.candidates.length);
  if (empty) earlyBand.empty = empty;
  const passed = early.candidates.filter((row) => row.hardKill.verdict === "pass").length;
  const opened = early.candidates.filter((row) => row.open?.opened === true).length;
  const scannedAt = new Date().toISOString();
  const rows: ScanTapeRow[] = early.candidates.map((row) => ({
    symbol: row.symbol,
    mint: row.mint,
    mcapUsd: row.mcapUsd,
    detail: row.log?.detail ?? null,
    kind: row.log?.kind ?? (row.hardKill.verdict === "kill" ? "kill" : null),
    open: row.open,
  }));
  let publicBook: { published: boolean; branch: string; reason?: string; updatedAt?: string } =
    {
      published: false,
      branch: "cursor/paper-live-book-b14c",
      reason: "lists_unavailable",
    };
  if (early.listsOk || early.candidates.length > 0) {
    const { publicDesk, state } = materializeScan({
      scannedAt,
      minMcapUsd: early.minMcapUsd,
      maxMcapUsd: early.maxMcapUsd,
      ticketUsd: DESK.ticketUsd,
      fund: early.scanBook,
      rows,
      control: {
        symbol: control.symbol ?? null,
        mint: control.mint,
        mcapUsd: typeof control.mcapUsd === "number" ? control.mcapUsd : null,
        detail: control.log.detail,
        kind: "kill",
        open: null,
      },
      emptyMarker: empty ?? undefined,
    });
    writeDeskState(state);
    publicBook = { ...publishPublicDesk(publicDesk), updatedAt: publicDesk.updatedAt };
    if (publicBook.reason) publicBook.reason = redactSecrets(publicBook.reason);
  }
  const out = {
    mode: "paper",
    startingFundUsd: DESK.startingFundUsd,
    ticketUsd: DESK.ticketUsd,
    scanBook: {
      ...early.scanBook,
      hardKillPasses: passed,
      openedCount: opened,
    },
    earlyBand,
    controlKill: control,
    synthetic: synth,
    publicBook,
    ok: control.ok && synth.ok === true && early.listsOk,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
