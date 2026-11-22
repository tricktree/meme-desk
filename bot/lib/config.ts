/** Desk numbers. Human edits only — the agent must never loosen these. */

export const DESK = {
  mode: "paper" as const,
  /** Fixed virtual bankroll for signal-performance tracking. */
  startingFundUsd: 100,
  /** Flat ticket per paper open (confidence never scales size). */
  ticketUsd: 25,
  maxOpen: 4,
  maxEntriesPerDay: 6,
  /** Halt new entries when today's realized PnL hits this loss. */
  dailyLossHaltUsd: 10,
  cooldownHours: 24,
  entry: {
    maxRiskScore: 40,
    minLpLockedPct: 90,
    maxTop10Pct: 30,
    maxDevPct: 5,
    maxInsiders: 0,
    minLiquidityUsd: 30_000,
    maxTicketShare: 0.01,
    minAgeMin: 30,
    maxAgeHours: 48,
  },
  gates: {
    copyMinHoldMin: 5,
    deadCopyVolUsd: 1_000_000,
    deadCopyMcapUsd: 10_000,
    pairBaseMinMcapUsd: 10_000_000,
    lateZone: 0.8,
    clockHighMaxAgeH: 2,
    clockMinShareOfHigh: 0.3,
    signalMinWallets: 3,
    eventWindowDays: 7,
  },
  judge: {
    minActionP: 0.7,
    minOrganicP: 0.65,
    maxExitRisk: 3,
  },
  exit: {
    trailPct: 20,
    stopPct: -30,
    takePct: 80,
    takeFrac: 0.5,
    altFull2xAndStop50: false,
  },
  watch: {
    devSellPct: 20,
    devArmPct: 0.5,
    holdersPeelPct: 25,
    holdersGone: 3,
    liqDropPct: 30,
  },
} as const;

export type DeskConfig = typeof DESK;
