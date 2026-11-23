/**
 * Push the PAPER scan snapshot to the public branch the hosted page reads.
 * Git credentials stay in the environment. Nothing here is a wallet key.
 * PAPER_DESK_PUBLISH=0 skips the push (the local .data file is still written).
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPublishable,
  LIVE_BOOK_BRANCH,
  LIVE_BOOK_FILE,
  type PublicDesk,
} from "../bot/lib/public-desk.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type PublishResult = {
  published: boolean;
  branch: string;
  reason?: string;
};

export function redactSecrets(text: string): string {
  return text
    .replace(/x-access-token:[^\s@]+/gi, "x-access-token:redacted")
    .replace(/\b(ghs_|ghp_|github_pat_)[A-Za-z0-9_]+/g, "$1redacted")
    .replace(/HELIUS_API_KEY[=:]\s*\S+/gi, "HELIUS_API_KEY=redacted");
}

function git(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const msg = redactSecrets(`${e.stderr ?? ""}\n${e.stdout ?? ""}\n${e.message ?? ""}`);
    throw new Error(msg.replace(/\s+/g, " ").trim().slice(0, 400));
  }
}

function payloadText(desk: PublicDesk): string {
  assertPublishable(desk);
  return `${JSON.stringify(desk, null, 2)}\n`;
}

function writeAndCommit(dir: string, body: string): boolean {
  const file = path.join(dir, LIVE_BOOK_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  git(["add", "--", LIVE_BOOK_FILE], dir);
  const quiet = spawnSync("git", ["diff", "--cached", "--quiet", "--", LIVE_BOOK_FILE], {
    cwd: dir,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (quiet.status === 0) return false;
  git(["commit", "-m", "Update PAPER desk snapshot"], dir);
  return true;
}

function pushHead(dir: string): void {
  git(["push", "origin", `HEAD:${LIVE_BOOK_BRANCH}`], dir);
}

export function publishPublicDesk(desk: PublicDesk): PublishResult {
  const branch = LIVE_BOOK_BRANCH;
  if (process.env.PAPER_DESK_PUBLISH === "0") {
    return { published: false, branch, reason: "disabled" };
  }
  const body = payloadText(desk);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paper-live-"));
  let fetched = true;
  try {
    try {
      git(["fetch", "origin", branch], REPO_ROOT);
    } catch {
      fetched = false;
    }
    if (fetched) {
      git(["worktree", "add", "--detach", dir, `origin/${branch}`], REPO_ROOT);
    } else {
      try {
        git(["worktree", "add", "-b", branch, dir, "origin/main"], REPO_ROOT);
      } catch {
        git(["worktree", "add", "--detach", dir, branch], REPO_ROOT);
      }
    }
    const changed = writeAndCommit(dir, body);
    if (!changed) return { published: true, branch, reason: "unchanged" };
    try {
      pushHead(dir);
    } catch {
      git(["fetch", "origin", branch], REPO_ROOT);
      git(["reset", "--hard", `origin/${branch}`], dir);
      writeAndCommit(dir, body);
      pushHead(dir);
    }
    return { published: true, branch };
  } catch (err) {
    return {
      published: false,
      branch,
      reason: redactSecrets(err instanceof Error ? err.message : String(err)),
    };
  } finally {
    try {
      git(["worktree", "remove", "--force", dir], REPO_ROOT);
    } catch {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
