import { homedir } from "node:os";
import { join } from "node:path";
import type { Paths } from "./api";

export function getPaths(env: Record<string, string | undefined> = process.env): Paths {
  const home = env.HOME || homedir();
  const dir = (xdg: string | undefined, fallback: string) => join(xdg || join(home, fallback), "cli-eastwood");
  const config = dir(env.XDG_CONFIG_HOME, ".config");
  return {
    config,
    extensions: join(config, "extensions"),
    state: dir(env.XDG_STATE_HOME, ".local/state"),
    cache: dir(env.XDG_CACHE_HOME, ".cache"),
  };
}
