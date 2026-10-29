import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { Config, Extension, Paths } from "./api";
import { errorMessage } from "./errors";

export interface LoadedExtension {
  extension: Extension;
  source: string;
}
export interface LoadError {
  source: string;
  message: string;
}
export interface Loaded {
  config: Config;
  extensions: LoadedExtension[];
  errors: LoadError[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function validateCommand(c: unknown): void {
  if (!isObject(c) || typeof c.name !== "string" || !c.name || /\s/.test(c.name) || c.name.startsWith("-")) {
    throw new Error("every command needs a name without spaces, not starting with '-'");
  }
  const at = `command "${c.name}"`;
  if (c.run !== undefined && typeof c.run !== "function") throw new Error(`${at}: run must be a function`);
  if (c.aliases !== undefined && !(Array.isArray(c.aliases) && c.aliases.every((a) => typeof a === "string"))) {
    throw new Error(`${at}: aliases must be an array of strings`);
  }
  if (c.flags !== undefined) {
    if (!isObject(c.flags)) throw new Error(`${at}: flags must be an object`);
    for (const [name, spec] of Object.entries(c.flags)) {
      if (!isObject(spec) || !["string", "boolean", "number"].includes(spec.type as string)) {
        throw new Error(`${at}: flag "${name}" needs a type of string, boolean or number`);
      }
    }
  }
  if (c.subcommands !== undefined) {
    if (!Array.isArray(c.subcommands)) throw new Error(`${at}: subcommands must be an array`);
    c.subcommands.forEach(validateCommand);
  }
}

function validateExtension(value: unknown): Extension {
  if (!isObject(value)) throw new Error("default export must be an Extension object");
  if (typeof value.name !== "string" || !value.name) throw new Error("extension needs a name");
  if (value.commands !== undefined) {
    if (!Array.isArray(value.commands)) throw new Error("commands must be an array");
    value.commands.forEach(validateCommand);
  }
  if (value.hooks !== undefined) {
    if (!isObject(value.hooks)) throw new Error("hooks must be an object");
    for (const [name, fn] of Object.entries(value.hooks)) {
      if (typeof fn !== "function") throw new Error(`hook ${name} must be a function`);
    }
  }
  return value as unknown as Extension;
}

export async function loadAll(paths: Paths): Promise<Loaded> {
  const errors: LoadError[] = [];
  const extensions: LoadedExtension[] = [];
  let config: Config = {};
  // Escape hatch for when an extension misbehaves; built-ins then run with default config.
  if (process.env.CLEWD_NO_EXTENSIONS === "1") return { config, extensions, errors };

  // One broken file must never take clewd down, so every failure lands here.
  const fail = (source: string, e: unknown) => {
    const message = errorMessage(e);
    errors.push({ source, message });
    console.error(`clewd: skipped ${source}: ${message.split("\n")[0]} (run "clewd ext doctor" for details)`);
  };

  const configFile = join(paths.config, "config.ts");
  if (existsSync(configFile)) {
    try {
      const value = (await import(configFile)).default;
      if (!isObject(value)) throw new Error("default export must be a Config object");
      config = value as Config;
    } catch (e) {
      fail(configFile, e);
    }
  }

  const disabled = new Set(Array.isArray(config.disabled) ? config.disabled : []);
  const add = (source: string, value: unknown) => {
    try {
      const extension = validateExtension(value);
      if (!disabled.has(extension.name)) extensions.push({ extension, source });
    } catch (e) {
      fail(source, e);
    }
  };

  if (config.extensions !== undefined && !Array.isArray(config.extensions)) {
    fail(configFile, new Error("extensions must be an array"));
  } else {
    (config.extensions ?? []).forEach((ext) => add(configFile, ext));
  }

  let files: string[] = [];
  try {
    files = readdirSync(paths.extensions).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts")).sort();
  } catch {
    // no extensions directory yet
  }
  for (const file of files) {
    if (disabled.has(basename(file, ".ts"))) continue;
    const source = join(paths.extensions, file);
    try {
      add(source, (await import(source)).default);
    } catch (e) {
      fail(source, e);
    }
  }
  return { config, extensions, errors };
}

