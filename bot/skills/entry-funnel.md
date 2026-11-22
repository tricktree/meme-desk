---
description: Run the paper entry funnel for one Solana mint — hard kills, meme gates, dossier, judge, paper open or log kill.
---

# Entry funnel

For mint `[MINT]`:

1. Call `fetch_token_facts` (or gather facts manually). If a field is unknown, pass `null` and/or list it in `unknownFields`.
2. Prefer leads with **mcap in the early band** (config ~$20k–$1M). If mcap is above max, expect `mcap_band` kill — do not shop for saturated large-caps.
3. Call `hard_kill_check` with those fields. If kill → `log_verdict` kind=kill with reasons → stop.
4. Call `meme_gates`. If kill → `log_verdict` → stop.
5. Write a short facts-only dossier in the reply (lead_id, age, mcap, liq, holdersΔ, buys/sells, top10, dev, social mentions, unknowns).
6. From the dossier only, choose organic / late / exit_risk / action + probabilities.
7. Call `judge_gate` **once**. Do not re-ask.
8. If verdict=buy → `paper_open` with **entryUsd + entryMcapUsd from facts** (attach exit; set require2xTp if meme_gates signalNote says so).
9. Else → `log_verdict` kind=pass or watch.

Never call `paper_open` without judge_gate buy. Never invent entry mcap.
