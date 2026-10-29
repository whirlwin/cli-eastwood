import type { Command } from "../api";

// `upgrade` smoke-tests a freshly downloaded binary with `<bin> version`.
export const versionCommand: Command = {
  name: "version",
  description: "Print the clewd version",
  run: (ctx) => {
    console.log(`clewd ${ctx.version}`);
  },
};
