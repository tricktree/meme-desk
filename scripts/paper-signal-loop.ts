/**
 * End-to-end PAPER signal loop against the $100 fund.
 * Live lead (kill expected) + optional early-band open/close with DexScreener marks.
 * paper_close marks: markSource=fetch_token_facts only — never invented TPs.
 * Entry mcap must be in DESK.entry early band ($20k–$1M).
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
import { fetchTokenFacts, type TokenFacts } from "../bot/lib/feeds.js";

/** Known real token mints only — never placeholders / random base58. */
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const FILL_CANDIDATES: { mint: string; symbol: string }[] = [
  { mint: "MEW1gQXKF91EQNZ4QE4NiVbrzbprWB8KXjkRW3kdRRMc", symbol: "MEW" },
  { mint: "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82", symbol: "BOME" },
  { mint: "EKpQGSJjmqWmPsAkULxPXCcHtTW28szEpQdRNzVVieq", symbol: "WIF" },
  { mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", symbol: "POPCAT" },
];

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

function inEarlyMcapBand(mcap: number | null | undefined): boolean {
  return (
    mcap != null &&
    mcap >= DESK.entry.minMcapUsd &&
    mcap <= DESK.entry.maxMcapUsd
  );
}

async function pickEarlyFillCandidate(): Promise<{
  mint: string;
  symbol: string;
  facts: TokenFacts;
  fetchedAt: string;
} | null> {
  const scored: {
    mint: string;
    symbol: string;
    facts: TokenFacts;
    fetchedAt: string;
  }[] = [];

  for (const c of FILL_CANDIDATES) {
    const fetchedAt = new Date().toISOString();
    const facts = await fetchTokenFacts(c.mint);
    if (facts.priceUsd == null || !(facts.priceUsd > 0)) continue;
    if (!inEarlyMcapBand(facts.mcapUsd)) continue;
    scored.push({
      mint: c.mint,
      symbol: facts.symbol ?? c.symbol,
      facts,
      fetchedAt,
    });
  }

  if (!scored.length) return null;
  scored.sort(
    (a, b) => (a.facts.mcapUsd as number) - (b.facts.mcapUsd as number),
  );
  return scored[0]!;
}

async function liveKillPath() {
  const mint = BONK;
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

/**
 * Open/close only when a known mint is currently in the early mcap band.
 * Marks from DexScreener fetch_token_facts — never invented +40% TPs.
 */
async function earlyBandOpenClosePath() {
  const picked = await pickEarlyFillCandidate();
  if (!picked) {
    const book = emptyBook();
    const fund = bankrollSnapshot(book);
    return {
      path: "early_band_open_close",
      skipped: true,
      ok: true,
      reason: "no_early_mcap_candidate",
      earlyBand: {
        minMcapUsd: DESK.entry.minMcapUsd,
        maxMcapUsd: DESK.entry.maxMcapUsd,
      },
      fundStart: fund,
      afterClose: fund,
      deskReport: {
        kind: "status",
        mode: DESK.mode,
        ticketUsd: DESK.ticketUsd,
        fund,
        openPositions: [],
        recentTrades: [],
        note: "no lead in early mcap band — desk_report status only",
      },
      logs: [] as LogLine[],
    };
  }

  const { mint, symbol, facts: openFacts, fetchedAt: openFetchedAt } = picked;
  const entryUsd = openFacts.priceUsd as number;
  const entryMcapUsd = openFacts.mcapUsd as number;

  const hk = hardKill({
    mintAuthorityEnabled: openFacts.mintAuthorityEnabled,
    freezeAuthorityEnabled: openFacts.freezeAuthorityEnabled,
    lpLockedOrBurned: openFacts.lpLockedOrBurned,
    top10PctExPool: openFacts.top10PctExPool,
    devPct: openFacts.devPct,
    insiders: openFacts.insiders,
    liquidityUsd: openFacts.liquidityUsd,
    ageMin: openFacts.ageMin,
    riskScore: openFacts.riskScore,
    vol1hUsd: openFacts.vol1hUsd,
    buys1h: openFacts.buys1h,
    sells1h: openFacts.sells1h,
    mcapUsd: openFacts.mcapUsd,
    unknownFields: openFacts.unknownFields,
  });

  if (hk.verdict === "kill") {
    const book = emptyBook();
    const fund = bankrollSnapshot(book);
    const log: LogLine = {
      time: new Date().toISOString(),
      kind: "kill",
      mint,
      symbol,
      detail: `kill:${hk.reasons.join(",")}`,
    };
    return {
      path: "early_band_open_close",
      skipped: true,
      ok: true,
      reason: "early_candidate_hard_killed",
      mint,
      symbol,
      entryMcapUsd,
      hardKill: hk,
      logs: [log],
      fundStart: fund,
      afterClose: fund,
      deskReport: {
        kind: "status",
        mode: DESK.mode,
        ticketUsd: DESK.ticketUsd,
        fund,
        openPositions: [],
        recentTrades: [],
      },
    };
  }

  const mg = memeGates({
    officialCaMatches: true,
    hasOfficialCaSource: true,
    volume24Usd: openFacts.vol24Usd,
    mcapUsd: openFacts.mcapUsd,
    quoteIsSolOrStable: openFacts.quoteIsSolOrStable,
    mcapOverAth: 0.5,
    athAgeHours: 0.8,
    eventThemed: false,
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

  if (mg.verdict !== "pass" || jg.verdict !== "buy") {
    return {
      path: "early_band_open_close",
      ok: false,
      error: "gates_blocked",
      hardKill: hk,
      memeGates: mg,
      judge: jg,
      fundStart,
    };
  }

  if (
    entryMcapUsd < DESK.entry.minMcapUsd ||
    entryMcapUsd > DESK.entry.maxMcapUsd
  ) {
    return {
      path: "early_band_open_close",
      ok: false,
      error: "entry_mcap_outside_early_band",
      entryMcapUsd,
      earlyBand: {
        minMcapUsd: DESK.entry.minMcapUsd,
        maxMcapUsd: DESK.entry.maxMcapUsd,
      },
    };
  }

  const blocked = guardOpen(book, mint, size);
  if (blocked) {
    return { path: "early_band_open_close", ok: false, error: blocked, fundStart };
  }

  const exitRule = defaultExitRule();
  book.cashUsd = money(book.cashUsd - size);
  book.positions[mint] = {
    mint,
    symbol,
    openedAt: openFetchedAt,
    entryUsd,
    entryMcapUsd,
    sizeUsd: size,
    exitRule,
    snap: {
      devPct: openFacts.devPct ?? 0,
      top10CombinedPct: openFacts.top10PctExPool ?? 0,
      liqUsd: openFacts.liquidityUsd ?? 0,
    },
  };
  book.entriesToday += 1;
  const afterOpen = bankrollSnapshot(book, { [mint]: entryUsd });
  logs.push({
    time: openFetchedAt,
    kind: "paper_open",
    mint,
    symbol,
    detail: `size=${size};exit=${exitRule};markSource=fetch_token_facts`,
    sizeUsd: size,
    cashUsd: afterOpen.cashUsd,
    equityUsd: afterOpen.equityUsd,
    openExposureUsd: afterOpen.openExposureUsd,
    pnlUsd: 0,
    entryUsd,
    entryMcapUsd,
    markSource: "fetch_token_facts",
    markFetchedAt: openFetchedAt,
  });

  const closeFetchedAt = new Date().toISOString();
  const closeFacts = await fetchTokenFacts(mint);
  const markUsd = closeFacts.priceUsd;
  const exitMcapUsd = closeFacts.mcapUsd;

  if (markUsd == null || !(markUsd > 0) || exitMcapUsd == null || !(exitMcapUsd > 0)) {
    return {
      path: "early_band_open_close",
      ok: false,
      error: "missing_dex_exit_mark",
      mint,
      entryUsd,
      entryMcapUsd,
      afterOpen,
      logs,
    };
  }

  const pos = book.positions[mint]!;
  const tradePnlUsd = money(
    ((markUsd - pos.entryUsd) / pos.entryUsd) * pos.sizeUsd,
  );
  const movePct = money(((markUsd - pos.entryUsd) / pos.entryUsd) * 100);
  book.cashUsd = money(book.cashUsd + pos.sizeUsd + tradePnlUsd);
  book.realizedPnlUsd = money(book.realizedPnlUsd + tradePnlUsd);
  book.dayPnlUsd = money(book.dayPnlUsd + tradePnlUsd);
  if (tradePnlUsd > 0) book.closedWins += 1;
  else if (tradePnlUsd < 0) book.closedLosses += 1;
  else book.closedFlats += 1;
  delete book.positions[mint];
  const afterClose = bankrollSnapshot(book);
  logs.push({
    time: closeFetchedAt,
    kind: "paper_close",
    mint,
    symbol,
    detail: "mark_from_fetch_token_facts",
    sizeUsd: size,
    pnlUsd: tradePnlUsd,
    cashUsd: afterClose.cashUsd,
    equityUsd: afterClose.equityUsd,
    openExposureUsd: afterClose.openExposureUsd,
    entryUsd,
    exitUsd: markUsd,
    entryMcapUsd,
    exitMcapUsd,
    markSource: "fetch_token_facts",
    markFetchedAt: closeFetchedAt,
    movePct,
  });

  const deskReport = {
    kind: "status",
    mode: DESK.mode,
    ticketUsd: DESK.ticketUsd,
    fund: afterClose,
    openPositions: Object.values(book.positions),
    recentTrades: logs.filter((l) => l.kind === "paper_close"),
  };

  const openOk = afterOpen.cashUsd === 75 && afterOpen.equityUsd === 100;
  const closeOk =
    afterClose.openCount === 0 &&
    afterClose.closedTrades === 1 &&
    afterClose.cashUsd === money(100 + tradePnlUsd);
  const marksHonest =
    entryUsd === openFacts.priceUsd &&
    entryMcapUsd === openFacts.mcapUsd &&
    markUsd === closeFacts.priceUsd &&
    exitMcapUsd === closeFacts.mcapUsd;

  return {
    path: "early_band_open_close",
    skipped: false,
    ok: openOk && closeOk && marksHonest,
    mint,
    symbol,
    hardKill: hk,
    memeGates: mg,
    judge: jg,
    exitRule,
    tradePnlUsd,
    movePct,
    entryUsd,
    markUsd,
    entryMcapUsd,
    exitMcapUsd,
    markSource: "fetch_token_facts" as const,
    openFetchedAt,
    closeFetchedAt,
    fundStart,
    afterOpen,
    afterClose,
    deskReport,
    logs,
  };
}

async function main() {
  const live = await liveKillPath();
  const fill = await earlyBandOpenClosePath();
  const out = {
    mode: "paper",
    startingFundUsd: DESK.startingFundUsd,
    ticketUsd: DESK.ticketUsd,
    earlyBand: {
      minMcapUsd: DESK.entry.minMcapUsd,
      maxMcapUsd: DESK.entry.maxMcapUsd,
    },
    live,
    fill,
    ok: live.ok && fill.ok === true,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
