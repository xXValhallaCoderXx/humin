// Minimal zero-dependency argv parsing shared by the four scripts.
import { existsSync } from "node:fs";

/** Load .env into process.env if present (Node-native, no dependency). */
export function loadEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch {
    /* malformed .env — ignore and rely on the ambient environment */
  }
}

export interface ParsedArgs {
  _: string[];
  [key: string]: string | boolean | string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

export function requireStr(args: ParsedArgs, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !v) {
    console.error(`Missing required --${key}`);
    process.exit(1);
  }
  return v;
}

export function optStr(args: ParsedArgs, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

export function optNum(args: ParsedArgs, key: string, fallback: number): number {
  const v = args[key];
  if (typeof v !== "string") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
