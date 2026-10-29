// Shared by the Acme extensions. It lives outside extensions/ because clewd
// loads every file in there as an extension; relative imports work fine.
import type { Context } from "../clewd";

export interface AcmeConfig {
  slack?: { defaultChannel?: string };
  jira?: { url: string; project?: string };
  ssh?: {
    user?: string;
    // Bastion to hop through, passed to ssh -J.
    jump?: string;
    // Short name to hostname or IP.
    hosts: Record<string, string>;
  };
}

export function acme(ctx: Context): AcmeConfig {
  return (ctx.config.acme as AcmeConfig | undefined) ?? {};
}

// Secrets come from the environment, never from config.ts, so the config can
// be shared or committed.
export function secret(ctx: Context, name: string, hint: string): string {
  const value = ctx.env[name];
  if (!value) throw new Error(`${name} is not set (${hint})`);
  return value;
}

export async function getJson(res: Response, what: string): Promise<any> {
  const body = await res.text();
  if (!res.ok) throw new Error(`${what} failed with HTTP ${res.status}: ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : undefined;
}

export async function openUrl(ctx: Context, url: string): Promise<void> {
  const opened = await ctx.$`open ${url} 2>/dev/null || xdg-open ${url} 2>/dev/null`.quiet().nothrow();
  if (opened.exitCode !== 0) console.log(url);
}
