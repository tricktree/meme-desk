import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { fetchTokenFacts } from "../lib/feeds.js";

export default defineTool({
  description: prompt`
    Fetch read-only Solana token facts for the paper desk funnel.
    Uses public DexScreener + Rugcheck. Optional read-only RPC from HELIUS_API_KEY,
    HELIUS_RPC_URL, QUICKNODE_RPC_URL, SOLANA_RPC_URL, or RPC_URL (never a wallet key).
    Returns hard_kill-ready fields, rpcSource (env name or null), and a facts-only dossier stub.
    Fail-closed: missing → listed in unknownFields.
  `,
  effect: "read",
  inputSchema: z.object({
    mint: z.string().min(32).max(64),
  }),
  async execute({ mint }) {
    const facts = await fetchTokenFacts(mint.trim());
    return {
      ...facts,
      next: "hard_kill_check_with_these_fields",
      paperOnly: true,
      noWalletKeys: true,
    };
  },
});
