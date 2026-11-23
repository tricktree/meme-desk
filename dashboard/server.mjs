/**
 * PAPER desk dashboard — static UI + JSON API. No wallet / LIVE controls.
 *
 *   node dashboard/server.mjs
 *   PAPER_DESK_PORT=4177 node dashboard/server.mjs
 *
 * Writes are local-only (loopback + same-origin). The hosted static app
 * requests /api/desk, then the public scan file, then public/desk.json
 * when /api/desk is HTML. This process is the local /api/desk.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDashboardPayload,
  loadState,
  resetSampleState,
  saveState,
  writeStaticDeskJson,
} from "./lib/state.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");
const PORT = Number(process.env.PAPER_DESK_PORT || process.env.PORT || 4177);
const HOST = process.env.PAPER_DESK_HOST || "127.0.0.1";
const WRITES_ENABLED = process.env.PAPER_DESK_WRITES !== "0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendJson(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(raw);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => {
      chunks.push(c);
      if (chunks.reduce((n, x) => n + x.length, 0) > 1_000_000) {
        reject(new Error("body_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function safePublicPath(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const rel = clean === "/" ? "/index.html" : clean;
  const resolved = path.normalize(path.join(PUBLIC, rel));
  if (!resolved.startsWith(PUBLIC)) return null;
  return resolved;
}

function isLoopback(req) {
  const ra = req.socket?.remoteAddress || "";
  return (
    ra === "127.0.0.1" ||
    ra === "::1" ||
    ra === "::ffff:127.0.0.1"
  );
}

/** Same-origin / local write gate (CSRF + no anonymous remote writes). */
function allowWrite(req) {
  if (!WRITES_ENABLED) return false;
  if (!isLoopback(req)) return false;
  const host = req.headers.host || "";
  const origin = req.headers.origin;
  if (origin) {
    try {
      const o = new URL(origin);
      if (o.host !== host) return false;
    } catch {
      return false;
    }
  }
  const referer = req.headers.referer;
  if (!origin && referer) {
    try {
      const r = new URL(referer);
      if (r.host !== host) return false;
    } catch {
      return false;
    }
  }
  // curl/local tools: loopback with neither Origin nor Referer is OK.
  return true;
}

function refreshStaticSnapshot() {
  try {
    writeStaticDeskJson(PUBLIC);
  } catch (err) {
    console.error("writeStaticDeskJson failed", err);
  }
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return true;
  }

  if (url.pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      mode: "paper",
      time: new Date().toISOString(),
    });
    return true;
  }

  if (url.pathname === "/api/desk" && req.method === "GET") {
    sendJson(res, 200, buildDashboardPayload(loadState()));
    return true;
  }

  if (
    url.pathname === "/api/seed" ||
    url.pathname === "/api/state" ||
    url.pathname === "/api/scan-ping"
  ) {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "method_not_allowed" });
      return true;
    }
    if (!allowWrite(req)) {
      sendJson(res, 403, { ok: false, error: "writes_forbidden" });
      return true;
    }
  }

  if (url.pathname === "/api/seed" && req.method === "POST") {
    const state = resetSampleState();
    refreshStaticSnapshot();
    sendJson(res, 200, {
      ok: true,
      reseeding: "sample",
      desk: buildDashboardPayload(state),
    });
    return true;
  }

  if (url.pathname === "/api/state" && req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      sendJson(res, 400, { ok: false, error: String(e.message || e) });
      return true;
    }
    if (!body || typeof body !== "object" || !body.book) {
      sendJson(res, 400, {
        ok: false,
        error: "expected { book, log?, lastScanAt?, marks? }",
      });
      return true;
    }
    const prev = loadState();
    const next = saveState({
      mode: "paper",
      startingFundUsd: 100,
      ticketUsd: 25,
      book: body.book,
      log: Array.isArray(body.log) ? body.log : prev.log,
      lastScanAt: body.lastScanAt ?? prev.lastScanAt ?? null,
      marks: body.marks && typeof body.marks === "object" ? body.marks : {},
      note: body.note ?? "Updated via POST /api/state",
    });
    refreshStaticSnapshot();
    sendJson(res, 200, { ok: true, desk: buildDashboardPayload(next) });
    return true;
  }

  if (url.pathname === "/api/scan-ping" && req.method === "POST") {
    const state = loadState();
    const now = new Date().toISOString();
    state.lastScanAt = now;
    state.log = Array.isArray(state.log) ? state.log : [];
    state.log.push({
      time: now,
      kind: "scan",
      detail: "dashboard scan-ping — book unchanged",
    });
    state.log = state.log.slice(-500);
    saveState(state);
    refreshStaticSnapshot();
    sendJson(res, 200, { ok: true, desk: buildDashboardPayload(state) });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (handled) return;
      sendJson(res, 404, { ok: false, error: "not_found" });
      return;
    }

    const filePath = safePublicPath(url.pathname);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300",
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err?.message || err) });
  }
});

server.listen(PORT, HOST, () => {
  loadState();
  refreshStaticSnapshot();
  console.log(
    JSON.stringify({
      ok: true,
      mode: "paper",
      url: `http://${HOST}:${PORT}`,
      api: `http://${HOST}:${PORT}/api/desk`,
      staticDesk: "/desk.json",
    }),
  );
});
