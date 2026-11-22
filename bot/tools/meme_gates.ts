import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { memeGates } from "../lib/gates.js";

export default defineTool({
  description: prompt`
    Run data-backed meme gates (clone, late, clock, copy-hold, event, weak meme/meme pair).
    A gate can only kill. Fail closed on missing fields.
    Call after hard_kill_check passes.
  `,
  effect: "read",
  inputSchema: z.object({
    mint: z.string().min(1),
    fromCopyList: z.boolean().optional(),
    copyMedianHoldMin: z.number().nullable().optional(),
    officialCaMatches: z.boolean().nullable().optional(),
    hasOfficialCaSource: z.boolean().nullable().optional(),
    volume24Usd: z.number().nullable().optional(),
    mcapUsd: z.number().nullable().optional(),
    quoteIsSolOrStable: z.boolean().nullable().optional(),
    baseMcapUsd: z.number().nullable().optional(),
    base24hGreen: z.boolean().nullable().optional(),
    mcapOverAth: z.number().nullable().optional(),
    athAgeHours: z.number().nullable().optional(),
    last5mClosedAboveAth: z.boolean().nullable().optional(),
    independentCopyWallets15m: z.number().nullable().optional(),
    eventThemed: z.boolean().nullable().optional(),
    daysUntilEvent: z.number().nullable().optional(),
    unknownFields: z.array(z.string()).optional(),
  }),
  async execute(input) {
    const result = memeGates(input);
    const signalNote =
      input.independentCopyWallets15m != null &&
      input.independentCopyWallets15m >= 3
        ? "signal_wallets_ok_require_2x_tp"
        : "no_signal_bonus";
    return {
      mint: input.mint,
      ...result,
      signalNote,
      next: result.verdict === "pass" ? "build_dossier_then_judge_gate" : "log_kill_and_stop",
    };
  },
});
