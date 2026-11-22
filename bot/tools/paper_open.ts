import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { DESK } from "../lib/config.js";
import {
  appendLog,
  bankrollSnapshot,
  defaultExitRule,
  guardOpen,
  isSolanaMint,
  loadBook,
  money,
  saveBook,
} from "../lib/book.js";

export default defineTool({
  description: prompt`
    Open a PAPER position against the fixed $100 virtual fund. Never signs, never holds keys.
    Debits cash by the flat ticket, attaches the exit rule, and returns bankroll (cash, equity, exposure).
    Requires prior gate verdict buy.
  `,
  effect: "write",
  dryRunResult: ({ mint, symbol }) => ({
    opened: false,
    paper: true,
    mint,
    symbol,
    reason: "dry_run",
    fund: { startingFundUsd: DESK.startingFundUsd },
  }),
  inputSchema: z.object({
    /** Solana contract address (base58 mint). Never a label like WAVE or PassMint. */
    mint: z.string().min(32).max(44),
    symbol: z.string().min(1),
    entryUsd: z.number().positive(),
    /** Market cap USD at entry (from DexScreener / facts), when known. */
    entryMcapUsd: z.number().positive().optional(),
    judgeVerdict: z.literal("buy"),
    snapDevPct: z.number().optional(),
    snapTop10CombinedPct: z.number().optional(),
    snapLiqUsd: z.number().optional(),
    require2xTp: z.boolean().optional(),
  }),
  async execute(input, ctx) {
    if (DESK.mode !== "paper") {
      return { opened: false, error: "live_mode_disabled_in_v1" };
    }
    if (!isSolanaMint(input.mint)) {
      return {
        opened: false,
        error: "invalid_mint_ca",
        paper: true,
        hint: "mint must be the Solana base58 contract address from fetch_token_facts, not a symbol or placeholder",
      };
    }
    const book = await loadBook(ctx.host.kv);
    const sizeUsd = DESK.ticketUsd;
    const blocked = guardOpen(book, input.mint, sizeUsd);
    if (blocked) {
      const snap = bankrollSnapshot(book);
      await appendLog(ctx.host.kv, {
        time: new Date().toISOString(),
        kind: "open_blocked",
        mint: input.mint,
        symbol: input.symbol,
        detail: blocked,
        sizeUsd,
        cashUsd: snap.cashUsd,
        equityUsd: snap.equityUsd,
        openExposureUsd: snap.openExposureUsd,
      });
      return { opened: false, reason: blocked, paper: true, fund: snap };
    }

    const exitRule = input.require2xTp
      ? "full_2x_tp_required"
      : defaultExitRule();
    book.cashUsd = money(book.cashUsd - sizeUsd);
    book.positions[input.mint] = {
      mint: input.mint,
      symbol: input.symbol,
      openedAt: new Date().toISOString(),
      entryUsd: input.entryUsd,
      entryMcapUsd: input.entryMcapUsd,
      sizeUsd,
      exitRule,
      snap: {
        devPct: input.snapDevPct ?? 0,
        top10CombinedPct: input.snapTop10CombinedPct ?? 0,
        liqUsd: input.snapLiqUsd ?? 0,
      },
    };
    book.entriesToday += 1;
    await saveBook(ctx.host.kv, book);
    const snap = bankrollSnapshot(book, { [input.mint]: input.entryUsd });
    await appendLog(ctx.host.kv, {
      time: new Date().toISOString(),
      kind: "paper_open",
      mint: input.mint,
      symbol: input.symbol,
      detail: `size=${sizeUsd};exit=${exitRule}`,
      sizeUsd,
      cashUsd: snap.cashUsd,
      equityUsd: snap.equityUsd,
      openExposureUsd: snap.openExposureUsd,
      pnlUsd: 0,
      entryUsd: input.entryUsd,
      entryMcapUsd: input.entryMcapUsd,
    });
    return {
      opened: true,
      paper: true,
      mint: input.mint,
      symbol: input.symbol,
      sizeUsd,
      exitRule,
      entryUsd: input.entryUsd,
      entryMcapUsd: input.entryMcapUsd ?? null,
      tradePnlUsd: 0,
      fund: snap,
    };
  },
});
