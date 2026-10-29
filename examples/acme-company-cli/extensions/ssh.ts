import type { Context, Extension } from "../clewd";
import { acme } from "../lib/acme";

function sshConfig(ctx: Context) {
  const ssh = acme(ctx).ssh;
  if (!ssh || !Object.keys(ssh.hosts).length) throw new Error("add hosts under acme.ssh.hosts in config.ts");
  return ssh;
}

// ssh arguments for a named host. Only names from config are accepted, so
// nobody can smuggle ssh options in through the host argument.
function target(ctx: Context, name: string | undefined): string[] {
  const ssh = sshConfig(ctx);
  if (!name) throw new Error(`which host? One of: ${Object.keys(ssh.hosts).join(", ")}`);
  const address = ssh.hosts[name];
  if (!address) throw new Error(`unknown host "${name}". Known hosts: ${Object.keys(ssh.hosts).join(", ")}`);
  return [...(ssh.jump ? ["-J", ssh.jump] : []), ssh.user ? `${ssh.user}@${address}` : address];
}

export default {
  name: "ssh",
  description: "SSH into Acme servers by name",
  commands: [
    {
      name: "ssh",
      description: "Open a shell on a host, or run a command there",
      usage: "<host> [-- command...]",
      // Interactive, so the terminal is handed straight to ssh.
      run: (ctx) => ctx.exec(["ssh", ...target(ctx, ctx.args[0]), ...ctx.args.slice(1)]),
      subcommands: [
        {
          name: "list",
          aliases: ["ls"],
          description: "List known hosts",
          run(ctx) {
            const { hosts, jump } = sshConfig(ctx);
            const width = Math.max(...Object.keys(hosts).map((n) => n.length));
            for (const [name, address] of Object.entries(hosts)) console.log(`${name.padEnd(width)}  ${address}`);
            if (jump) console.log(`\nvia ${jump}`);
          },
        },
        {
          name: "all",
          description: "Run a command on every host in parallel",
          usage: "-- <command...>",
          async run(ctx) {
            if (!ctx.args.length) throw new Error("usage: clewd ssh all -- uptime");
            const names = Object.keys(sshConfig(ctx).hosts);
            const results = await Promise.all(
              names.map((name) => ctx.$`ssh -o BatchMode=yes ${target(ctx, name)} ${ctx.args}`.quiet().nothrow()),
            );
            let failed = 0;
            results.forEach((res, i) => {
              const out = (res.exitCode === 0 ? res.text() : new TextDecoder().decode(res.stderr)).trim();
              if (res.exitCode !== 0) failed++;
              console.log(`[${names[i]}] ${res.exitCode === 0 ? "" : `(exit ${res.exitCode}) `}${out.replace(/\n/g, `\n[${names[i]}] `)}`);
            });
            return failed ? 1 : 0;
          },
        },
      ],
    },
  ],
} satisfies Extension;
