import { $ } from "bun";
import type { Command, Context, FlagValue, Hooks, Shell } from "./api";
import { extCommand } from "./builtins/ext";
import { versionCommand } from "./builtins/version";
import { errorMessage, UsageError } from "./errors";
import { parseFlags } from "./flags";
import { commandHelp, rootHelp } from "./help";
import type { Loaded } from "./loader";
import { createLogger } from "./log";
import { BUILTIN, buildRegistry, resolve, suggest } from "./router";
import { createStore } from "./store";
import { upgradeCommand } from "./upgrade";
import { VERSION } from "./version";
import type { Paths } from "./api";

export const TAGLINE = "There are two kinds of people... those with agent CLIs, and those who grep";

export function createApp(loaded: Loaded, paths: Paths) {
  const { config, extensions } = loaded;
  const log = createLogger();
  const builtins: Command[] = [versionCommand, upgradeCommand, extCommand(loaded, () => registry.collisions)];
  const registry = buildRegistry(builtins, extensions);
  const hooked = extensions.flatMap((e) => (e.extension.hooks ? [{ name: e.extension.name, hooks: e.extension.hooks }] : []));

  const context = (args: string[], flags: Record<string, FlagValue>, owner: string): Context => ({
    args,
    flags,
    config,
    log,
    store: createStore(paths.state, owner),
    paths,
    version: VERSION,
    env: process.env,
    $: $ as unknown as Shell,
    exec: (argv, options) =>
      Bun.spawn(argv, { stdio: ["inherit", "inherit", "inherit"], cwd: options?.cwd, env: options?.env ?? process.env }).exited,
    run: (argv) => run(argv),
  });

  const fail = (message: string, hint?: string) => {
    console.error(`clewd: ${message}${hint ? `\n${hint}` : ""}`);
    return 1;
  };

  // A misbehaving hook is reported but never changes whether a command runs or its exit code.
  async function runHooks(kind: keyof Hooks, ctx: Context, command: Command, extra?: unknown) {
    for (const { name, hooks } of hooked) {
      try {
        await (hooks[kind] as ((...a: unknown[]) => unknown) | undefined)?.call(hooks, ctx, command, extra);
      } catch (e) {
        console.error(`clewd: hook ${name}.${kind} failed: ${errorMessage(e).split("\n")[0]}`);
      }
    }
  }

  async function execute(command: Command, ctx: Context): Promise<number> {
    await runHooks("beforeCommand", ctx, command);
    let result: unknown;
    try {
      result = await command.run!(ctx);
    } catch (error) {
      await runHooks("onError", ctx, command, error);
      const detail = process.env.CLEWD_DEBUG === "1" && error instanceof Error && error.stack;
      return fail(detail || errorMessage(error));
    }
    await runHooks("afterCommand", ctx, command, result);
    return typeof result === "number" ? result : 0;
  }

  async function run(argv: string[]): Promise<number> {
    if (argv.length === 0) {
      console.log(`${TAGLINE}\n\n${rootHelp(registry.entries, extensions)}`);
      return 0;
    }
    // Root level only, so `upgrade --version <tag>` reaches the upgrade command.
    if (argv[0] === "--version") return run(["version"]);
    if (argv[0] === "--help" || argv[0] === "-h") {
      console.log(rootHelp(registry.entries, extensions));
      return 0;
    }

    const found = resolve(registry.entries, argv);
    if (!found.ok) {
      const what = found.path.length ? `subcommand "${found.name}" of ${found.path.join(" ")}` : `command "${found.name}"`;
      const maybe = suggest(found.name, found.candidates);
      const helpCmd = found.path.length ? `clewd ${found.path.join(" ")} --help` : "clewd --help";
      return fail(`unknown ${what}.${maybe ? ` Did you mean "${maybe}"?` : ""}`, `Run "${helpCmd}" to see what is available.`);
    }
    const { command, path, owner, rest } = found;
    if (!command.run) {
      console.log(commandHelp(path, command));
      return 0;
    }
    let parsed;
    try {
      parsed = parseFlags(rest, command.flags);
    } catch (e) {
      if (!(e instanceof UsageError)) throw e;
      return fail(e.message, `Run "clewd ${path.join(" ")} --help" for usage.`);
    }
    if (parsed.help) {
      console.log(commandHelp(path, command));
      return 0;
    }
    return execute(command, context(parsed.args, parsed.flags, owner === BUILTIN ? "clewd" : owner));
  }

  return { run, registry };
}
