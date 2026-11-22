import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { judgeGate } from "../lib/gates.js";

export default defineTool({
  description: prompt`
    Apply the fixed closed-form judge gate to typed answers.
    You (the model) supply organic/late/exit_risk/action from the facts-only dossier;
    this tool decides buy/watch/pass. Confidence never changes size.
    Never re-ask hoping for a different answer — one ask, one logged verdict.
  `,
  effect: "read",
  inputSchema: z.object({
    mint: z.string().min(1),
    action: z.enum(["buy", "watch", "pass"]),
    actionP: z.number().min(0).max(1),
    organic: z.enum(["yes", "no"]),
    organicP: z.number().min(0).max(1),
    late: z.enum(["yes", "no"]),
    exitRisk: z.number().int().min(1).max(5),
    watchCount: z.number().int().min(0).optional(),
    dossierSummary: z.string().max(2000).optional(),
  }),
  async execute(input) {
    const result = judgeGate(input);
    return {
      mint: input.mint,
      ...result,
      sizeNote: "flat_ticket_only_confidence_does_not_scale",
      next:
        result.verdict === "buy"
          ? "paper_open"
          : result.verdict === "recheck_in_30m"
            ? "wait_then_rejudge_once"
            : "log_pass_and_stop",
    };
  },
});
