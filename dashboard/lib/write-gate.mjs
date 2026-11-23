/**
 * PAPER desk writes. Off unless PAPER_DESK_WRITES=1.
 * A loopback socket is not a hosted trust signal: reverse proxies often
 * connect from 127.0.0.1. Forwarded headers or a public Host refuse the write.
 */

const PROXY_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-real-ip",
  "via",
  "cf-connecting-ip",
  "true-client-ip",
];

function headerPresent(headers, name) {
  const value = headers?.[name];
  if (value == null) return false;
  const text = Array.isArray(value) ? value.join(",") : String(value);
  return text.trim() !== "";
}

export function hasProxyHeaders(headers) {
  return PROXY_HEADERS.some((name) => headerPresent(headers, name));
}

export function isLoopbackAddress(address) {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

export function isLoopbackHost(hostHeader) {
  if (!hostHeader) return false;
  const host = String(hostHeader).trim().toLowerCase();
  let hostname = host;
  if (hostname.startsWith("[")) {
    const end = hostname.indexOf("]");
    hostname = end === -1 ? "" : hostname.slice(1, end);
  } else {
    hostname = hostname.replace(/:\d+$/, "");
  }
  return (
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
  );
}

export function allowDeskWrite(req, env = process.env) {
  if (env.PAPER_DESK_WRITES !== "1") return false;
  const headers = req?.headers || {};
  if (hasProxyHeaders(headers)) return false;
  const remote = req?.socket?.remoteAddress || "";
  if (!isLoopbackAddress(remote)) return false;
  if (!isLoopbackHost(headers.host)) return false;
  const host = headers.host;
  if (headers.origin) {
    try {
      if (new URL(headers.origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  if (!headers.origin && headers.referer) {
    try {
      if (new URL(headers.referer).host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}
