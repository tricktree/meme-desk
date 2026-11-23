/**
 * Server-side PAPER snapshot. The visitor's browser never calls this URL.
 * The address is fixed (our scan branch). Request headers from the visitor
 * are not forwarded. The body is rejected unless it is a paper book.
 */

export const SNAPSHOT_URL =
  "https://raw.githubusercontent.com/tricktree/meme-desk/cursor/paper-live-book-b14c/dashboard/public/desk.json";

const TTL_MS = 15_000;
const MAX_BYTES = 500_000;
const FORBIDDEN =
  /script_synthetic|eval_bankroll_math|private[_ ]?key|secret[_ ]?key|seed phrase|HELIUS_API_KEY|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/i;

let cached = null;
let cachedAt = 0;

export function isSampleDesk(desk) {
  if (!desk || typeof desk !== "object") return false;
  return (
    Boolean(desk.sampleDisclaimer) ||
    (typeof desk.note === "string" && desk.note.toUpperCase().includes("SAMPLE"))
  );
}

export function isPublishableDesk(desk) {
  if (!desk || typeof desk !== "object") return false;
  if (desk.mode !== "paper" || desk.walletControls || desk.live === true) return false;
  if (isSampleDesk(desk)) return false;
  if (!desk.fund || typeof desk.fund.cashUsd !== "number") return false;
  if (typeof desk.fund.equityUsd !== "number") return false;
  if (!Array.isArray(desk.recent) || !Array.isArray(desk.openPositions ?? [])) {
    return false;
  }
  const raw = JSON.stringify(desk);
  if (raw.length > MAX_BYTES || FORBIDDEN.test(raw)) return false;
  for (const line of desk.recent) {
    if (!line || typeof line !== "object") return false;
    if (line.kind === "paper_close" && line.markSource !== "fetch_token_facts") {
      return false;
    }
  }
  return true;
}

function snapshotRequestUrl(now = Date.now()) {
  const bucket = Math.floor(now / 60_000);
  return `${SNAPSHOT_URL}?scan=${bucket}`;
}

/** Latest scan book, or null. Cached briefly so page polls do not stampede. */
export async function fetchUpstreamDesk() {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;
  try {
    const res = await fetch(snapshotRequestUrl(now), {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "application/json, text/plain;q=0.9" },
    });
    if (!res.ok) return cached;
    const desk = await res.json();
    if (!isPublishableDesk(desk)) return cached;
    cached = desk;
    cachedAt = now;
    return desk;
  } catch {
    return cached;
  }
}
