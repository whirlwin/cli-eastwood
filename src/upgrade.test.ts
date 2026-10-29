import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "./api";
import { assetName, compareSemver, installBinary, isCompiledBinary, parseChecksums, smokeTest, updateNotice, upgradeCommand } from "./upgrade";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
let dir: string;
const saved = { HOME: process.env.HOME, XDG: process.env.XDG_STATE_HOME, fetch: globalThis.fetch };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "clewd-upgrade-"));
  process.env.HOME = dir;
  process.env.XDG_STATE_HOME = join(dir, "state");
});
afterEach(() => {
  process.env.HOME = saved.HOME;
  if (saved.XDG === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = saved.XDG;
  globalThis.fetch = saved.fetch;
  rmSync(dir, { recursive: true, force: true });
});

function fakeFetch(files: Record<string, string>) {
  return async (url: string) =>
    url in files ? new Response(files[url]) : new Response("nope", { status: 404 });
}

describe("assetName", () => {
  test("maps supported platforms", () => {
    expect(assetName("darwin", "arm64")).toBe("clewd-darwin-arm64");
    expect(assetName("linux", "x64")).toBe("clewd-linux-x64");
  });
  test("rejects unsupported", () => {
    expect(() => assetName("win32", "x64")).toThrow();
    expect(() => assetName("linux", "ia32")).toThrow();
  });
});

test("parseChecksums reads sha256sum format", () => {
  const a = sha("a");
  const b = sha("b");
  const m = parseChecksums(`${a}  clewd-linux-x64\n${b} *clewd-darwin-arm64\ngarbage\n`);
  expect(m.get("clewd-linux-x64")).toBe(a);
  expect(m.get("clewd-darwin-arm64")).toBe(b);
  expect(m.size).toBe(2);
});

test("compareSemver", () => {
  expect(compareSemver("0.2.0", "0.1.9")).toBeGreaterThan(0);
  expect(compareSemver("v1.0.0", "1.0.0")).toBe(0);
  expect(compareSemver("0.9.0", "0.10.0")).toBeLessThan(0);
  expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
  expect(compareSemver("0.1.0", "0.0.0-dev")).toBeGreaterThan(0);
  expect(compareSemver("nonsense", "1.0.0")).toBe(0);
});

test("isCompiledBinary", () => {
  expect(isCompiledBinary("/home/u/.bun/bin/bun", "/src/main.ts")).toBe(false);
  expect(isCompiledBinary("/home/u/.bun/bin/bun", "/$bunfs/root/clewd")).toBe(false);
  expect(isCompiledBinary("/home/u/.local/bin/clewd", "/src/main.ts")).toBe(false);
  expect(isCompiledBinary("/home/u/.local/bin/clewd", "/$bunfs/root/clewd")).toBe(true);
});

describe("installBinary", () => {
  const url = "https://example.test/dl/clewd-linux-x64";
  const checksumsUrl = "https://example.test/dl/checksums.txt";

  test("replaces the target atomically and leaves no temp files", async () => {
    const target = join(dir, "clewd");
    writeFileSync(target, "old");
    await installBinary({
      url,
      checksumsUrl,
      target,
      fetch: fakeFetch({ [url]: "new-binary", [checksumsUrl]: `${sha("new-binary")}  clewd-linux-x64\n` }),
    });
    expect(readFileSync(target, "utf8")).toBe("new-binary");
    expect(statSync(target).mode & 0o777).toBe(0o755);
    expect(readdirSync(dir)).toEqual(["clewd"]);
  });

  test("checksum mismatch leaves the target untouched", async () => {
    const target = join(dir, "clewd");
    writeFileSync(target, "old");
    await expect(
      installBinary({
        url,
        checksumsUrl,
        target,
        fetch: fakeFetch({ [url]: "tampered", [checksumsUrl]: `${sha("good")}  clewd-linux-x64\n` }),
      }),
    ).rejects.toThrow(/checksum mismatch/);
    expect(readFileSync(target, "utf8")).toBe("old");
    expect(readdirSync(dir)).toEqual(["clewd"]);
  });

  test("missing checksum entry aborts", async () => {
    const target = join(dir, "clewd");
    writeFileSync(target, "old");
    await expect(
      installBinary({ url, checksumsUrl, target, fetch: fakeFetch({ [url]: "x", [checksumsUrl]: `${sha("x")}  other\n` }) }),
    ).rejects.toThrow(/no checksum/);
    expect(readFileSync(target, "utf8")).toBe("old");
  });

  test("failing prepare step keeps the old binary and removes the temp file", async () => {
    const target = join(dir, "clewd");
    writeFileSync(target, "old");
    await expect(
      installBinary({
        url,
        checksumsUrl,
        target,
        fetch: fakeFetch({ [url]: "bin", [checksumsUrl]: `${sha("bin")}  clewd-linux-x64\n` }),
        prepare: async () => {
          throw new Error("smoke test failed");
        },
      }),
    ).rejects.toThrow(/smoke/);
    expect(readFileSync(target, "utf8")).toBe("old");
    expect(readdirSync(dir)).toEqual(["clewd"]);
  });
});

test("upgrade refuses in dev mode and never downloads", async () => {
  const err = spyOn(console, "error").mockImplementation(() => {});
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("");
  }) as unknown as typeof fetch;
  const ctx = { flags: {}, config: {}, args: [] } as unknown as Context;
  expect(await upgradeCommand.run!(ctx)).toBe(1);
  expect(err.mock.calls[0]![0]).toContain("dev mode");
  expect(called).toBe(false);
  err.mockRestore();
});

describe("updateNotice", () => {
  const base = () => ({ version: "0.1.0", repo: "o/r", statePath: join(dir, "state"), enabled: true });
  const mockLatest = (tag: string) => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return Response.json({ tag_name: tag, assets: [] });
    }) as unknown as typeof fetch;
    return () => calls;
  };

  test("fetches, caches and reports a newer version", async () => {
    const calls = mockLatest("v0.2.0");
    expect(await updateNotice(base())).toBe("clewd 0.2.0 is available (you have 0.1.0). Run: clewd upgrade");
    expect(await updateNotice(base())).toContain("0.2.0");
    expect(calls()).toBe(1);
    expect(JSON.parse(readFileSync(join(dir, "state", "update-check.json"), "utf8")).latest).toBe("0.2.0");
  });

  test("refreshes a stale cache", async () => {
    const calls = mockLatest("v0.3.0");
    await updateNotice(base()); // populate
    writeFileSync(join(dir, "state", "update-check.json"), JSON.stringify({ checkedAt: Date.now() - 25 * 3600_000, latest: "0.2.0" }));
    expect(await updateNotice(base())).toContain("0.3.0");
    expect(calls()).toBe(2);
  });

  test("no notice when current, disabled, or dev", async () => {
    const calls = mockLatest("v0.1.0");
    expect(await updateNotice(base())).toBeUndefined();
    expect(await updateNotice({ ...base(), enabled: false })).toBeUndefined();
    expect(await updateNotice({ ...base(), version: "0.0.0-dev" })).toBeUndefined();
    expect(calls()).toBe(1);
  });

  test("never throws when the network fails", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await updateNotice(base())).toBeUndefined();
  });
});

describe("smokeTest", () => {
  const script = (body: string) => {
    const p = join(dir, "fake");
    writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return p;
  };
  test("accepts matching version and passes CLEWD_NO_EXTENSIONS", async () => {
    await smokeTest(script('[ "$CLEWD_NO_EXTENSIONS" = 1 ] && echo "clewd 1.2.3"'), "1.2.3");
  });
  test("rejects a wrong version", async () => {
    await expect(smokeTest(script("echo clewd 9.9.9"), "1.2.3")).rejects.toThrow(/expected/);
  });
  test("rejects a nonzero exit", async () => {
    await expect(smokeTest(script("exit 3"), "1.2.3")).rejects.toThrow(/exit 3/);
  });
});
