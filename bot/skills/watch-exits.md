---
description: Check open paper positions for exit tripwires — dev peel, holders peel, liquidity drop, trail/stop — then paper_close.
---

# Watch / exits

For each open position from `desk_report`:

1. Call **fresh** `fetch_token_facts` for that mint. Use its price as `markUsd` and mcap as `exitMcapUsd`. Record the fetch time as `markFetchedAt`.
2. Compare that mark, liq, and holder/dev snaps to entry snap.
3. Close (paper) if any fire:
   - Dev wallet down ≥20% from entry snap (if armed: snapdev ≥0.5%).
   - Entry top-10 combined down ≥25%, or ≥3 of those wallets emptied.
   - Pool liquidity down ≥30% from snap.
   - Trail / stop / take rules from the position's `exitRule` **using the fresh mark only**.
4. Call `paper_close` with `markSource=fetch_token_facts`, `markFetchedAt`, `markUsd`, `exitMcapUsd`, and the reason. Never invent a TP. Never claim an on-chain signature.

If data is missing for a tripwire, say which sensor is blind — do not invent wallet balances or fake marks.
