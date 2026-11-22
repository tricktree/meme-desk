---
cron: "0 */4 * * *"
---

PAPER-only always-on signal sweep for the $100 fund desk.

1. Confirm mode is PAPER. Never ask for wallet keys. Never sign.
2. If the human left a mint/ticker to watch in memory or the message context, run the entry funnel: fetch_token_facts → hard_kill_check → meme_gates → judge_gate → paper_open only on buy (flat $25 ticket, exit attached) else log_verdict.
3. If no lead was queued, call desk_report kind=status and summarize fund fields (startingFundUsd, cashUsd, equityUsd, openExposureUsd, realizedPnlUsd, winRate). Say "no lead queued" instead of inventing a mint.
4. Keep answers short. Cite tool results. Stay on the $100 paper bankroll.
