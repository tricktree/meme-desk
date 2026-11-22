import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { appendLog, isSolanaMint } from "../lib/book.js";

export default defineTool({
  description: prompt`
    Append one desk log line for a kill, pass, or watch. Use after any gate fails
    or judge passes so funnel metrics stay honest.
    When mint is set, it must be the Solana base58 CA from fetch_token_facts — never a symbol.
  `,
  effect: "write",
  dryRunResult: ({ kind, mint, detail }) => ({
    logged: false,
    dryRun: true,
    kind,
    mint,
    detail,
  }),
  inputSchema: z.object({
    kind: z.enum(["kill", "pass", "watch", "note"]),
    mint: z.string().min(32).max(44).optional(),
    symbol: z.string().optional(),
    detail: z.string().min(1),
  }),
  async execute(input, ctx) {
    if (input.mint && !isSolanaMint(input.mint)) {
      return {
        logged: false,
        error: "invalid_mint_ca",
        hint: "mint must be Solana base58 CA, not a symbol or placeholder label",
      };
    }
    await appendLog(ctx.host.kv, {
      time: new Date().toISOString(),
      kind: input.kind,
      mint: input.mint,
      symbol: input.symbol,
      detail: input.detail,
    });
    return { logged: true, ...input };
  },
});
