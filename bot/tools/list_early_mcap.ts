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
    kill. Identity is the mint, not the ticker. A hardKill pass continues through
    meme gates and the closed judge. paper_open is represented on the row only
    when the judge returns buy: flat $25 ticket, cash debited from the $100 fund,
    entry price and mcap from the facts, exit attached. A meme-gate or judge fail
    is a logged kill and takes no ticket. Organic, late, and exit risk are filled
    from measured 1h flow, the 1h share of the 24h move, and ticket share of the
    pool. Missing flow or a missing move does not buy. When the filtered list
    is empty, empty is no_early_mcap_candidate. Does not sign, does not take wallet keys, and
    does not change gate numbers. HELIUS stays read-only getAccountInfo inside
    the fact fetch.
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
