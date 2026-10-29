import type { FlagSpec, FlagValue } from "./api";
import { UsageError } from "./errors";

export interface Parsed {
  args: string[];
  flags: Record<string, FlagValue>;
  // A bare --help or -h in flag position; one consumed as a flag's value does not count.
  help: boolean;
}

export function parseFlags(argv: string[], specs: Record<string, FlagSpec> = {}): Parsed {
  const shorts = new Map<string, string>();
  const flags: Record<string, FlagValue> = {};
  for (const [name, spec] of Object.entries(specs)) {
    if (spec.short) shorts.set(spec.short, name);
    if (spec.default !== undefined) flags[name] = spec.default;
  }
  const args: string[] = [];
  let help = false;

  // Returns true when the value was taken from the next token.
  const assign = (name: string, display: string, inline: string | undefined, next: string | undefined, negate: boolean) => {
    const spec = specs[name];
    if (spec.type === "boolean") {
      if (inline !== undefined && inline !== "true" && inline !== "false") throw new UsageError(`${display} expects true or false`);
      flags[name] = inline === undefined ? !negate : inline === "true";
      return false;
    }
    const raw = inline ?? next;
    if (raw === undefined) throw new UsageError(`${display} needs a value`);
    if (spec.type === "number") {
      const n = Number(raw);
      if (raw.trim() === "" || Number.isNaN(n)) throw new UsageError(`${display} expects a number, got "${raw}"`);
      flags[name] = n;
    } else {
      flags[name] = raw;
    }
    return inline === undefined;
  };

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--") {
      args.push(...argv.slice(i + 1));
      break;
    }
    if ((tok === "--help" && !Object.hasOwn(specs, "help")) || (tok === "-h" && !shorts.has("h"))) {
      help = true;
    } else if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      let name = eq < 0 ? tok.slice(2) : tok.slice(2, eq);
      const inline = eq < 0 ? undefined : tok.slice(eq + 1);
      let negate = false;
      if (!Object.hasOwn(specs, name) && name.startsWith("no-") && specs[name.slice(3)]?.type === "boolean") {
        name = name.slice(3);
        negate = true;
      }
      if (!Object.hasOwn(specs, name)) throw new UsageError(`unknown flag --${name}`);
      if (assign(name, `--${name}`, inline, argv[i + 1], negate)) i++;
    } else if (/^-[A-Za-z]/.test(tok)) {
      const name = shorts.get(tok[1]);
      if (name === undefined) throw new UsageError(`unknown flag -${tok[1]}`);
      const inline = tok[2] === "=" ? tok.slice(3) : undefined;
      if (inline === undefined && tok.length > 2) throw new UsageError(`unknown flag ${tok}`);
      if (assign(name, `-${tok[1]}`, inline, argv[i + 1], false)) i++;
    } else {
      args.push(tok); // includes "-" and negative numbers
    }
  }
  return { args, flags, help };
}
