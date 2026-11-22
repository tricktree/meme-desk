# meme-desk

Agent SDK paper-trading desk for Solana memecoins. Design rationale lives in the project store docs (`bot-design-from-x-articles.md`).

## What it does

- Fixed **$100 paper fund** for signal performance (cash / equity / PnL / win rate)
- `fetch_token_facts` — DexScreener + Rugcheck; optional read-only RPC env
- Hard-kill + meme-gate + closed judge funnel → paper open/close
- Never holds keys or signs transactions

## Local loop

```bash
cd /agent/meme-desk
npx --yes "@grok/agent-sdk@0.7.2" validate --dir .
npx tsc --noEmit -p .
npx --yes tsx scripts/smoke-paper-path.ts
npx --yes "@grok/agent-sdk@0.7.2" tool call fetch_token_facts --dir . --input '{"mint":"<SOLANA_MINT>"}'
# Model smoke needs a Cursor credential (do not paste keys into chat):
# see /cursor/stores/self/docs/cursor-credential-setup.md
npx --yes "@grok/agent-sdk@0.7.2" whoami --json
npx --yes "@grok/agent-sdk@0.7.2" eval --dir . --tag smoke --json
npx --yes "@grok/agent-sdk@0.7.2" run --dir . --json --message "PAPER only. Call desk_report kind=status. Confirm the \$100 paper fund fields. Do not open trades."
```

Optional read-only RPC: set `HELIUS_API_KEY` or `QUICKNODE_RPC_URL` (see `/cursor/stores/self/docs/rpc-setup.md`). Never wallet keys. No git remote invented.
