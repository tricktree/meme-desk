import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchUpstreamDesk, isPublishableDesk } from "../../../lib/snapshot.mjs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function shippedDesk() {
  try {
    const desk = JSON.parse(
      await readFile(join(process.cwd(), "public", "desk.json"), "utf8"),
    );
    return isPublishableDesk(desk) ? desk : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const upstream = await fetchUpstreamDesk();
  const desk = upstream ?? (await shippedDesk());
  if (!desk) {
    return Response.json(
      { ok: false, error: "no_paper_snapshot" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
  return Response.json(desk, {
    headers: { "cache-control": "no-store" },
  });
}
