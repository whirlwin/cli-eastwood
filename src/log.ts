import type { Logger } from "./api";

export function createLogger(): Logger {
  return {
    info: (...msg) => console.error(...msg),
    warn: (...msg) => console.error("warning:", ...msg),
    error: (...msg) => console.error("error:", ...msg),
    // Read at call time so tests and extensions can flip it.
    debug: (...msg) => {
      if (process.env.CLEWD_DEBUG === "1") console.error("debug:", ...msg);
    },
  };
}
