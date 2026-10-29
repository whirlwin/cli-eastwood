import type { Context, Extension } from "../clewd";
import { acme, getJson, openUrl, secret } from "../lib/acme";

function site(ctx: Context): string {
  const url = acme(ctx).jira?.url;
  if (!url) throw new Error("set acme.jira.url in config.ts");
  return url.replace(/\/+$/, "");
}

async function jira(ctx: Context, method: string, path: string, body?: unknown) {
  const email = secret(ctx, "JIRA_EMAIL", "the email you log in to Jira with");
  const token = secret(ctx, "JIRA_TOKEN", "an API token from id.atlassian.com");
  const res = await fetch(`${site(ctx)}${path}`, {
    method,
    headers: { Authorization: `Basic ${btoa(`${email}:${token}`)}`, Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return getJson(res, `Jira ${method} ${path}`);
}

// The key ends up in a URL path, so only accept what a real key looks like.
function issueKey(ctx: Context): string {
  const key = ctx.args[0]?.toUpperCase();
  if (!key || !/^[A-Z][A-Z0-9_]+-\d+$/.test(key)) throw new Error("expected an issue key like OPS-123");
  return key;
}

export default {
  name: "jira",
  description: "Your Jira issues from the terminal",
  commands: [
    {
      name: "jira",
      description: "Work with Acme Jira",
      subcommands: [
        {
          name: "mine",
          aliases: ["ls"],
          description: "List open issues assigned to you",
          flags: { limit: { type: "number", short: "n", description: "How many to show", default: 20 } },
          async run(ctx) {
            const res = await jira(ctx, "POST", "/rest/api/3/search/jql", {
              jql: "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
              fields: ["summary", "status"],
              maxResults: ctx.flags.limit,
            });
            if (!res.issues.length) return console.log("Nothing assigned to you. Enjoy it.");
            for (const issue of res.issues) {
              console.log(`${issue.key.padEnd(10)} ${issue.fields.status.name.padEnd(14)} ${issue.fields.summary}`);
            }
          },
        },
        {
          name: "show",
          description: "Show an issue",
          usage: "<KEY>",
          async run(ctx) {
            const key = issueKey(ctx);
            const issue = await jira(ctx, "GET", `/rest/api/3/issue/${key}?fields=summary,status,assignee,reporter`);
            const f = issue.fields;
            console.log(`${key}: ${f.summary}`);
            console.log(`  status:   ${f.status.name}`);
            console.log(`  assignee: ${f.assignee?.displayName ?? "unassigned"}`);
            console.log(`  reporter: ${f.reporter?.displayName ?? "unknown"}`);
            console.log(`  ${site(ctx)}/browse/${key}`);
          },
        },
        {
          name: "open",
          description: "Open an issue in the browser",
          usage: "<KEY>",
          run: (ctx) => openUrl(ctx, `${site(ctx)}/browse/${issueKey(ctx)}`),
        },
        {
          name: "create",
          description: "Create an issue",
          usage: "<summary...> [--project KEY] [--type Task]",
          flags: {
            project: { type: "string", short: "p", description: "Project key (default: acme.jira.project)" },
            type: { type: "string", short: "t", description: "Issue type", default: "Task" },
          },
          async run(ctx) {
            const project = (ctx.flags.project as string | undefined) ?? acme(ctx).jira?.project;
            const summary = ctx.args.join(" ");
            if (!project || !summary) throw new Error('usage: clewd jira create "Fix the thing" --project OPS');
            const res = await jira(ctx, "POST", "/rest/api/3/issue", {
              fields: { project: { key: project }, summary, issuetype: { name: ctx.flags.type } },
            });
            console.log(`Created ${res.key}: ${site(ctx)}/browse/${res.key}`);
          },
        },
      ],
    },
  ],
} satisfies Extension;
