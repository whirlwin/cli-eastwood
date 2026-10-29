import type { Command, FlagSpec } from "./api";
import { BUILTIN, type Entry } from "./router";
import type { LoadedExtension } from "./loader";

const table = (rows: [string, string][]) => {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`.trimEnd()).join("\n");
};

export function rootHelp(entries: Entry[], extensions: LoadedExtension[]): string {
  const out = ["Usage: clewd <command> [options]"];
  const owners = [...new Set(entries.map((e) => e.owner))];
  owners.sort((a, b) => Number(b === BUILTIN) - Number(a === BUILTIN)); // stable: built-ins first
  for (const owner of owners) {
    const description = extensions.find((e) => e.extension.name === owner)?.extension.description;
    const title = owner === BUILTIN ? "Built-in commands" : `Extension ${owner}${description ? `: ${description}` : ""}`;
    const rows = entries.filter((e) => e.owner === owner).map((e): [string, string] => [e.command.name, e.command.description ?? ""]);
    out.push(`${title}\n${table(rows)}`);
  }
  out.push('Run "clewd <command> --help" for details.');
  return out.join("\n\n");
}

const flagLabel = (name: string, spec: FlagSpec) =>
  `${spec.short ? `-${spec.short}, ` : "    "}--${name}${spec.type === "boolean" ? "" : ` <${spec.type}>`}`;

export function commandHelp(path: string[], command: Command): string {
  const base = `clewd ${path.join(" ")}`;
  const usage = command.usage ?? (command.subcommands?.length && !command.run ? `${base} <command>` : `${base} [options]`);
  const out = [`Usage: ${usage.startsWith("clewd") ? usage : `${base} ${usage}`}`];
  if (command.description) out.push(command.description);
  if (command.aliases?.length) out.push(`Aliases: ${command.aliases.join(", ")}`);
  if (command.subcommands?.length) {
    out.push(`Commands:\n${table(command.subcommands.map((c): [string, string] => [c.name, c.description ?? ""]))}`);
  }
  const flags = Object.entries(command.flags ?? {}).map(([name, spec]): [string, string] => [
    flagLabel(name, spec),
    `${spec.description ?? ""}${spec.default !== undefined ? ` (default: ${spec.default})` : ""}`.trim(),
  ]);
  flags.push(["-h, --help", "Show this help"]);
  out.push(`Options:\n${table(flags)}`);
  return out.join("\n\n");
}
