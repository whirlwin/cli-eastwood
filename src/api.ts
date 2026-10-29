// The public extension API. Extensions and config files in
// ~/.config/cli-eastwood/ import these with `import type` and use
// `satisfies Extension`, so the import is erased at load time and nothing has
// to resolve inside the compiled binary. `clewd ext init` writes this file, as
// clewd.d.ts, next to the user's config. Keep it free of Bun or Node types so
// it typechecks in an editor that has neither installed.

// The subset of Bun's shell that extensions get. Declared here rather than
// borrowed from bun-types so clewd.d.ts stays self-contained.
export interface ShellOutput {
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly exitCode: number;
  text(): string;
  json(): any;
}

export interface ShellPromise extends Promise<ShellOutput> {
  text(): Promise<string>;
  json(): Promise<any>;
  lines(): AsyncIterable<string>;
  quiet(): ShellPromise;
  nothrow(): ShellPromise;
  cwd(dir: string): ShellPromise;
  env(vars: Record<string, string | undefined>): ShellPromise;
}

export type Shell = (strings: TemplateStringsArray, ...values: unknown[]) => ShellPromise;

export type FlagValue = string | boolean | number | undefined;

export interface FlagSpec {
  type: "string" | "boolean" | "number";
  short?: string;
  description?: string;
  default?: string | boolean | number;
}

export interface Logger {
  info(...msg: unknown[]): void;
  warn(...msg: unknown[]): void;
  error(...msg: unknown[]): void;
  debug(...msg: unknown[]): void;
}

// A tiny persistent key/value store, one JSON file per extension under
// ~/.local/state/cli-eastwood/ (or $XDG_STATE_HOME).
export interface Store {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
}

export interface Paths {
  config: string;
  extensions: string;
  state: string;
  cache: string;
}

export interface Context {
  args: string[];
  flags: Record<string, FlagValue>;
  config: Config;
  log: Logger;
  store: Store;
  paths: Paths;
  version: string;
  // Environment variables. Read secrets such as API tokens from here rather
  // than putting them in config.ts.
  env: Record<string, string | undefined>;
  // Bun's shell, for running other programs: await ctx.$`git status`.
  $: Shell;
  // Runs a program attached to the terminal (stdin, stdout and stderr are
  // inherited), for interactive tools like ssh or an editor. Resolves to its
  // exit code. Arguments are passed as-is, never through a shell.
  exec(argv: string[], options?: { cwd?: string; env?: Record<string, string | undefined> }): Promise<number>;
  // Runs another clewd command, so extensions can compose each other.
  run(argv: string[]): Promise<number>;
}

export interface Command {
  name: string;
  description?: string;
  aliases?: string[];
  usage?: string;
  flags?: Record<string, FlagSpec>;
  subcommands?: Command[];
  // Return a number to set the exit code; anything else exits 0.
  run?(ctx: Context): unknown | Promise<unknown>;
}

export interface Hooks {
  beforeCommand?(ctx: Context, command: Command): void | Promise<void>;
  afterCommand?(ctx: Context, command: Command, result: unknown): void | Promise<void>;
  onError?(ctx: Context, command: Command, error: unknown): void | Promise<void>;
}

export interface Extension {
  name: string;
  description?: string;
  commands?: Command[];
  hooks?: Hooks;
}

export interface Config {
  // Extensions defined inline in config.ts, loaded before extensions/*.ts.
  extensions?: Extension[];
  // Extension names to skip when loading.
  disabled?: string[];
  upgrade?: {
    // Check GitHub Releases at most once a day and print a notice. Default true.
    checkOnStartup?: boolean;
    // owner/name of the repo that publishes releases. Default whirlwin/cli-eastwood.
    repo?: string;
  };
  // Free-form settings that extensions can read from ctx.config.
  [key: string]: unknown;
}
