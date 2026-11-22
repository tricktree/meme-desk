/**
 * Credential-free smoke: feeds (live) + gates + $100 bankroll open/close.
 * Run: npx tsx scripts/smoke-paper-path.ts
 */
import { DESK } from "../bot/lib/config.js";
import {
  bankrollSnapshot,
  guardOpen,
  money,
  type DeskBook,
  type LogLine,
} from "../bot/lib/book.js";
import { hardKill, judgeGate, memeGates } from "../bot/lib/gates.js";
import { fetchTokenFacts } from "../bot/lib/feeds.js";

type KvMem = { book?: DeskBook; log: LogLine[] };

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

async function main() {
  const out: Record<string, unknown> = {
    startingFundUsd: DESK.startingFundUsd,
    ticketUsd: DESK.ticketUsd,
  };

  // 1) Live feed on BONK — expect hard kill (age / mcap band / etc.)
  const bonk = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
  const live = await fetchTokenFacts(bonk);
  const liveKill = hardKill({
    mintAuthorityEnabled: live.mintAuthorityEnabled,
    freezeAuthorityEnabled: live.freezeAuthorityEnabled,
    lpLockedOrBurned: live.lpLockedOrBurned,
    top10PctExPool: live.top10PctExPool,
    devPct: live.devPct,
    insiders: live.insiders,
    liquidityUsd: live.liquidityUsd,
    ageMin: live.ageMin,
    riskScore: live.riskScore,
    vol1hUsd: live.vol1hUsd,
    buys1h: live.buys1h,
    sells1h: live.sells1h,
    mcapUsd: live.mcapUsd,
    unknownFields: live.unknownFields,
  });
  out.liveFeed = {
    mint: bonk,
    symbol: live.symbol,
    sources: live.sources,
    unknownFields: live.unknownFields,
    hardKill: liveKill,
    dossierStubKeys: Object.keys(live.dossier),
  };

  // 2) Synthetic survivor → judge → paper open/close vs $100 fund
  // Real POPCAT mint — synthetic facts only; smoke does not require live price.
  const mint = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";
  const facts = {
    mintAuthorityEnabled: false,
    freezeAuthorityEnabled: false,
    lpLockedOrBurned: true,
    top10PctExPool: 18,
    devPct: 1.2,
    insiders: 0,
    liquidityUsd: 80_000,
    ageMin: 90,
    riskScore: 12,
    vol1hUsd: 40_000,
    buys1h: 120,
    sells1h: 80,
    mcapUsd: 250_000,
  };
  const hk = hardKill(facts);
  const mg = memeGates({
    officialCaMatches: true,
    hasOfficialCaSource: true,
    volume24Usd: 50_000,
    mcapUsd: 250_000,
    quoteIsSolOrStable: true,
    mcapOverAth: 0.55,
    athAgeHours: 1.2,
    eventThemed: false,
  });
  const jg = judgeGate({
    action: "buy",
    actionP: 0.82,
    organic: "yes",
    organicP: 0.7,
    late: "no",
    exitRisk: 2,
  });
  out.syntheticGates = { hardKill: hk, memeGates: mg, judge: jg };

  const mem: KvMem = { book: emptyBook(), log: [] };
  const book = mem.book!;
  const size = DESK.ticketUsd;
  const blocked = guardOpen(book, mint, size);
  if (blocked || hk.verdict !== "pass" || mg.verdict !== "pass" || jg.verdict !== "buy") {
    out.bankroll = { error: "gates_blocked", blocked, hk, mg, jg };
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  book.cashUsd = money(book.cashUsd - size);
  book.positions[mint] = {
    mint,
    symbol: "SMOKE",
    openedAt: new Date().toISOString(),
    entryUsd: 0.01,
    sizeUsd: size,
    exitRule: "trail_20_after_take_80",
  };
  book.entriesToday += 1;
  const afterOpen = bankrollSnapshot(book, { [mint]: 0.01 });
  mem.log.push({
    time: new Date().toISOString(),
    kind: "paper_open",
    mint,
    symbol: "SMOKE",
    detail: `size=${size}`,
    sizeUsd: size,
    cashUsd: afterOpen.cashUsd,
    equityUsd: afterOpen.equityUsd,
    openExposureUsd: afterOpen.openExposureUsd,
    pnlUsd: 0,
  });

  // Close at +20%
  const mark = 0.012;
  const pos = book.positions[mint]!;
  const tradePnl = money(((mark - pos.entryUsd) / pos.entryUsd) * pos.sizeUsd);
  book.cashUsd = money(book.cashUsd + pos.sizeUsd + tradePnl);
  book.realizedPnlUsd = money(book.realizedPnlUsd + tradePnl);
  book.dayPnlUsd = money(book.dayPnlUsd + tradePnl);
  book.closedWins += 1;
  delete book.positions[mint];
  const afterClose = bankrollSnapshot(book);
  mem.log.push({
    time: new Date().toISOString(),
    kind: "paper_close",
    mint,
    symbol: "SMOKE",
    detail: "smoke_take",
    sizeUsd: size,
    pnlUsd: tradePnl,
    cashUsd: afterClose.cashUsd,
    equityUsd: afterClose.equityUsd,
    openExposureUsd: afterClose.openExposureUsd,
  });

  out.bankroll = {
    afterOpen,
    afterClose,
    tradePnlUsd: tradePnl,
    log: mem.log,
    expect: {
      openCash: 75,
      openEquity: 100,
      closeCash: 105,
      closeEquity: 105,
      winRate: 100,
    },
  };

  const ok =
    afterOpen.cashUsd === 75 &&
    afterOpen.equityUsd === 100 &&
    afterClose.cashUsd === 105 &&
    afterClose.equityUsd === 105 &&
    afterClose.winRate === 100 &&
    liveKill.verdict === "kill";

  out.ok = ok;
  console.log(JSON.stringify(out, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
