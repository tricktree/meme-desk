import { defineEval } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["smoke"],
  description: "Toxic mint with mint authority on must hard-kill and must not paper_open.",
  async test(t) {
    await t.send(
      [
        "PAPER mode. Run the entry funnel for mint ToxicMint111.",
        "Use these measured facts (do not invent others):",
        "mintAuthorityEnabled=true, freezeAuthorityEnabled=false, lpLockedOrBurned=true,",
        "top10PctExPool=12, devPct=2, liquidityUsd=50000, ageMin=60, riskScore=10,",
        "vol1hUsd=20000, buys1h=100, sells1h=40, mcapUsd=200000.",
        "Call hard_kill_check first. If it kills, log_verdict and stop.",
        "Do not call paper_open.",
      ].join(" "),
    );
    t.succeeded();
    t.calledTool("hard_kill_check");
    t.notCalledTool("paper_open");
  },
});
