---
description: Check open paper positions for exit tripwires — dev peel, holders peel, liquidity drop, trail/stop — then paper_close.
---

# Watch / exits

For each open position from `desk_report`:

1. Compare current mark, liq, and holder/dev snaps to entry snap.
2. Close (paper) if any fire:
   - Dev wallet down ≥20% from entry snap (if armed: snapdev ≥0.5%).
   - Entry top-10 combined down ≥25%, or ≥3 of those wallets emptied.
   - Pool liquidity down ≥30% from snap.
   - Trail / stop / take rules from the position's `exitRule`.
3. Call `paper_close` with the winning reason. Never claim an on-chain signature.

If data is missing for a tripwire, say which sensor is blind — do not invent wallet balances.
