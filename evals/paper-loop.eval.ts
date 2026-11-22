import { defineEval } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["paper-loop"],
  description: "Synthetic PAPER funnel: gates pass → paper_open $25 → paper_close → desk_report shows $100 fund.",
  async test(t) {
    await t.send(
      [
        "PAPER only. Fixed $100 fund. Run the full entry funnel for mint 7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr symbol POPCAT.",
        "Do NOT call fetch_token_facts. Use these measured facts for hard_kill_check:",
        "mintAuthorityEnabled=false, freezeAuthorityEnabled=false, lpLockedOrBurned=true,",
        "top10PctExPool=15, devPct=1, insiders=0, liquidityUsd=90000, ageMin=120, riskScore=8,",
        "vol1hUsd=55000, buys1h=200, sells1h=150, mcapUsd=400000.",
        "Then meme_gates with: officialCaMatches=true, hasOfficialCaSource=true, volume24Usd=80000,",
        "mcapUsd=400000, quoteIsSolOrStable=true, mcapOverAth=0.5, athAgeHours=0.8, eventThemed=false.",
        "Then judge_gate: action=buy, actionP=0.78, organic=yes, organicP=0.72, late=no, exitRisk=2.",
        "If buy, paper_open with entryUsd=0.01, entryMcapUsd=400000, judgeVerdict=buy, symbol=POPCAT.",
        "Then paper_close with markSource=fetch_token_facts, markFetchedAt=now ISO, markUsd=0.014,",
        "exitMcapUsd=560000, reason=eval_bankroll_math_only (this eval is synthetic fund arithmetic, not an Axiom claim).",
        "Then desk_report kind=status. Summarize fund cash/equity vs the $100 start. No live trading.",
      ].join(" "),
    );
    t.succeeded();
    t.calledTool("hard_kill_check");
    t.calledTool("meme_gates");
    t.calledTool("judge_gate");
    t.calledTool("paper_open");
    t.calledTool("paper_close");
    t.calledTool("desk_report");
  },
});
