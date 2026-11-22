const POLL_MS = 4000;

const $ = (sel) => document.querySelector(sel);

function money(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}$${abs}`;
}

function pct(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function relTime(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return new Date(t).toLocaleString();
}

function setSigned(el, value, formatter) {
  el.textContent = formatter(value);
  el.classList.remove("pos", "neg");
  if (typeof value === "number") {
    if (value > 0) el.classList.add("pos");
    if (value < 0) el.classList.add("neg");
  }
}

function renderPositions(positions) {
  const root = $("#positions");
  if (!positions?.length) {
    root.innerHTML = `<li class="empty">No open paper tickets</li>`;
    return;
  }
  root.innerHTML = positions
    .map(
      (p) => `
      <li>
        <div class="pos-top">
          <span class="sym">${escapeHtml(p.symbol || "—")}</span>
          <span>${money(p.sizeUsd)}</span>
        </div>
        <div class="muted">${escapeHtml(p.exitRule || "")} · entry ${money(p.entryUsd)}</div>
        <div class="mint" title="${escapeHtml(p.mint || "")}">${escapeHtml(p.mint || "")}</div>
      </li>`,
    )
    .join("");
}

function renderTape(rows) {
  const root = $("#tape");
  if (!rows?.length) {
    root.innerHTML = `<li class="empty">No log lines yet</li>`;
    return;
  }
  root.innerHTML = rows
    .slice(0, 28)
    .map((l) => {
      const kind = escapeHtml(l.kind || "note");
      const pnl =
        typeof l.pnlUsd === "number"
          ? ` · pnl ${money(l.pnlUsd)}`
          : typeof l.sizeUsd === "number"
            ? ` · size ${money(l.sizeUsd)}`
            : "";
      return `
        <li>
          <div class="tape-top">
            <span><span class="kind ${kind}">${kind}</span><span class="sym">${escapeHtml(l.symbol || "")}</span></span>
            <span class="muted">${relTime(l.time)}</span>
          </div>
          <div class="tape-detail">${escapeHtml(l.detail || "")}${pnl}</div>
        </li>`;
    })
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function applyDesk(desk) {
  const fund = desk.fund || {};
  setSigned($('[data-metric="equityUsd"]'), fund.equityUsd, money);
  setSigned($('[data-metric="cashUsd"]'), fund.cashUsd, money);
  setSigned($('[data-metric="openExposureUsd"]'), fund.openExposureUsd, money);
  setSigned($('[data-metric="realizedPnlUsd"]'), fund.realizedPnlUsd, money);
  setSigned($('[data-metric="unrealizedPnlUsd"]'), fund.unrealizedPnlUsd, money);
  setSigned($('[data-metric="returnPctVsFund"]'), fund.returnPctVsFund, pct);
  const wr = fund.winRate;
  const wrEl = $('[data-metric="winRate"]');
  wrEl.textContent = wr == null ? "n/a" : `${wr.toFixed(0)}%`;
  wrEl.classList.remove("pos", "neg");
  if (typeof wr === "number" && wr >= 50) wrEl.classList.add("pos");
  if (typeof wr === "number" && wr < 50) wrEl.classList.add("neg");

  const ret = fund.returnPctVsFund;
  $("#returnPct").textContent =
    typeof ret === "number"
      ? `${pct(ret)} vs $${fund.startingFundUsd ?? 100} fund`
      : "vs $100 fund";

  $("#lastScan").textContent = relTime(desk.lastScanAt);
  $("#updatedAt").textContent = relTime(desk.updatedAt);
  $("#openCount").textContent = String(desk.openPositions?.length ?? 0);
  $("#logCount").textContent = String(desk.logCounts?.total ?? desk.recent?.length ?? 0);
  $("#entriesToday").textContent = `Entries today: ${desk.entriesToday ?? 0} · ticket $${desk.ticketUsd ?? 25}`;
  const c = desk.logCounts || {};
  $("#logBreakdown").textContent = `kills ${c.kills ?? 0} · verdicts ${c.verdicts ?? 0} · opens ${c.opens ?? 0} · closes ${c.closes ?? 0}`;

  renderPositions(desk.openPositions || []);
  renderTape(desk.recent || []);
}

function setLive(state, detail) {
  const pill = $("#livePill");
  const label = $("#liveLabel");
  pill.classList.remove("stale", "err");
  if (state === "ok") {
    label.textContent = detail || "live";
  } else if (state === "stale") {
    pill.classList.add("stale");
    label.textContent = detail || "stale";
  } else {
    pill.classList.add("err");
    label.textContent = detail || "error";
  }
}

async function refresh() {
  try {
    const res = await fetch("/api/desk", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const desk = await res.json();
    applyDesk(desk);
    setLive("ok", "live");
  } catch (err) {
    setLive("err", "offline");
    console.error(err);
  }
}

refresh();
setInterval(refresh, POLL_MS);
setInterval(() => {
  // Refresh relative timestamps without waiting for poll.
  const last = $("#lastScan").textContent;
  if (last && last !== "—") {
    // soft re-poll already keeps these fresh; no-op placeholder for motion continuity
  }
}, 15_000);
