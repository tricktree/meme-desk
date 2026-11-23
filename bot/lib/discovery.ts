/**
 * Read-only Solana pool list in front of fetchTokenFacts.
 * GeckoTerminal trending pools (page 1), then new-pool pages walked until a
 * pool is older than 30 minutes or the public page cap. DexScreener profiles
 * and boosts are a second mint list and still go through fetchTokenFacts.
 * Anything outside minMcapUsd–maxMcapUsd is dropped before hardKill.
 * No wallet keys. No signing. Helius stays inside fetchTokenFacts (getAccountInfo).
 */

import { DESK } from "./config.js";
import { isSolanaMint } from "./book.js";
import { hardKill, type HardKillFacts } from "./gates.js";
import { fetchTokenFacts, type FeedSourceStatus, type TokenFacts } from "./feeds.js";

const GT_TRENDING =
  "https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1&include=base_token,quote_token";
const GT_NEW =
  "https://api.geckoterminal.com/api/v2/networks/solana/new_pools";
/** Public GeckoTerminal new_pools pagination stops at page 10. */
const GECKO_PUBLIC_PAGE_CAP = 10;
const FACT_FETCH_CONCURRENCY = 6;

const DS_LISTS = [
  {
    url: "https://api.dexscreener.com/token-profiles/latest/v1",
    source: "dexscreener_profiles",
  },
  {
    url: "https://api.dexscreener.com/token-boosts/latest/v1",
    source: "dexscreener_boosts_latest",
  },
  {
    url: "https://api.dexscreener.com/token-boosts/top/v1",
    source: "dexscreener_boosts_top",
  },
] as const;

/** Quote assets. The candidate is the other side of the pool. */
const QUOTE_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

export type PoolListSource =
  | "geckoterminal_trending"
  | "geckoterminal_new"
  | "dexscreener_profiles"
  | "dexscreener_boosts_latest"
  | "dexscreener_boosts_top";

export type NewPoolWalkStop =
  | "older_than_30m"
  | "public_page_cap"
  | "empty_page"
  | "http_error";

export type GeckoHit = {
  mint: string;
  symbol: string | null;
  mcapUsd: number | null;
  liquidityUsd: number | null;
  ageMin: number | null;
  source: "geckoterminal_trending" | "geckoterminal_new";
};

export type EarlyBandCandidate = {
  symbol: string | null;
  mint: string;
  mcapUsd: number;
  ageMin: number | null;
  liquidityUsd: number | null;
  source: PoolListSource;
  hardKill: { verdict: "kill" | "pass"; reasons: string[] };
};

export type DiscoveryMeta = {
  trendingRowCount: number;
  newPoolPagesWalked: number;
  oldestNewPoolAgeMin: number | null;
  newPoolWalkStop: NewPoolWalkStop;
  /** True when any fetched new-pool row is older than the 30-minute walk target. */
  newPoolsIncludedOlderThan30Min: boolean;
  dexscreenerMintCount: number;
  factFetchCount: number;
  droppedOutsideBand: number;
  sources: FeedSourceStatus[];
};

export type EarlyBandScan = {
  minMcapUsd: number;
  maxMcapUsd: number;
  candidates: EarlyBandCandidate[];
  /** Set only when the filtered band is empty. */
  empty?: "no_early_mcap_candidate";
  listsOk: boolean;
  discovery: DiscoveryMeta;
};

type PendingMint = {
  mint: string;
  symbol: string | null;
  listMcapUsd: number | null;
  liquidityUsd: number | null;
  ageMin: number | null;
  source: PoolListSource;
};

export function isInEarlyMcapBand(mcapUsd: number): boolean {
  return mcapUsd >= DESK.entry.minMcapUsd && mcapUsd <= DESK.entry.maxMcapUsd;
}

/** Present on a scan only when the filtered band has no mints. */
export function emptyBandMarker(
  candidateCount: number,
): "no_early_mcap_candidate" | undefined {
  return candidateCount === 0 ? "no_early_mcap_candidate" : undefined;
}

function withUniqueReasons(result: {
  verdict: "kill" | "pass";
  reasons: string[];
}): { verdict: "kill" | "pass"; reasons: string[] } {
  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const reason of result.reasons) {
    if (seen.has(reason)) continue;
    seen.add(reason);
    reasons.push(reason);
  }
  return { verdict: result.verdict, reasons };
}

function finiteMcap(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

function positiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function ageMinFromIso(iso: unknown, now = Date.now()): number | null {
  if (typeof iso !== "string" || !iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 60_000));
}

function geckoMint(id: unknown): string | null {
  if (typeof id !== "string" || !id.startsWith("solana_")) return null;
  const mint = id.slice("solana_".length);
  return isSolanaMint(mint) ? mint : null;
}

function symbolIndex(body: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!body || typeof body !== "object") return map;
  const included = (body as { included?: unknown }).included;
  if (!Array.isArray(included)) return map;
  for (const item of included) {
    if (!item || typeof item !== "object") continue;
    const rec = item as {
      id?: string;
      attributes?: { address?: string; symbol?: string };
    };
    const symbol = rec.attributes?.symbol?.trim();
    if (!symbol) continue;
    if (rec.attributes?.address) map.set(rec.attributes.address, symbol);
    if (rec.id) map.set(rec.id, symbol);
  }
  return map;
}

/** One hit per pool. Same ticker with two mints stays two hits. */
export function readGeckoPools(
  body: unknown,
  source: "geckoterminal_trending" | "geckoterminal_new",
  now = Date.now(),
): GeckoHit[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const symbols = symbolIndex(body);
  const hits: GeckoHit[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const pool = item as {
      attributes?: {
        name?: string;
        market_cap_usd?: unknown;
        fdv_usd?: unknown;
        reserve_in_usd?: unknown;
        pool_created_at?: unknown;
      };
      relationships?: {
        base_token?: { data?: { id?: string } };
        quote_token?: { data?: { id?: string } };
      };
    };
    const baseId = pool.relationships?.base_token?.data?.id;
    const quoteId = pool.relationships?.quote_token?.data?.id;
    const base = geckoMint(baseId);
    const quote = geckoMint(quoteId);
    const name = typeof pool.attributes?.name === "string" ? pool.attributes.name : "";
    const [left, right] = name.split(" / ");
    let mint: string | null = null;
    let symbol: string | null = null;
    if (base && !QUOTE_MINTS.has(base)) {
      mint = base;
      symbol = (baseId && symbols.get(baseId)) || symbols.get(base) || left || null;
    } else if (quote && !QUOTE_MINTS.has(quote)) {
      mint = quote;
      symbol = (quoteId && symbols.get(quoteId)) || symbols.get(quote) || right || null;
    }
    if (!mint) continue;
    const attrs = pool.attributes;
    hits.push({
      mint,
      symbol: symbol?.trim() || null,
      mcapUsd: positiveNumber(attrs?.market_cap_usd) ?? positiveNumber(attrs?.fdv_usd),
      liquidityUsd: positiveNumber(attrs?.reserve_in_usd),
      ageMin: ageMinFromIso(attrs?.pool_created_at, now),
      source,
    });
  }
  return hits;
}

/**
 * One row per mint. A ticker shared by two mints is kept twice.
 * When one mint has several pools, prefer an in-band measurement,
 * then the deepest liquidity, then a trending row.
 */
export function collapseGeckoHits(hits: GeckoHit[]): GeckoHit[] {
  const groups = new Map<string, GeckoHit[]>();
  for (const hit of hits) {
    const group = groups.get(hit.mint);
    if (group) group.push(hit);
    else groups.set(hit.mint, [hit]);
  }
  const chosen: GeckoHit[] = [];
  for (const group of groups.values()) {
    const withMcap = group.filter((hit) => hit.mcapUsd != null);
    if (!withMcap.length) {
      chosen.push(group[0]!);
      continue;
    }
    const inBand = withMcap.filter((hit) => isInEarlyMcapBand(hit.mcapUsd as number));
    const pool = (inBand.length ? inBand : withMcap).slice();
    pool.sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
    chosen.push(pool.find((hit) => hit.source === "geckoterminal_trending") ?? pool[0]!);
  }
  return chosen;
}

function solanaMintsFromDexList(body: unknown): string[] {
  if (!Array.isArray(body)) return [];
  const mints: string[] = [];
  for (const row of body) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { chainId?: string; tokenAddress?: string };
    if (rec.chainId !== "solana") continue;
    const mint = rec.tokenAddress?.trim() ?? "";
    if (!isSolanaMint(mint) || QUOTE_MINTS.has(mint)) continue;
    mints.push(mint);
  }
  return mints;
}

async function fetchJson(
  url: string,
  source: string,
  sources: FeedSourceStatus[],
  accept: string,
): Promise<{ ok: boolean; status?: number; body: unknown | null }> {
  try {
    const res = await fetch(url, {
      headers: { accept, "user-agent": "meme-desk-paper" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      sources.push({ name: source, ok: false, status: res.status });
      return { ok: false, status: res.status, body: null };
    }
    sources.push({ name: source, ok: true, status: res.status });
    return { ok: true, status: res.status, body: await res.json() };
  } catch (e) {
    sources.push({
      name: source,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, body: null };
  }
}

async function fetchJsonRetry429(
  url: string,
  source: string,
  sources: FeedSourceStatus[],
  accept: string,
) {
  const first = await fetchJson(url, source, sources, accept);
  if (first.status !== 429) return first;
  await new Promise((resolve) => setTimeout(resolve, 6_000));
  return fetchJson(url, `${source}_retry`, sources, accept);
}

async function loadDexMints(sources: FeedSourceStatus[]): Promise<Map<string, PoolListSource>> {
  const byMint = new Map<string, PoolListSource>();
  const pages = await Promise.all(
    DS_LISTS.map((spec) =>
      fetchJson(spec.url, spec.source, sources, "application/json").then((hit) => ({
        spec,
        hit,
      })),
    ),
  );
  for (const { spec, hit } of pages) {
    if (!hit.body) continue;
    for (const mint of solanaMintsFromDexList(hit.body)) {
      if (!byMint.has(mint)) byMint.set(mint, spec.source);
    }
  }
  return byMint;
}

async function walkNewPools(
  sources: FeedSourceStatus[],
  now: number,
): Promise<{
  rows: GeckoHit[];
  pagesWalked: number;
  oldestAgeMin: number | null;
  stop: NewPoolWalkStop;
}> {
  const rows: GeckoHit[] = [];
  let oldestAgeMin: number | null = null;
  let pagesWalked = 0;
  let stop: NewPoolWalkStop = "public_page_cap";
  const accept = "application/json;version=20230203";
  for (let page = 1; page <= GECKO_PUBLIC_PAGE_CAP; page++) {
    const url = `${GT_NEW}?page=${page}&include=base_token,quote_token`;
    const hit = await fetchJsonRetry429(url, `geckoterminal_new_p${page}`, sources, accept);
    if (!hit.ok || hit.body == null) {
      stop = "http_error";
      break;
    }
    const parsed = readGeckoPools(hit.body, "geckoterminal_new", now);
    pagesWalked = page;
    if (!parsed.length) {
      stop = "empty_page";
      break;
    }
    rows.push(...parsed);
    let pageOldest: number | null = null;
    for (const row of parsed) {
      if (row.ageMin == null) continue;
      pageOldest = pageOldest == null ? row.ageMin : Math.max(pageOldest, row.ageMin);
    }
    if (pageOldest != null) {
      oldestAgeMin = oldestAgeMin == null ? pageOldest : Math.max(oldestAgeMin, pageOldest);
    }
    if (pageOldest != null && pageOldest > DESK.entry.minAgeMin) {
      stop = "older_than_30m";
      break;
    }
  }
  return { rows, pagesWalked, oldestAgeMin, stop };
}

export function hardKillFromFacts(
  facts: TokenFacts,
  overrides?: { mcapUsd?: number | null; ageMin?: number | null; liquidityUsd?: number | null },
): { verdict: "kill" | "pass"; reasons: string[] } {
  const mcapUsd = overrides && "mcapUsd" in overrides ? overrides.mcapUsd : facts.mcapUsd;
  const ageMin = overrides && "ageMin" in overrides ? overrides.ageMin : facts.ageMin;
  const liquidityUsd =
    overrides && "liquidityUsd" in overrides ? overrides.liquidityUsd : facts.liquidityUsd;
  const unknownFields = facts.unknownFields.filter((label) => {
    if (label === "ageMin" && ageMin != null) return false;
    if (label === "liquidityUsd" && liquidityUsd != null) return false;
    return true;
  });
  const input: HardKillFacts = {
    mintAuthorityEnabled: facts.mintAuthorityEnabled,
    freezeAuthorityEnabled: facts.freezeAuthorityEnabled,
    lpLockedOrBurned: facts.lpLockedOrBurned,
    top10PctExPool: facts.top10PctExPool,
    devPct: facts.devPct,
    insiders: facts.insiders,
    liquidityUsd,
    ageMin,
    riskScore: facts.riskScore,
    vol1hUsd: facts.vol1hUsd,
    buys1h: facts.buys1h,
    sells1h: facts.sells1h,
    mcapUsd,
    unknownFields,
  };
  return withUniqueReasons(hardKill(input));
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return out;
}

function failClosedKill(
  row: PendingMint,
): { verdict: "kill" | "pass"; reasons: string[] } {
  const unknownFields = [
    "mintAuthorityEnabled",
    "freezeAuthorityEnabled",
    "lpLockedOrBurned",
    "top10PctExPool",
    "devPct",
  ];
  if (row.liquidityUsd == null) unknownFields.push("liquidityUsd");
  if (row.ageMin == null) unknownFields.push("ageMin");
  return withUniqueReasons(
    hardKill({
      liquidityUsd: row.liquidityUsd,
      ageMin: row.ageMin,
      mcapUsd: row.listMcapUsd,
      unknownFields,
    }),
  );
}

/**
 * Discover Solana mints inside the early mcap band and hard-kill each one.
 * Prints nothing. Caller logs symbol, mint, mcap, age, liquidity, and reasons.
 */
export async function scanEarlyMcapBand(now = Date.now()): Promise<EarlyBandScan> {
  const sources: FeedSourceStatus[] = [];
  const [trendingHit, walked, dexMints] = await Promise.all([
    fetchJson(
      GT_TRENDING,
      "geckoterminal_trending",
      sources,
      "application/json;version=20230203",
    ),
    walkNewPools(sources, now),
    loadDexMints(sources),
  ]);

  const trendingRows = trendingHit.body
    ? readGeckoPools(trendingHit.body, "geckoterminal_trending", now)
    : [];
  const collapsed = collapseGeckoHits([...trendingRows, ...walked.rows]);
  const outside = new Set<string>();
  const pending: PendingMint[] = [];
  let droppedOutsideBand = 0;

  for (const hit of collapsed) {
    if (hit.mcapUsd == null) {
      pending.push({
        mint: hit.mint,
        symbol: hit.symbol,
        listMcapUsd: null,
        liquidityUsd: hit.liquidityUsd,
        ageMin: hit.ageMin,
        source: hit.source,
      });
      continue;
    }
    if (!isInEarlyMcapBand(hit.mcapUsd)) {
      outside.add(hit.mint);
      droppedOutsideBand += 1;
      continue;
    }
    pending.push({
      mint: hit.mint,
      symbol: hit.symbol,
      listMcapUsd: hit.mcapUsd,
      liquidityUsd: hit.liquidityUsd,
      ageMin: hit.ageMin,
      source: hit.source,
    });
  }

  const seen = new Set(pending.map((row) => row.mint));
  for (const [mint, source] of dexMints) {
    if (outside.has(mint) || seen.has(mint)) continue;
    seen.add(mint);
    pending.push({
      mint,
      symbol: null,
      listMcapUsd: null,
      liquidityUsd: null,
      ageMin: null,
      source,
    });
  }

  const measured = await mapLimit(pending, FACT_FETCH_CONCURRENCY, async (row) => {
    try {
      const facts = await fetchTokenFacts(row.mint);
      return { row, facts, error: false };
    } catch {
      return { row, facts: null, error: true };
    }
  });

  const candidates: EarlyBandCandidate[] = [];
  for (const item of measured) {
    const { row } = item;
    if (item.error || !item.facts) {
      const listMcap = finiteMcap(row.listMcapUsd);
      if (listMcap == null || !isInEarlyMcapBand(listMcap)) {
        droppedOutsideBand += 1;
        continue;
      }
      candidates.push({
        symbol: row.symbol,
        mint: row.mint,
        mcapUsd: listMcap,
        ageMin: row.ageMin,
        liquidityUsd: row.liquidityUsd,
        source: row.source,
        hardKill: failClosedKill(row),
      });
      continue;
    }
    const facts = item.facts;
    const measuredMcap = finiteMcap(facts.mcapUsd);
    const mcapUsd = measuredMcap ?? finiteMcap(row.listMcapUsd);
    if (mcapUsd == null || !isInEarlyMcapBand(mcapUsd)) {
      droppedOutsideBand += 1;
      continue;
    }
    const ageMin = facts.ageMin ?? row.ageMin;
    const liquidityUsd = facts.liquidityUsd ?? row.liquidityUsd;
    candidates.push({
      symbol: facts.symbol ?? row.symbol,
      mint: row.mint,
      mcapUsd,
      ageMin,
      liquidityUsd,
      source: row.source,
      hardKill: hardKillFromFacts(facts, { mcapUsd, ageMin, liquidityUsd }),
    });
  }

  const listsOk = sources.some(
    (source) =>
      source.ok &&
      (source.name.startsWith("geckoterminal") || source.name.startsWith("dexscreener_")),
  );

  const scan: EarlyBandScan = {
    minMcapUsd: DESK.entry.minMcapUsd,
    maxMcapUsd: DESK.entry.maxMcapUsd,
    candidates,
    listsOk,
    discovery: {
      trendingRowCount: trendingRows.length,
      newPoolPagesWalked: walked.pagesWalked,
      oldestNewPoolAgeMin: walked.oldestAgeMin,
      newPoolWalkStop: walked.stop,
      newPoolsIncludedOlderThan30Min: walked.stop === "older_than_30m",
      dexscreenerMintCount: dexMints.size,
      factFetchCount: pending.length,
      droppedOutsideBand,
      sources,
    },
  };
  const empty = emptyBandMarker(candidates.length);
  if (empty) scan.empty = empty;
  return scan;
}
