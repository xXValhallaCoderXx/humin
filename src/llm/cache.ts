// Per-item checkpoint cache. Without a Batch API we make many direct calls; this
// gives those calls fire-and-forget resilience: each result is written the moment
// it succeeds, so a crash or a rate-limit wall mid-run loses nothing, and re-runs
// (or resumes) skip everything already done. Key includes model + prompt version,
// so changing either correctly invalidates and recomputes.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const safe = (s: string) => s.replace(/[^a-z0-9._-]+/gi, "_");

export function cachePath(dir: string, model: string, version: string, key: string): string {
  // Hash the key so long ids/keys stay filesystem-safe and bounded.
  const k = /^[a-z0-9._-]{1,64}$/i.test(key) ? key : createHash("sha256").update(key).digest("hex").slice(0, 32);
  return join(dir, safe(model), safe(version), `${k}.json`);
}

export function readCache<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined; // corrupt/partial cache entry → treat as miss
  }
}

/** Atomic write (temp + rename) so a crash mid-write can't leave a partial entry. */
export function writeCache(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);
}
