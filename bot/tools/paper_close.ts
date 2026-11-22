import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import {
  appendLog,
  bankrollSnapshot,
  isSolanaMint,
  loadBook,
  money,
  saveBook,
} from "../lib/book.js";

/** Reject marks claimed from a fetch older than this (stale TP invention). */
const MAX_MARK_AGE_MS = 15 * 60 * 1000;

export default defineTool({
  description: prompt`
    Close a PAPER position against the $100 virtual fund. Credits cash with size + trade PnL,
    updates realized PnL / win rate, and returns the bankroll snapshot.
    markUsd and exitMcapUsd MUST come from a fresh fetch_token_facts for this mint — never invent a
    take-profit or trail hit that the chart did not print. Do not claim an on-chain sell.
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
    /** Solana contract address (base58 mint) of the open paper position. */
    mint: z.string().min(32).max(44),
    /** Token USD price from the same fetch_token_facts call as markFetchedAt. */
    markUsd: z.number().positive(),
    /** Market cap USD from that same fetch (required for honest closes). */
    exitMcapUsd: z.number().positive(),
    /** ISO time of the fetch_token_facts that produced markUsd / exitMcapUsd. */
    markFetchedAt: z.string().min(10),
    /** Provenance — only live feed marks are accepted. */
    markSource: z.literal("fetch_token_facts"),
    reason: z.string().min(1),
  }),
  async execute(input, ctx) {
    if (!isSolanaMint(input.mint)) {
      return {
        closed: false,
        error: "invalid_mint_ca",
        paper: true,
        hint: "mint must be the Solana base58 contract address, not a symbol or placeholder",
      };
    }
    const fetchedMs = Date.parse(input.markFetchedAt);
    if (Number.isNaN(fetchedMs)) {
      return {
        closed: false,
        error: "invalid_mark_fetched_at",
        paper: true,
        hint: "markFetchedAt must be an ISO timestamp from fetch_token_facts",
      };
    }
    const ageMs = Date.now() - fetchedMs;
    if (ageMs < -60_000 || ageMs > MAX_MARK_AGE_MS) {
      return {
        closed: false,
        error: "stale_or_future_mark",
        paper: true,
        hint: `Re-fetch token facts; mark must be ≤${MAX_MARK_AGE_MS / 60_000}m old`,
        markAgeMs: ageMs,
      };
    }

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
    const movePct = money(
      ((input.markUsd - pos.entryUsd) / pos.entryUsd) * 100,
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
    const closedAt = new Date().toISOString();
    await appendLog(ctx.host.kv, {
      time: closedAt,
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
      markSource: input.markSource,
      markFetchedAt: input.markFetchedAt,
      movePct,
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
      exitMcapUsd: input.exitMcapUsd,
      movePct,
      tradePnlUsd,
      reason: input.reason,
      markSource: input.markSource,
      markFetchedAt: input.markFetchedAt,
      closedAt,
      fund: snap,
    };
  },
});
