import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./api";

export function createStore(stateDir: string, name: string): Store {
  const file = join(stateDir, `${name.replace(/[^\w.-]/g, "_")}.json`);
  const read = (): Record<string, unknown> => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return {}; // missing or corrupt: start fresh rather than break the command
    }
  };
  const write = (data: Record<string, unknown>) => {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  };
  return {
    get: <T = unknown>(key: string) => read()[key] as T | undefined,
    set: (key, value) => write({ ...read(), [key]: value }),
    delete: (key) => {
      const data = read();
      delete data[key];
      write(data);
    },
  };
}
