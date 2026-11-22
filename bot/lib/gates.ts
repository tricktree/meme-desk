import { DESK } from "./config.js";

export type HardKillFacts = {
  mintAuthorityEnabled?: boolean | null;
  freezeAuthorityEnabled?: boolean | null;
  lpLockedOrBurned?: boolean | null;
  top10PctExPool?: number | null;
  devPct?: number | null;
  insiders?: number | null;
  liquidityUsd?: number | null;
  ageMin?: number | null;
  riskScore?: number | null;
  vol1hUsd?: number | null;
  buys1h?: number | null;
  sells1h?: number | null;
  mcapUsd?: number | null;
  ticketUsd?: number | null;
  unknownFields?: string[];
};

export type MemeGateFacts = {
  copyMedianHoldMin?: number | null;
  fromCopyList?: boolean;
  officialCaMatches?: boolean | null;
  hasOfficialCaSource?: boolean | null;
  volume24Usd?: number | null;
  mcapUsd?: number | null;
  quoteIsSolOrStable?: boolean | null;
  baseMcapUsd?: number | null;
  base24hGreen?: boolean | null;
  mcapOverAth?: number | null;
  athAgeHours?: number | null;
  last5mClosedAboveAth?: boolean | null;
  independentCopyWallets15m?: number | null;
  eventThemed?: boolean | null;
  daysUntilEvent?: number | null;
  unknownFields?: string[];
};

export type JudgeAnswers = {
  action: "buy" | "watch" | "pass";
  actionP: number;
  organic: "yes" | "no";
  organicP: number;
  late: "yes" | "no";
  exitRisk: number;
  watchCount?: number;
};

function missing(label: string, value: unknown): string | null {
  if (value === null || value === undefined || Number.isNaN(value as number)) {
    return `missing:${label}`;
  }
  return null;
}

/** Fail closed: unknown / missing → kill. */
export function hardKill(facts: HardKillFacts): { verdict: "kill" | "pass"; reasons: string[] } {
  const reasons: string[] = [];
  const e = DESK.entry;
  const unknowns = facts.unknownFields ?? [];
  for (const u of unknowns) reasons.push(`missing:${u}`);

  const checks: Array<[string, unknown]> = [
    ["mintAuthorityEnabled", facts.mintAuthorityEnabled],
    ["freezeAuthorityEnabled", facts.freezeAuthorityEnabled],
    ["lpLockedOrBurned", facts.lpLockedOrBurned],
    ["top10PctExPool", facts.top10PctExPool],
    ["devPct", facts.devPct],
    ["liquidityUsd", facts.liquidityUsd],
    ["ageMin", facts.ageMin],
  ];
  for (const [k, v] of checks) {
    const m = missing(k, v);
    if (m) reasons.push(m);
  }
  if (reasons.length) return { verdict: "kill", reasons };

  if (facts.mintAuthorityEnabled) reasons.push("mint_authority_on");
  if (facts.freezeAuthorityEnabled) reasons.push("freeze_authority_on");
  if (facts.lpLockedOrBurned === false) reasons.push("lp_not_locked");
  if ((facts.top10PctExPool as number) > e.maxTop10Pct) reasons.push("top10");
  if ((facts.devPct as number) > e.maxDevPct) reasons.push("dev_pct");
  if ((facts.insiders ?? 0) > e.maxInsiders) reasons.push("insiders");
  if ((facts.liquidityUsd as number) < e.minLiquidityUsd) reasons.push("liquidity");
  if ((facts.ageMin as number) < e.minAgeMin) reasons.push("too_young");
  if ((facts.ageMin as number) > e.maxAgeHours * 60) reasons.push("too_old");
  if (facts.riskScore != null && facts.riskScore > e.maxRiskScore) reasons.push("risk_score");
  if (facts.vol1hUsd != null && facts.vol1hUsd < 15_000) reasons.push("volume_1h");
  if (facts.buys1h != null && facts.sells1h != null) {
    const ratio = facts.sells1h / Math.max(facts.buys1h, 1);
    if (ratio < 0.15) reasons.push("no_sells");
  }
  if (facts.mcapUsd != null && (facts.mcapUsd < 25_000 || facts.mcapUsd > 5_000_000)) {
    reasons.push("mcap_band");
  }
  const ticket = facts.ticketUsd ?? DESK.ticketUsd;
  if (facts.liquidityUsd != null && ticket / facts.liquidityUsd > e.maxTicketShare) {
    reasons.push("ticket_share");
  }

  return reasons.length ? { verdict: "kill", reasons } : { verdict: "pass", reasons: [] };
}

export function memeGates(facts: MemeGateFacts): { verdict: "kill" | "pass"; reasons: string[] } {
  const reasons: string[] = [];
  const g = DESK.gates;
  for (const u of facts.unknownFields ?? []) reasons.push(`missing:${u}`);

  if (facts.fromCopyList) {
    const m = missing("copyMedianHoldMin", facts.copyMedianHoldMin);
    if (m) reasons.push(m);
    else if ((facts.copyMedianHoldMin as number) < g.copyMinHoldMin) {
      reasons.push(`copy:median_hold_${facts.copyMedianHoldMin}m`);
    }
  }

  if (facts.hasOfficialCaSource === false) reasons.push("clone:no_source");
  if (facts.officialCaMatches === false) reasons.push("clone:not_official_ca");
  if (
    facts.volume24Usd != null &&
    facts.mcapUsd != null &&
    facts.volume24Usd >= g.deadCopyVolUsd &&
    facts.mcapUsd < g.deadCopyMcapUsd
  ) {
    reasons.push("clone:dead_copy");
  }

  if (facts.quoteIsSolOrStable === false) {
    if (facts.baseMcapUsd == null || facts.base24hGreen == null) {
      reasons.push("missing:pair_base");
    } else if (
      facts.baseMcapUsd < g.pairBaseMinMcapUsd ||
      facts.base24hGreen === false
    ) {
      reasons.push("pair:weak_base");
    }
  }

  if (facts.mcapOverAth != null) {
    if (
      facts.mcapOverAth >= g.lateZone &&
      facts.last5mClosedAboveAth !== true
    ) {
      reasons.push("late");
    }
  }

  if (
    facts.athAgeHours != null &&
    facts.mcapOverAth != null &&
    facts.athAgeHours > g.clockHighMaxAgeH &&
    facts.mcapOverAth < g.clockMinShareOfHigh
  ) {
    reasons.push("clock");
  }

  if (facts.eventThemed && facts.daysUntilEvent != null && facts.daysUntilEvent <= g.eventWindowDays) {
    reasons.push("event:late_launch");
  }

  return reasons.length ? { verdict: "kill", reasons } : { verdict: "pass", reasons: [] };
}

export function judgeGate(a: JudgeAnswers): {
  verdict: "buy" | "watch" | "pass" | "recheck_in_30m";
  killReason: string | null;
} {
  const j = DESK.judge;
  if (a.action === "watch") {
    return {
      verdict: (a.watchCount ?? 0) === 0 ? "recheck_in_30m" : "pass",
      killReason: (a.watchCount ?? 0) === 0 ? null : "second_watch",
    };
  }
  if (a.action !== "buy") return { verdict: "pass", killReason: `action_${a.action}` };
  if (a.actionP < j.minActionP) return { verdict: "pass", killReason: "action_p" };
  if (a.organic !== "yes" || a.organicP < j.minOrganicP) {
    return { verdict: "pass", killReason: "organic" };
  }
  if (a.late !== "no") return { verdict: "pass", killReason: "late" };
  if (a.exitRisk > j.maxExitRisk) return { verdict: "pass", killReason: "exit_risk" };
  return { verdict: "buy", killReason: null };
}
