---
cron: "0 */4 * * *"
---

PAPER-only signal sweep for the $100 fund. The candidate set is the early-mcap pool list. The 5-minute timer runs the same path via `scripts/paper-signal-loop.ts`.

1. Confirm mode is PAPER. Never ask for wallet keys. Never sign. Never edit gate numbers in `bot/lib/config.ts`. Do not rewrite `dashboard/public/desk.json` or the hosted page.
2. Call `list_early_mcap`. It reads one public Solana pool list in front of `fetch_token_facts`: GeckoTerminal trending pools (first page), then new-pool pages walked until a pool is older than 30 minutes or the public page cap. Rows stay inside config `minMcapUsd`–`maxMcapUsd`. DexScreener profiles and boosts are a second mint list and have no mcap, so each of those mints goes through `fetch_token_facts`. Drop anything outside the band before hard kill. Keep the mint, not the ticker. If the human also left a mint in memory, run that mint through the entry funnel as well. The pool list stays the candidate set.
3. Call `fetch_token_facts` and `hard_kill_check` for BONK `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` as one control kill. BONK is a control, separate from that candidate set.
4. If `list_early_mcap` returns no candidates, say `no_early_mcap_candidate`. Otherwise, for each in-band mint, log symbol, mint, mcap, age, liquidity, and the hardKill reasons. A hardKill pass already continues through `meme_gates` and `judge_gate` in that result. Call `paper_open` only when `judge.verdict` is `buy`, with the flat $25 ticket, `entryUsd` and `entryMcapUsd` from the facts, and the exit attached. A fail at meme gates or the judge is a logged kill and takes no ticket. Do not invent `organic=yes` or `late=no` to force a ticket. Cash stays $100 until that open.
5. Call `desk_report` kind=status. Cite cash, equity, open exposure, realized PnL, and win rate from that tool.
