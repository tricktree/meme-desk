---
description: Run the paper entry funnel for one Solana mint — hard kills, meme gates, dossier, judge, paper open or log kill.
---

# Entry funnel

For mint `[MINT]`:

1. Call `fetch_token_facts` (or gather facts manually). If a field is unknown, pass `null` and/or list it in `unknownFields`.
2. Call `hard_kill_check` with those fields. If kill → `log_verdict` kind=kill with reasons → stop.
3. Call `meme_gates`. If kill → `log_verdict` → stop.
4. Write a short facts-only dossier in the reply (lead_id, age, mcap, liq, holdersΔ, buys/sells, top10, dev, social mentions, unknowns).
5. From the dossier only, choose organic / late / exit_risk / action + probabilities.
6. Call `judge_gate` **once**. Do not re-ask.
7. If verdict=buy → `paper_open` (attach exit; set require2xTp if meme_gates signalNote says so).
8. Else → `log_verdict` kind=pass or watch.

Never call `paper_open` without judge_gate buy.
