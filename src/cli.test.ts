import { expect, test } from "bun:test";
import type { Command, Extension } from "./api";
import { createApp } from "./cli";
import { commandHelp, rootHelp } from "./help";
import type { Loaded } from "./loader";
import { capture, tempEnv } from "./test-util";

function app(extensions: Extension[]) {
  const { paths } = tempEnv();
  const loaded: Loaded = {
    config: {},
    extensions: extensions.map((extension) => ({ extension, source: `${extension.name}.ts` })),
    errors: [],
  };
  return createApp(loaded, paths);
}

const run = (a: ReturnType<typeof app>, argv: string[]) => capture(() => a.run(argv));

test("routes nested subcommands, aliases, flags and args", async () => {
  const seen: unknown[] = [];
  const a = app([
    {
      name: "x",
      commands: [
        {
          name: "tool",
          aliases: ["t"],
          subcommands: [
            { name: "go", aliases: ["g"], flags: { n: { type: "number", short: "n" } }, run: (ctx) => void seen.push([ctx.args, ctx.flags]) },
          ],
        },
      ],
    },
  ]);
  expect((await run(a, ["t", "g", "-n", "3", "pos"])).result).toBe(0);
  expect(seen).toEqual([[["pos"], { n: 3 }]]);
});

test("a command's numeric return value is the exit code", async () => {
  const a = app([{ name: "x", commands: [{ name: "fail", run: () => 7 }, { name: "ok", run: () => "ignored" }] }]);
  expect((await run(a, ["fail"])).result).toBe(7);
  expect((await run(a, ["ok"])).result).toBe(0);
});

test("unknown command suggests a close match and exits 1", async () => {
  const a = app([{ name: "x", commands: [{ name: "deploy", run: () => {} }] }]);
  const { result, err } = await run(a, ["deploi"]);
  expect(result).toBe(1);
  expect(err).toContain('unknown command "deploi"');
  expect(err).toContain('Did you mean "deploy"?');
});

test("unknown subcommand of a group is an error", async () => {
  const { result, err } = await run(app([]), ["ext", "lst"]);
  expect(result).toBe(1);
  expect(err).toContain('Did you mean "list"?');
});

test("thrown errors print clewd: message and exit 1", async () => {
  const a = app([{ name: "x", commands: [{ name: "bad", run: () => { throw new Error("nope"); } }] }]);
  const { result, err } = await run(a, ["bad"]);
  expect(result).toBe(1);
  expect(err).toBe("clewd: nope");
});

test("--help and root help list commands grouped by extension", async () => {
  const a = app([{ name: "hello", description: "Greets", commands: [{ name: "hi", description: "Say hi", flags: { to: { type: "string", short: "t", description: "Target", default: "you" } }, run: () => {} }] }]);
  const root = (await run(a, [])).out;
  expect(root).toContain("There are two kinds of people... those with agent CLIs, and those who grep");
  expect(root).toContain("Built-in commands");
  expect(root).toContain("Extension hello: Greets");
  const help = (await run(a, ["hi", "--help"])).out;
  expect(help).toContain("Usage: clewd hi [options]");
  expect(help).toContain("-t, --to <string>");
  expect(help).toContain("(default: you)");
  expect((await run(a, ["ext", "-h"])).out).toContain("doctor");
  expect(rootHelp(a.registry.entries, [])).toContain("version");
  expect(commandHelp(["x"], { name: "x", aliases: ["y"] })).toContain("Aliases: y");
});

test("built-ins win collisions; among extensions the first loaded wins", async () => {
  const mark: string[] = [];
  const cmd = (id: string, name: string): Command => ({ name, run: () => void mark.push(id) });
  const a = app([
    { name: "one", commands: [cmd("one-dup", "dup"), cmd("one-version", "version")] },
    { name: "two", commands: [cmd("two-dup", "dup")] },
  ]);
  await run(a, ["dup"]);
  expect(mark).toEqual(["one-dup"]);
  expect((await run(a, ["version"])).out).toContain("clewd ");
  expect(mark).toEqual(["one-dup"]);
  expect(a.registry.collisions).toEqual([
    { name: "version", kept: "built-in", dropped: "one" },
    { name: "dup", kept: "one", dropped: "two" },
  ]);
});

test("hooks run in load order around every command, built-ins included", async () => {
  const events: string[] = [];
  const hook = (id: string): Extension => ({
    name: id,
    hooks: {
      beforeCommand: (_c, cmd) => void events.push(`${id}:before:${cmd.name}`),
      afterCommand: (_c, cmd, result) => void events.push(`${id}:after:${cmd.name}:${result}`),
      onError: (_c, cmd) => void events.push(`${id}:error:${cmd.name}`),
    },
  });
  const a = app([hook("a"), hook("b"), { name: "c", commands: [{ name: "ok", run: () => 0 }, { name: "bad", run: () => { throw new Error("x"); } }] }]);
  await run(a, ["ok"]);
  expect(events).toEqual(["a:before:ok", "b:before:ok", "a:after:ok:0", "b:after:ok:0"]);
  events.length = 0;
  await run(a, ["bad"]);
  expect(events).toEqual(["a:before:bad", "b:before:bad", "a:error:bad", "b:error:bad"]);
  events.length = 0;
  await run(a, ["version"]);
  expect(events[0]).toBe("a:before:version");
});

test("ctx.run dispatches another command and ctx.store persists", async () => {
  let value: unknown;
  const a = app([
    {
      name: "x",
      commands: [
        { name: "set", run: (ctx) => ctx.store.set("k", "v") },
        { name: "get", run: (ctx) => void (value = ctx.store.get("k")) },
        { name: "both", run: async (ctx) => (await ctx.run(["set"])) + (await ctx.run(["get"])) },
      ],
    },
  ]);
  expect((await run(a, ["both"])).result).toBe(0);
  expect(value).toBe("v");
});

test("a flag value of -h runs the command instead of showing help", async () => {
  let seen: unknown;
  const a = app([{ name: "x", commands: [{ name: "grep", flags: { pattern: { type: "string" } }, run: (ctx) => void (seen = ctx.flags.pattern) }] }]);
  expect((await run(a, ["grep", "--pattern", "-h"])).result).toBe(0);
  expect(seen).toBe("-h");
  expect((await run(a, ["grep", "-h"])).out).toContain("Usage: clewd grep");
});

test("throwing hooks warn with the extension name and never change the command or exit code", async () => {
  const events: string[] = [];
  const boom = (): never => {
    throw new Error("hook boom");
  };
  const a = app([
    { name: "bad", hooks: { beforeCommand: boom, afterCommand: boom, onError: boom } },
    { name: "good", hooks: { beforeCommand: () => void events.push("before"), afterCommand: () => void events.push("after"), onError: () => void events.push("error") } },
    { name: "c", commands: [{ name: "ok", run: () => { events.push("run"); return 3; } }, { name: "bad", run: () => { throw new Error("cmd"); } }] },
  ]);
  const ok = await run(a, ["ok"]);
  expect(ok.result).toBe(3);
  expect(events).toEqual(["before", "run", "after"]);
  expect(ok.err).toContain("clewd: hook bad.beforeCommand failed: hook boom");
  expect(ok.err).toContain("clewd: hook bad.afterCommand failed: hook boom");
  events.length = 0;
  const bad = await run(a, ["bad"]);
  expect(bad.result).toBe(1);
  expect(events).toEqual(["before", "error"]);
  expect(bad.err).toContain("clewd: hook bad.onError failed: hook boom");
  expect(bad.err).toContain("clewd: cmd");
});

test("a failing beforeCommand does not stop onError hooks from staying quiet on success", async () => {
  const events: string[] = [];
  const a = app([
    { name: "h", hooks: { beforeCommand: () => { throw new Error("x"); }, onError: () => void events.push("error") } },
    { name: "c", commands: [{ name: "ok", run: () => {} }] },
  ]);
  expect((await run(a, ["ok"])).result).toBe(0);
  expect(events).toEqual([]);
});
