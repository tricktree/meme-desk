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

## PAPER desk dashboard

Local live-ish UI for the $100 paper fund (cash / equity / exposure / PnL / win rate + tape). No wallet or LIVE controls.

```bash
npm run dashboard
# → http://127.0.0.1:4177
```

State file: `.data/paper-desk.json` (gitignored). The 5-minute loop writes that file and pushes the same PAPER snapshot to `cursor/paper-live-book-b14c` (`dashboard/public/desk.json`) so the hosted page can read it. Republish the dashboard after client changes; the scan file updates without another republish. See project store doc `docs/paper-desk-dashboard.md`.
