/**
 * Read-only market / risk feeds. No wallet keys. No signing.
 * Public: DexScreener + Rugcheck. Optional RPC via env for mint authorities.
 */

import fs from "node:fs";
import path from "node:path";

const DS_PAIRS = "https://api.dexscreener.com/token-pairs/v1/solana/";
const DS_SEARCH = "https://api.dexscreener.com/latest/dex/search?q=";
const RUGCHECK = "https://api.rugcheck.xyz/v1/tokens/";

export type FeedSourceStatus = {
  name: string;
  ok: boolean;
  status?: number;
  error?: string;
};

export type TokenFacts = {
  mint: string;
  symbol: string | null;
  name: string | null;
  priceUsd: number | null;
  mcapUsd: number | null;
  liquidityUsd: number | null;
  vol1hUsd: number | null;
  vol24Usd: number | null;
  buys1h: number | null;
  sells1h: number | null;
  ageMin: number | null;
  pairAddress: string | null;
  quoteSymbol: string | null;
  quoteIsSolOrStable: boolean | null;
  mintAuthorityEnabled: boolean | null;
  freezeAuthorityEnabled: boolean | null;
  lpLockedOrBurned: boolean | null;
  lpLockedPct: number | null;
  top10PctExPool: number | null;
  devPct: number | null;
  insiders: number | null;
  riskScore: number | null;
  rugged: boolean | null;
  unknownFields: string[];
  sources: FeedSourceStatus[];
  /** Which env resolved the optional RPC, or null if unset. Never includes the secret. */
  rpcSource: string | null;
  dossier: Record<string, string | number | boolean | null>;
};

export type RpcResolve =
  | { configured: false }
  | { configured: true; url: string; source: string };

const RPC_ENV_NAMES = [
  "HELIUS_RPC_URL",
  "HELIUS_API_KEY",
  "QUICKNODE_RPC_URL",
  "SOLANA_RPC_URL",
  "RPC_URL",
] as const;

let dotenvLoaded = false;

/**
 * Load gitignored `/agent/meme-desk/.env` (or cwd `.env`) into process.env
 * for RPC vars only when unset. Never logs values. Safe if file missing.
 */
export function loadRpcDotEnv(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  try {
    const candidates = [
      path.resolve(process.cwd(), ".env"),
      path.resolve(process.cwd(), "meme-desk/.env"),
      "/agent/meme-desk/.env",
    ];
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        if (!(RPC_ENV_NAMES as readonly string[]).includes(key)) continue;
        if (process.env[key]?.trim()) continue;
        let val = line.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (val) process.env[key] = val;
      }
      break;
    }
  } catch {
    // ignore — public feeds still work without RPC
  }
}

/**
 * Resolve optional read-only Solana JSON-RPC endpoint.
 * Priority: HELIUS_RPC_URL → HELIUS_API_KEY (Helius mainnet URL) →
 * QUICKNODE_RPC_URL → SOLANA_RPC_URL → RPC_URL.
 * Never accepts wallet private keys / seed phrases.
 */
export function resolveRpcEndpoint(): RpcResolve {
  loadRpcDotEnv();

  const heliusUrl = process.env.HELIUS_RPC_URL?.trim();
  if (heliusUrl) return { configured: true, url: heliusUrl, source: "HELIUS_RPC_URL" };

  const heliusKey = process.env.HELIUS_API_KEY?.trim();
  if (heliusKey) {
    return {
      configured: true,
      url: `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`,
      source: "HELIUS_API_KEY",
    };
  }

  const qn = process.env.QUICKNODE_RPC_URL?.trim();
  if (qn) return { configured: true, url: qn, source: "QUICKNODE_RPC_URL" };

  const sol = process.env.SOLANA_RPC_URL?.trim();
  if (sol) return { configured: true, url: sol, source: "SOLANA_RPC_URL" };

  const rpc = process.env.RPC_URL?.trim();
  if (rpc) return { configured: true, url: rpc, source: "RPC_URL" };

  return { configured: false };
}

export function rpcEnvHint(): string {
  return "HELIUS_API_KEY | HELIUS_RPC_URL | QUICKNODE_RPC_URL | SOLANA_RPC_URL | RPC_URL";
}

async function getJson(
  url: string,
  source: string,
  sources: FeedSourceStatus[],
): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      sources.push({ name: source, ok: false, status: res.status });
      return null;
    }
    sources.push({ name: source, ok: true, status: res.status });
    return await res.json();
  } catch (e) {
    sources.push({
      name: source,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

function isStableOrSol(sym: string | undefined | null): boolean {
  if (!sym) return false;
  const s = sym.toUpperCase();
  return s === "SOL" || s === "WSOL" || s === "USDC" || s === "USDT" || s === "USD1";
}

type DsPair = {
  chainId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; symbol?: string; name?: string };
  quoteToken?: { address?: string; symbol?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h1?: number; h24?: number };
  txns?: { h1?: { buys?: number; sells?: number } };
  marketCap?: number;
  fdv?: number;
  pairCreatedAt?: number;
};

function pickBestPair(pairs: DsPair[], mint: string): DsPair | null {
  const sol = pairs.filter(
    (p) =>
      p.chainId === "solana" &&
      (p.baseToken?.address === mint || p.quoteToken?.address === mint),
  );
  const list = sol.length ? sol : pairs;
  if (!list.length) return null;
  return [...list].sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
  )[0];
}

async function fetchDex(mint: string, sources: FeedSourceStatus[]) {
  let data = await getJson(`${DS_PAIRS}${mint}`, "dexscreener_pairs", sources);
  if (!data) {
    data = await getJson(`${DS_SEARCH}${encodeURIComponent(mint)}`, "dexscreener_search", sources);
    if (data && typeof data === "object" && "pairs" in data) {
      data = (data as { pairs: DsPair[] }).pairs;
    }
  }
  if (!Array.isArray(data)) return null;
  return pickBestPair(data as DsPair[], mint);
}

type RugReport = {
  score_normalised?: number;
  rugged?: boolean;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  token?: { mintAuthority?: string | null; freezeAuthority?: string | null };
  topHolders?: Array<{ pct?: number; insider?: boolean; owner?: string; address?: string }>;
  markets?: Array<{ lp?: { lpLockedPct?: number; lpLocked?: number } }>;
  totalMarketLiquidity?: number;
  creator?: string | null;
  graphInsidersDetected?: number;
};

function fromRug(r: RugReport) {
  const mintAuth = r.mintAuthority ?? r.token?.mintAuthority ?? null;
  const freezeAuth = r.freezeAuthority ?? r.token?.freezeAuthority ?? null;
  let lpLockedPct: number | null = null;
  for (const m of r.markets ?? []) {
    const pct = m.lp?.lpLockedPct;
    if (typeof pct === "number") {
      lpLockedPct = Math.max(lpLockedPct ?? 0, pct);
    }
  }
  // Treat burned/locked LP as ok when locked pct >= 90 or no LP mint left unlocked.
  const lpLockedOrBurned =
    lpLockedPct == null ? null : lpLockedPct >= 90;

  const holders = r.topHolders ?? [];
  // Exclude obvious program/pool-ish by not filtering addresses here; rugcheck
  // already ranks holders. Sum top 10 pct (raw) — may include pools; unknown if empty.
  const top10 = holders.slice(0, 10);
  const top10PctExPool =
    top10.length === 0
      ? null
      : top10.reduce((s, h) => s + (h.pct ?? 0), 0);

  const creator = r.creator ?? null;
  const creatorHolder = holders.find(
    (h) => h.owner === creator || h.address === creator,
  );
  const insiders = holders.filter((h) => h.insider).length;

  return {
    mintAuthorityEnabled: mintAuth == null ? false : true,
    freezeAuthorityEnabled: freezeAuth == null ? false : true,
    // When rugcheck reports null authority, mint/freeze are disabled (good).
    lpLockedOrBurned,
    lpLockedPct,
    top10PctExPool,
    devPct: creatorHolder?.pct ?? (creator ? 0 : null),
    insiders: r.graphInsidersDetected ?? insiders,
    riskScore: r.score_normalised ?? null,
    rugged: r.rugged ?? null,
    liquidityUsd: r.totalMarketLiquidity ?? null,
  };
}

async function fetchRpcAuthorities(
  mint: string,
  sources: FeedSourceStatus[],
): Promise<{
  mintAuthorityEnabled: boolean | null;
  freezeAuthorityEnabled: boolean | null;
  rpcSource: string | null;
}> {
  const rpc = resolveRpcEndpoint();
  if (!rpc.configured) {
    sources.push({
      name: "solana_rpc",
      ok: false,
      error: `unset (optional: ${rpcEnvHint()})`,
    });
    return {
      mintAuthorityEnabled: null,
      freezeAuthorityEnabled: null,
      rpcSource: null,
    };
  }
  const sourceName = `solana_rpc:${rpc.source}`;
  try {
    const res = await fetch(rpc.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [mint, { encoding: "jsonParsed", commitment: "confirmed" }],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      sources.push({ name: sourceName, ok: false, status: res.status });
      return {
        mintAuthorityEnabled: null,
        freezeAuthorityEnabled: null,
        rpcSource: rpc.source,
      };
    }
    const body = (await res.json()) as {
      result?: {
        value?: {
          data?: {
            parsed?: {
              info?: {
                mintAuthority?: string | null;
                freezeAuthority?: string | null;
              };
            };
          };
        };
      };
      error?: { message?: string };
    };
    if (body.error) {
      sources.push({ name: sourceName, ok: false, error: body.error.message });
      return {
        mintAuthorityEnabled: null,
        freezeAuthorityEnabled: null,
        rpcSource: rpc.source,
      };
    }
    const info = body.result?.value?.data?.parsed?.info;
    if (!info) {
      sources.push({ name: sourceName, ok: false, error: "no_parsed_mint_info" });
      return {
        mintAuthorityEnabled: null,
        freezeAuthorityEnabled: null,
        rpcSource: rpc.source,
      };
    }
    sources.push({ name: sourceName, ok: true, status: res.status });
    return {
      mintAuthorityEnabled: info.mintAuthority != null,
      freezeAuthorityEnabled: info.freezeAuthority != null,
      rpcSource: rpc.source,
    };
  } catch (e) {
    sources.push({
      name: sourceName,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    return {
      mintAuthorityEnabled: null,
      freezeAuthorityEnabled: null,
      rpcSource: rpc.source,
    };
  }
}

export async function fetchTokenFacts(mint: string): Promise<TokenFacts> {
  const sources: FeedSourceStatus[] = [];
  const unknownFields: string[] = [];

  const [pair, rugRaw, rpcAuth] = await Promise.all([
    fetchDex(mint, sources),
    getJson(`${RUGCHECK}${mint}/report`, "rugcheck", sources),
    fetchRpcAuthorities(mint, sources),
  ]);

  const rug = (rugRaw && typeof rugRaw === "object" ? fromRug(rugRaw as RugReport) : null);

  const ageMin =
    pair?.pairCreatedAt != null
      ? Math.max(0, Math.floor((Date.now() - pair.pairCreatedAt) / 60_000))
      : null;

  const quoteSym = pair?.quoteToken?.symbol ?? null;
  const baseIsMint = pair?.baseToken?.address === mint;
  const symbol = baseIsMint
    ? (pair?.baseToken?.symbol ?? null)
    : (pair?.quoteToken?.symbol ?? pair?.baseToken?.symbol ?? null);
  const name = baseIsMint
    ? (pair?.baseToken?.name ?? null)
    : (pair?.baseToken?.name ?? null);

  let mintAuthorityEnabled = rug?.mintAuthorityEnabled ?? null;
  let freezeAuthorityEnabled = rug?.freezeAuthorityEnabled ?? null;
  // Prefer RPC when configured and successful.
  if (rpcAuth.mintAuthorityEnabled != null) mintAuthorityEnabled = rpcAuth.mintAuthorityEnabled;
  if (rpcAuth.freezeAuthorityEnabled != null) {
    freezeAuthorityEnabled = rpcAuth.freezeAuthorityEnabled;
  }

  const facts: TokenFacts = {
    mint,
    symbol,
    name,
    priceUsd: pair?.priceUsd != null ? Number(pair.priceUsd) : null,
    mcapUsd: pair?.marketCap ?? pair?.fdv ?? null,
    liquidityUsd: pair?.liquidity?.usd ?? rug?.liquidityUsd ?? null,
    vol1hUsd: pair?.volume?.h1 ?? null,
    vol24Usd: pair?.volume?.h24 ?? null,
    buys1h: pair?.txns?.h1?.buys ?? null,
    sells1h: pair?.txns?.h1?.sells ?? null,
    ageMin,
    pairAddress: pair?.pairAddress ?? null,
    quoteSymbol: quoteSym,
    quoteIsSolOrStable: quoteSym == null ? null : isStableOrSol(quoteSym),
    mintAuthorityEnabled,
    freezeAuthorityEnabled,
    lpLockedOrBurned: rug?.lpLockedOrBurned ?? null,
    lpLockedPct: rug?.lpLockedPct ?? null,
    top10PctExPool: rug?.top10PctExPool ?? null,
    devPct: rug?.devPct ?? null,
    insiders: rug?.insiders ?? null,
    riskScore: rug?.riskScore ?? null,
    rugged: rug?.rugged ?? null,
    unknownFields,
    sources,
    rpcSource: rpcAuth.rpcSource,
    dossier: {},
  };

  const required: Array<[keyof TokenFacts, string]> = [
    ["mintAuthorityEnabled", "mintAuthorityEnabled"],
    ["freezeAuthorityEnabled", "freezeAuthorityEnabled"],
    ["lpLockedOrBurned", "lpLockedOrBurned"],
    ["top10PctExPool", "top10PctExPool"],
    ["liquidityUsd", "liquidityUsd"],
    ["ageMin", "ageMin"],
  ];
  for (const [field, label] of required) {
    if (facts[field] === null || facts[field] === undefined) unknownFields.push(label);
  }

  facts.dossier = {
    mint,
    symbol: facts.symbol,
    name: facts.name,
    priceUsd: facts.priceUsd,
    mcapUsd: facts.mcapUsd,
    liquidityUsd: facts.liquidityUsd,
    vol1hUsd: facts.vol1hUsd,
    vol24Usd: facts.vol24Usd,
    buys1h: facts.buys1h,
    sells1h: facts.sells1h,
    ageMin: facts.ageMin,
    pairAddress: facts.pairAddress,
    quoteSymbol: facts.quoteSymbol,
    mintAuthorityEnabled: facts.mintAuthorityEnabled,
    freezeAuthorityEnabled: facts.freezeAuthorityEnabled,
    lpLockedPct: facts.lpLockedPct,
    lpLockedOrBurned: facts.lpLockedOrBurned,
    top10PctExPool: facts.top10PctExPool,
    devPct: facts.devPct,
    riskScore: facts.riskScore,
    rugged: facts.rugged,
    missing: unknownFields.join(",") || null,
  };

  return facts;
}
