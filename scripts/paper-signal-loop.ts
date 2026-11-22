/**
 * End-to-end PAPER signal loop against the $100 fund.
 * Live lead (kill expected) + synthetic open/close.
 * Loads HELIUS from .env via feeds.loadRpcDotEnv.
 *
 * Run: npx tsx scripts/paper-signal-loop.ts
 */
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

async function liveKillPath() {
  const mint = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"; // BONK
  const facts = await fetchTokenFacts(mint);
  const hk = hardKill({
    mintAuthorityEnabled: facts.mintAuthorityEnabled,
    freezeAuthorityEnabled: facts.freezeAuthorityEnabled,
    lpLockedOrBurned: facts.lpLockedOrBurned,
    top10PctExPool: facts.top10PctExPool,
    devPct: facts.devPct,
    insiders: facts.insiders,
    liquidityUsd: facts.liquidityUsd,
    ageMin: facts.ageMin,
    riskScore: facts.riskScore,
    vol1hUsd: facts.vol1hUsd,
    buys1h: facts.buys1h,
    sells1h: facts.sells1h,
    mcapUsd: facts.mcapUsd,
    unknownFields: facts.unknownFields,
  });
  const log: LogLine = {
    time: new Date().toISOString(),
    kind: "kill",
    mint,
    symbol: facts.symbol ?? undefined,
    detail: `kill:${hk.reasons.join(",")}`,
  };
  return {
    path: "live_kill",
    mint,
    symbol: facts.symbol,
    rpcSource: facts.rpcSource,
    sources: facts.sources,
    dossierStub: dossierFromFacts(facts.dossier),
    hardKill: hk,
    opened: false,
    log,
    expectKill: true,
    ok: hk.verdict === "kill",
  };
}

async function syntheticOpenClosePath() {
  const mint = "pdiZ6FihziEftTm29opMcC7E9qNNhYp5495m4hFvvNkw";
  const symbol = "PASS";
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
    detail: "trail_or_take_smoke",
    sizeUsd: size,
    pnlUsd: tradePnlUsd,
    cashUsd: afterClose.cashUsd,
    equityUsd: afterClose.equityUsd,
    openExposureUsd: afterClose.openExposureUsd,
    entryUsd,
    exitUsd: markUsd,
    entryMcapUsd,
    exitMcapUsd,
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
  const live = await liveKillPath();
  const synth = await syntheticOpenClosePath();
  const out = {
    mode: "paper",
    startingFundUsd: DESK.startingFundUsd,
    ticketUsd: DESK.ticketUsd,
    live,
    synthetic: synth,
    ok: live.ok && synth.ok === true,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
