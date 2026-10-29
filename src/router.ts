import type { Command } from "./api";
import type { LoadedExtension } from "./loader";

export const BUILTIN = "built-in";

export interface Entry {
  command: Command;
  owner: string;
}
export interface Collision {
  name: string;
  kept: string;
  dropped: string;
}
export interface Registry {
  entries: Entry[];
  collisions: Collision[];
}

// Built-ins are registered first so they win; among extensions, load order decides.
export function buildRegistry(builtins: Command[], extensions: LoadedExtension[]): Registry {
  const taken = new Map<string, string>();
  const entries: Entry[] = [];
  const collisions: Collision[] = [];

  const add = (command: Command, owner: string) => {
    const kept = taken.get(command.name);
    if (kept !== undefined) {
      collisions.push({ name: command.name, kept, dropped: owner });
      return;
    }
    taken.set(command.name, owner);
    const aliases = (command.aliases ?? []).filter((alias) => {
      const holder = taken.get(alias);
      if (holder !== undefined) collisions.push({ name: alias, kept: holder, dropped: owner });
      else taken.set(alias, owner);
      return holder === undefined;
    });
    entries.push({ command: aliases.length === (command.aliases?.length ?? 0) ? command : { ...command, aliases }, owner });
  };

  builtins.forEach((c) => add(c, BUILTIN));
  for (const { extension } of extensions) (extension.commands ?? []).forEach((c) => add(c, extension.name));
  return { entries, collisions };
}

export type Resolution =
  | { ok: true; command: Command; path: string[]; owner: string; rest: string[] }
  | { ok: false; path: string[]; name: string; candidates: string[] };

const matches = (c: Command, name: string) => c.name === name || (c.aliases ?? []).includes(name);
const namesOf = (cs: Command[]) => cs.flatMap((c) => [c.name, ...(c.aliases ?? [])]);

export function resolve(entries: Entry[], argv: string[]): Resolution {
  const entry = entries.find((e) => matches(e.command, argv[0]));
  if (!entry) return { ok: false, path: [], name: argv[0], candidates: namesOf(entries.map((e) => e.command)) };
  let command = entry.command;
  const path = [command.name];
  let i = 1;
  while (command.subcommands?.length && i < argv.length && !argv[i].startsWith("-")) {
    const sub = command.subcommands.find((c) => matches(c, argv[i]));
    if (!sub) {
      if (command.run) break; // the word is a positional argument
      return { ok: false, path, name: argv[i], candidates: namesOf(command.subcommands) };
    }
    command = sub;
    path.push(sub.name);
    i++;
  }
  return { ok: true, command, path, owner: entry.owner, rest: argv.slice(i) };
}

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

export function suggest(name: string, candidates: string[]): string | undefined {
  const scored = candidates.map((c) => ({ c, d: c.startsWith(name) ? 0 : distance(name, c) }));
  scored.sort((x, y) => x.d - y.d);
  return scored[0] && scored[0].d <= 2 ? scored[0].c : undefined;
}
