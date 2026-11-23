import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { emptyBandMarker, scanEarlyMcapBand } from "../lib/discovery.js";

export default defineTool({
  description: prompt`
    Read-only early-mcap scout for the paper desk. Fetches a public Solana pool
    list in front of fetch_token_facts: GeckoTerminal trending pools (first page),
    then new-pool pages walked until a pool is older than 30 minutes or the public
    page cap. DexScreener profiles and boosts are a second mint list with no mcap;
    each of those mints goes through the existing fact fetch. Keeps mints inside
    config minMcapUsd–maxMcapUsd and drops anything outside that band before hard
    kill. Identity is the mint, not the ticker. Returns symbol, mint, mcap, age,
    liquidity, and hardKill reasons for each in-band mint. When the filtered list
    is empty, empty is no_early_mcap_candidate. Does not open a paper position,
    does not take wallet keys, and does not change gate numbers. HELIUS stays
    read-only getAccountInfo inside the fact fetch.
  `,
  effect: "read",
  inputSchema: z.object({}),
  async execute() {
    const scan = await scanEarlyMcapBand();
    const empty = emptyBandMarker(scan.candidates.length);
    return {
      ...scan,
      paperOnly: true,
      noWalletKeys: true,
      next: empty ?? "log_each_candidate_hard_kill_reasons",
    };
  },
});
