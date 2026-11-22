import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { DESK } from "../lib/config.js";
import { bankrollSnapshot, loadBook, readLog } from "../lib/book.js";

export default defineTool({
  description: prompt`
    Build the desk report from the paper book and kill/pass log only.
    Always includes the $100 fund bankroll: cash, open exposure, realized/unrealized PnL,
    equity, return vs fund, and win rate. Pass optional marks (mint→USD price) for unrealized.
    Never invent counts.
  `,
  effect: "read",
  inputSchema: z.object({
    kind: z.enum(["status", "morning", "evening", "sunday"]).default("status"),
    marks: z
      .array(
        z.object({
          mint: z.string(),
          markUsd: z.number().positive(),
        }),
      )
      .optional(),
  }),
  async execute({ kind, marks }, ctx) {
    const book = await loadBook(ctx.host.kv);
    const log = await readLog(ctx.host.kv);
    const markMap: Record<string, number> = {};
    for (const m of marks ?? []) markMap[m.mint] = m.markUsd;
    const fund = bankrollSnapshot(book, markMap);
    const kills = log.filter(
      (l) => l.kind === "kill" || l.detail.startsWith("kill:"),
    );
    const opens = log.filter((l) => l.kind === "paper_open");
    const closes = log.filter((l) => l.kind === "paper_close");
    const reasonCounts: Record<string, number> = {};
    for (const k of kills) {
      const key = k.detail.slice(0, 80);
      reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
    }
    const recentTrades = closes.slice(-10).map((c) => ({
      time: c.time,
      mint: c.mint,
      symbol: c.symbol,
      sizeUsd: c.sizeUsd,
      tradePnlUsd: c.pnlUsd,
      entryUsd: c.entryUsd,
      exitUsd: c.exitUsd,
      entryMcapUsd: c.entryMcapUsd,
      exitMcapUsd: c.exitMcapUsd,
      cashAfter: c.cashUsd,
      equityAfter: c.equityUsd,
      detail: c.detail,
    }));
    return {
      kind,
      mode: DESK.mode,
      ticketUsd: DESK.ticketUsd,
      fund,
      openPositions: Object.values(book.positions),
      entriesToday: book.entriesToday,
      recentTrades,
      logCounts: {
        total: log.length,
        kills: kills.length,
        opens: opens.length,
        closes: closes.length,
      },
      topKillReasons: Object.entries(reasonCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([reason, count]) => ({ reason, count })),
      note: "Signal performance is measured vs the fixed $100 paper fund. REJECTED THEN RAN needs human chart follow-up; do not invent it.",
    };
  },
});
