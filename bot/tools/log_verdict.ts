import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { appendLog } from "../lib/book.js";

export default defineTool({
  description: prompt`
    Append one desk log line for a kill, pass, or watch. Use after any gate fails
    or judge passes so funnel metrics stay honest.
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
    mint: z.string().optional(),
    symbol: z.string().optional(),
    detail: z.string().min(1),
  }),
  async execute(input, ctx) {
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
