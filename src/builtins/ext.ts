import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "../api";
import { UsageError } from "../errors";
import { ensureInit, initFiles } from "../init";
import type { Loaded } from "../loader";
import type { Collision } from "../router";

const template = (name: string) => `import type { Extension } from "../clewd";

export default {
  name: ${JSON.stringify(name)},
  description: "Example extension",
  commands: [
    {
      name: ${JSON.stringify(name)},
      description: "Say hello and show the current directory",
      flags: {
        name: { type: "string", short: "n", description: "Who to greet", default: "world" },
      },
      async run(ctx) {
        const cwd = (await ctx.$\`pwd\`.text()).trim();
        console.log(\`Hello, \${ctx.flags.name}! You are in \${cwd}\`);
      },
    },
  ],
} satisfies Extension;
`;

export function extCommand(loaded: Loaded, collisions: () => Collision[]): Command {
  return {
    name: "ext",
    description: "Manage clewd extensions",
    subcommands: [
      {
        name: "init",
        description: "Write editor support files (clewd.d.ts, tsconfig.json) and create the extensions directory",
        run(ctx) {
          for (const file of initFiles(ctx.paths)) console.log(`wrote ${file}`);
        },
      },
      {
        name: "new",
        description: "Create an extension from a template",
        usage: "<name>",
        run(ctx) {
          const [name] = ctx.args;
          if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
            throw new UsageError("ext new needs a name of lowercase letters, digits and dashes, e.g. clewd ext new hello");
          }
          ensureInit(ctx.paths);
          mkdirSync(ctx.paths.extensions, { recursive: true });
          const file = join(ctx.paths.extensions, `${name}.ts`);
          if (existsSync(file)) throw new Error(`${file} already exists`);
          writeFileSync(file, template(name));
          console.log(file);
        },
      },
      {
        name: "list",
        description: "List loaded extensions and their commands",
        run() {
          if (loaded.extensions.length === 0) console.log("No extensions loaded. Try: clewd ext new <name>");
          for (const { extension, source } of loaded.extensions) {
            const commands = (extension.commands ?? []).map((c) => c.name).join(", ") || "none";
            console.log(`${extension.name}\n  source:   ${source}\n  commands: ${commands}`);
          }
        },
      },
      {
        name: "doctor",
        description: "Report extensions that failed to load and command name collisions",
        run() {
          const clashes = collisions();
          for (const { source, message } of loaded.errors) console.log(`error: ${source}: ${message}`);
          for (const c of clashes) {
            console.log(`collision: "${c.name}" from ${c.dropped} ignored, already provided by ${c.kept}`);
          }
          const problems = loaded.errors.length + clashes.length;
          if (problems === 0) console.log(`No problems found (${loaded.extensions.length} extensions loaded).`);
          return problems === 0 ? 0 : 1;
        },
      },
    ],
  };
}
