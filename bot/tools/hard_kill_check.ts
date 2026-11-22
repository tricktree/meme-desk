import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { hardKill } from "../lib/gates.js";

export default defineTool({
  description: prompt`
    Run deterministic Solana memecoin hard kills before any model judgment.
    Pass measured facts only. Missing or unknown fields fail closed (kill).
    Call this before meme_gates and judge_gate.
  `,
  effect: "read",
  inputSchema: z.object({
    mint: z.string().min(1),
    mintAuthorityEnabled: z.boolean().nullable(),
    freezeAuthorityEnabled: z.boolean().nullable(),
    lpLockedOrBurned: z.boolean().nullable(),
    top10PctExPool: z.number().nullable(),
    devPct: z.number().nullable(),
    insiders: z.number().nullable().optional(),
    liquidityUsd: z.number().nullable(),
    ageMin: z.number().nullable(),
    riskScore: z.number().nullable().optional(),
    vol1hUsd: z.number().nullable().optional(),
    buys1h: z.number().nullable().optional(),
    sells1h: z.number().nullable().optional(),
    mcapUsd: z.number().nullable().optional(),
    ticketUsd: z.number().nullable().optional(),
    unknownFields: z.array(z.string()).optional(),
  }),
  async execute(input) {
    const result = hardKill(input);
    return {
      mint: input.mint,
      ...result,
      next: result.verdict === "pass" ? "meme_gates" : "log_kill_and_stop",
    };
  },
});
