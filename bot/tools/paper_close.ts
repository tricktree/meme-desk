import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import {
  appendLog,
  bankrollSnapshot,
  loadBook,
  money,
  saveBook,
} from "../lib/book.js";

export default defineTool({
  description: prompt`
    Close a PAPER position against the $100 virtual fund. Credits cash with size + trade PnL,
    updates realized PnL / win rate, and returns the bankroll snapshot.
    Do not claim a real on-chain sell — this desk has no signing tools.
  `,
  effect: "write",
  dryRunResult: ({ mint, reason }) => ({
    closed: false,
    paper: true,
    mint,
    reason,
    stub: "dry_run",
  }),
  inputSchema: z.object({
    mint: z.string().min(1),
    markUsd: z.number().positive(),
    /** Market cap USD at exit / mark, when known. */
    exitMcapUsd: z.number().positive().optional(),
    reason: z.string().min(1),
  }),
  async execute(input, ctx) {
    const book = await loadBook(ctx.host.kv);
    const pos = book.positions[input.mint];
    if (!pos) {
      return {
        closed: false,
        reason: "not_open",
        paper: true,
        fund: bankrollSnapshot(book),
      };
    }

    const tradePnlUsd = money(
      ((input.markUsd - pos.entryUsd) / pos.entryUsd) * pos.sizeUsd,
    );
    const proceeds = money(pos.sizeUsd + tradePnlUsd);
    book.cashUsd = money(book.cashUsd + proceeds);
    book.realizedPnlUsd = money(book.realizedPnlUsd + tradePnlUsd);
    book.dayPnlUsd = money(book.dayPnlUsd + tradePnlUsd);
    if (tradePnlUsd > 0) book.closedWins += 1;
    else if (tradePnlUsd < 0) book.closedLosses += 1;
    else book.closedFlats += 1;
    const entryUsd = pos.entryUsd;
    const entryMcapUsd = pos.entryMcapUsd;
    delete book.positions[input.mint];
    await saveBook(ctx.host.kv, book);
    const snap = bankrollSnapshot(book);
    await appendLog(ctx.host.kv, {
      time: new Date().toISOString(),
      kind: "paper_close",
      mint: input.mint,
      symbol: pos.symbol,
      detail: input.reason,
      sizeUsd: pos.sizeUsd,
      pnlUsd: tradePnlUsd,
      cashUsd: snap.cashUsd,
      equityUsd: snap.equityUsd,
      openExposureUsd: snap.openExposureUsd,
      entryUsd,
      exitUsd: input.markUsd,
      entryMcapUsd,
      exitMcapUsd: input.exitMcapUsd,
    });
    return {
      closed: true,
      paper: true,
      mint: input.mint,
      symbol: pos.symbol,
      sizeUsd: pos.sizeUsd,
      entryUsd,
      exitUsd: input.markUsd,
      entryMcapUsd: entryMcapUsd ?? null,
      exitMcapUsd: input.exitMcapUsd ?? null,
      tradePnlUsd,
      reason: input.reason,
      fund: snap,
    };
  },
});
