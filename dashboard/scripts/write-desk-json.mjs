/** Write public/desk.json sample snapshot for static hosting. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resetSampleState, writeStaticDeskJson } from "../lib/state.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "../public");

resetSampleState();
const out = writeStaticDeskJson(PUBLIC);
console.log(JSON.stringify({ ok: true, wrote: out }));
