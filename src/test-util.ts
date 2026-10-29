import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Paths } from "./api";
import { getPaths } from "./paths";

// Every test lives in a temp HOME so the real ~/.config is never touched.
export function tempEnv() {
  const root = mkdtempSync(join(tmpdir(), "clewd-test-"));
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: root,
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_CACHE_HOME: join(root, "cache"),
    CI: "1",
  };
  return { root, env, paths: getPaths(env) as Paths };
}

export function writeExtension(paths: Paths, file: string, source: string): void {
  mkdirSync(paths.extensions, { recursive: true });
  writeFileSync(join(paths.extensions, file), source);
}

export async function clewd(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "main.ts"), ...args], { env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}

// Runs fn with console.log and console.error captured.
export async function capture<T>(fn: () => Promise<T>): Promise<{ result: T; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const [log, error] = [console.log, console.error];
  console.log = (...a) => void out.push(a.join(" "));
  console.error = (...a) => void err.push(a.join(" "));
  try {
    const result = await fn();
    return { result, out: out.join("\n"), err: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}
