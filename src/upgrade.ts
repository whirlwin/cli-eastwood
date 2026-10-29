import { createHash } from "node:crypto";
import { chmod, realpath, rename, unlink, writeFile, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Command, Context } from "./api";
import { VERSION } from "./version";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_REPO = "whirlwin/cli-eastwood";
const DAY_MS = 24 * 60 * 60 * 1000;

export function assetName(platform: string, arch: string): string {
  if (platform !== "darwin" && platform !== "linux") throw new Error(`unsupported platform: ${platform}`);
  if (arch !== "arm64" && arch !== "x64") throw new Error(`unsupported architecture: ${arch}`);
  return `clewd-${platform}-${arch}`;
}

// `sha256sum` format: "<hex>  <filename>", with "*" before the name in binary mode.
export function parseChecksums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim());
    if (m) out.set(m[2]!, m[1]!.toLowerCase());
  }
  return out;
}

function parseSemver(v: string): { core: number[]; pre: string } | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(v.trim());
  return m ? { core: [+m[1]!, +m[2]!, +m[3]!], pre: m[4] ?? "" } : undefined;
}

// Returns <0, 0, >0. Unparseable versions compare as equal so we never
// "upgrade" on garbage input. A prerelease sorts below its release.
export function compareSemver(a: string, b: string): number {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i]! - y.core[i]!;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

// In dev, process.execPath is the bun executable itself; replacing it would
// wreck the user's Bun. A compiled binary's entry lives in Bun's virtual FS.
export function isCompiledBinary(execPath = process.execPath, main = Bun.main): boolean {
  const base = basename(execPath).toLowerCase();
  if (base === "bun" || base === "bun.exe") return false;
  return main.includes("$bunfs") || main.includes("~BUN");
}

export interface InstallOptions {
  url: string;
  checksumsUrl: string;
  target: string;
  fetch: Fetch;
  // Runs on the verified temp file before it replaces the target (codesign, smoke test).
  prepare?: (tmpPath: string) => Promise<void>;
}

export async function installBinary(opts: InstallOptions): Promise<void> {
  const name = basename(new URL(opts.url).pathname);
  const get = async (url: string) => {
    const res = await opts.fetch(url);
    if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
    return res;
  };
  const expected = parseChecksums(await (await get(opts.checksumsUrl)).text()).get(name);
  if (!expected) throw new Error(`no checksum for ${name} in checksums.txt`);
  const data = new Uint8Array(await (await get(opts.url)).arrayBuffer());
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== expected) throw new Error(`checksum mismatch for ${name}: expected ${expected}, got ${actual}`);

  // Same directory as the target: rename(2) fails with EXDEV across filesystems.
  const tmp = join(dirname(opts.target), `.${basename(opts.target)}.upgrade-${process.pid}-${Date.now()}`);
  try {
    await writeFile(tmp, data, { mode: 0o755 });
    await chmod(tmp, 0o755);
    await opts.prepare?.(tmp);
    await rename(tmp, opts.target);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

interface Release {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
}

async function fetchRelease(repo: string, tag: string | undefined, f: Fetch, signal?: AbortSignal): Promise<Release> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "clewd" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const path = tag ? `tags/${tag.startsWith("v") ? tag : `v${tag}`}` : "latest";
  const res = await f(`https://api.github.com/repos/${repo}/releases/${path}`, { headers, signal });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status} for ${repo} (${tag ?? "latest"})`);
  return (await res.json()) as Release;
}

export async function smokeTest(path: string, expectedVersion: string): Promise<void> {
  // CLEWD_NO_EXTENSIONS keeps user extensions from affecting the check.
  const proc = Bun.spawn([path, "version"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CLEWD_NO_EXTENSIONS: "1" },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, 10_000);
  try {
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (timedOut) throw new Error("the downloaded binary timed out running `version`");
    if (code !== 0) throw new Error(`the downloaded binary failed to run \`version\` (exit ${code})`);
    if (out.trim() !== `clewd ${expectedVersion}`) {
      throw new Error(`the downloaded binary reported "${out.trim()}", expected "clewd ${expectedVersion}"`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function prepareForInstall(tmp: string, expectedVersion: string): Promise<void> {
  if (process.platform === "darwin") {
    // Apple Silicon kills unsigned binaries; best-effort because codesign may be absent.
    try {
      await Bun.spawn(["codesign", "--force", "-s", "-", tmp], { stdout: "ignore", stderr: "ignore" }).exited;
    } catch {}
  }
  await smokeTest(tmp, expectedVersion);
}

async function run(ctx: Context): Promise<number> {
  const repo = ctx.config.upgrade?.repo ?? DEFAULT_REPO;
  const pinned = typeof ctx.flags.version === "string" ? ctx.flags.version : undefined;
  const check = ctx.flags.check === true;
  const force = ctx.flags.force === true;

  if (!check && !isCompiledBinary()) {
    console.error(
      "clewd upgrade only works on the compiled binary. You are running from source (dev mode); " +
        "refusing to touch the bun executable. Use git pull instead, or install a release with install.sh.",
    );
    return 1;
  }

  let release: Release;
  try {
    release = await fetchRelease(repo, pinned, fetch);
  } catch (e) {
    console.error(`Could not look up the release: ${(e as Error).message}`);
    return 1;
  }
  const latest = release.tag_name.replace(/^v/, "");
  const newer = compareSemver(latest, VERSION) > 0;

  if (check) {
    console.log(newer ? `clewd ${latest} is available (you have ${VERSION}). Run: clewd upgrade` : `clewd ${VERSION} is already up to date`);
    return 0;
  }
  if (!newer && !force && !pinned) {
    console.log(`clewd ${VERSION} is already up to date`);
    return 0;
  }
  if (!force && pinned && compareSemver(latest, VERSION) === 0) {
    console.log(`clewd ${VERSION} is already installed (use --force to reinstall)`);
    return 0;
  }

  let asset: string;
  try {
    asset = assetName(process.platform, process.arch);
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
  const url = release.assets.find((a) => a.name === asset)?.browser_download_url;
  const checksumsUrl = release.assets.find((a) => a.name === "checksums.txt")?.browser_download_url;
  if (!url || !checksumsUrl) {
    console.error(`Release ${release.tag_name} has no ${asset} or checksums.txt asset.`);
    return 1;
  }

  const target = await realpath(process.execPath);
  console.log(`Upgrading clewd ${VERSION} -> ${latest} (${target})`);
  try {
    await installBinary({ url, checksumsUrl, target, fetch, prepare: (tmp) => prepareForInstall(tmp, latest) });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EACCES" || err.code === "EPERM" || err.code === "EROFS") {
      console.error(
        `Cannot write to ${dirname(target)}. Reinstall to a directory you own: ` +
          `curl -fsSL https://raw.githubusercontent.com/${repo}/main/install.sh | sh  (installs to ~/.local/bin)`,
      );
    } else {
      console.error(`Upgrade failed, the existing binary was left in place: ${err.message}`);
    }
    return 1;
  }
  console.log(`clewd upgraded to ${latest}`);
  return 0;
}

export const upgradeCommand: Command = {
  name: "upgrade",
  description: "Upgrade clewd to the latest release",
  usage: "clewd upgrade [--check] [--force] [--version <tag>]",
  flags: {
    check: { type: "boolean", description: "Only report whether a newer release exists" },
    force: { type: "boolean", description: "Reinstall even if the version is the same" },
    version: { type: "string", description: "Install a specific release tag" },
  },
  run,
};

// Returns a one-line "new version available" notice from the cached check, or
// undefined. Must never block the command noticeably: it reads the cache in
// statePath and refreshes it in the background at most once a day.
//
// The refresh is awaited with a 1s timeout instead of fired and forgotten: a
// dangling fetch keeps the event loop alive or gets killed mid-write on exit,
// and a detached `__update-check` child would need routing in main and would
// not work in dev. Once a day the worst case is a 1s delay on a bad network;
// a failed check still records checkedAt so it is not retried on every run.
export async function updateNotice(opts: {
  version: string;
  repo: string;
  statePath: string;
  enabled: boolean;
}): Promise<string | undefined> {
  try {
    if (!opts.enabled || opts.version.endsWith("-dev")) return undefined;
    const file = join(opts.statePath, "update-check.json");
    let cache: { checkedAt?: number; latest?: string } = {};
    try {
      cache = JSON.parse(await readFile(file, "utf8"));
    } catch {}
    if (typeof cache.checkedAt !== "number" || Date.now() - cache.checkedAt > DAY_MS) {
      let latest = cache.latest;
      try {
        latest = (await fetchRelease(opts.repo, undefined, fetch, AbortSignal.timeout(1000))).tag_name.replace(/^v/, "");
      } catch {}
      cache = { checkedAt: Date.now(), latest };
      await mkdir(opts.statePath, { recursive: true });
      await writeFile(file, JSON.stringify(cache));
    }
    if (cache.latest && compareSemver(cache.latest, opts.version) > 0) {
      return `clewd ${cache.latest} is available (you have ${opts.version}). Run: clewd upgrade`;
    }
  } catch {}
  return undefined;
}
