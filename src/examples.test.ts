import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clewd, tempEnv } from "./test-util";

// Installs examples/acme-company-cli as a real config dir and drives it
// through clewd, with Slack, Jira and ssh replaced by local fakes.
const { root, env, paths } = tempEnv();
const requests: { path: string; auth: string | null; body: any }[] = [];
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.method === "GET" ? undefined : await req.json();
      requests.push({ path: url.pathname, auth: req.headers.get("authorization"), body });
      if (url.pathname === "/slack/chat.postMessage") return Response.json({ ok: true, ts: "1.2" });
      if (url.pathname === "/slack/users.profile.set") return Response.json({ ok: false, error: "invalid_auth" });
      if (url.pathname === "/rest/api/3/search/jql") {
        return Response.json({ issues: [{ key: "OPS-1", fields: { summary: "Fix the thing", status: { name: "In Progress" } } }] });
      }
      if (url.pathname === "/rest/api/3/issue") return Response.json({ key: "OPS-2" });
      return new Response("not found", { status: 404 });
    },
  });

  cpSync(join(import.meta.dir, "../examples/acme-company-cli"), paths.config, { recursive: true });
  const config = join(paths.config, "config.ts");
  writeFileSync(config, readFileSync(config, "utf8").replace("https://acme.atlassian.net", server.url.origin));

  // A fake ssh that prints the arguments it was given.
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "ssh"), '#!/bin/sh\necho "ssh $*"\n');
  chmodSync(join(bin, "ssh"), 0o755);
  Object.assign(env, {
    PATH: `${bin}:${env.PATH}`,
    SLACK_TOKEN: "xoxp-test",
    SLACK_API_URL: `${server.url.origin}/slack`,
    JIRA_EMAIL: "me@acme.example",
    JIRA_TOKEN: "secret",
  });
});

afterAll(() => server?.stop());

test("the example loads cleanly and typechecks against the generated clewd.d.ts", async () => {
  const doctor = await clewd(["ext", "doctor"], env);
  expect(doctor.stdout).toContain("No problems found (3 extensions loaded)");
  expect(doctor.code).toBe(0);

  const tsc = Bun.spawn([join(import.meta.dir, "../node_modules/.bin/tsc"), "-p", paths.config], { stdout: "pipe" });
  const [out, code] = await Promise.all([new Response(tsc.stdout).text(), tsc.exited]);
  expect(out).toBe("");
  expect(code).toBe(0);
}, 30_000);

test("slack send posts to the default channel with the token", async () => {
  const res = await clewd(["slack", "send", "deploy done"], env);
  expect(res.stdout).toContain("Posted to #ops");
  expect(requests.at(-1)).toEqual({
    path: "/slack/chat.postMessage",
    auth: "Bearer xoxp-test",
    body: { channel: "#ops", text: "deploy done" },
  });
});

test("slack errors surface Slack's error code", async () => {
  const res = await clewd(["slack", "status", "lunch"], env);
  expect(res.code).toBe(1);
  expect(res.stderr).toContain("Slack users.profile.set: invalid_auth");
});

test("jira mine lists issues and jira create uses the default project", async () => {
  const mine = await clewd(["jira", "mine"], env);
  expect(mine.stdout).toContain("OPS-1");
  expect(mine.stdout).toContain("Fix the thing");
  expect(requests.at(-1)!.auth).toBe(`Basic ${btoa("me@acme.example:secret")}`);

  const created = await clewd(["jira", "create", "New", "thing"], env);
  expect(created.stdout).toContain("Created OPS-2");
  expect(requests.at(-1)!.body.fields).toEqual({ project: { key: "OPS" }, summary: "New thing", issuetype: { name: "Task" } });
});

test("jira rejects anything that is not an issue key", async () => {
  const res = await clewd(["jira", "show", "../../admin"], env);
  expect(res.code).toBe(1);
  expect(res.stderr).toContain("expected an issue key");
});

test("missing secrets explain what to set", async () => {
  const res = await clewd(["jira", "mine"], { ...env, JIRA_TOKEN: "" });
  expect(res.stderr).toContain("JIRA_TOKEN is not set");
});

test("ssh resolves host names through the jump host and refuses unknown hosts", async () => {
  const list = await clewd(["ssh", "list"], env);
  expect(list.stdout).toContain("web-1");
  expect(list.stdout).toContain("via bastion.acme.example");

  const shell = await clewd(["ssh", "web-1", "--", "uptime"], env);
  expect(shell.stdout).toBe("ssh -J bastion.acme.example deploy@10.0.1.11 uptime\n");

  const all = await clewd(["ssh", "all", "--", "uptime"], env);
  expect(all.stdout).toContain("[db] ssh -o BatchMode=yes -J bastion.acme.example deploy@db-1.acme.internal uptime");

  const unknown = await clewd(["ssh", "-oProxyCommand=evil"], env);
  expect(unknown.code).toBe(1);
});
