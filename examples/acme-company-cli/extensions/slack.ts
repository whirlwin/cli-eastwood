import type { Context, Extension } from "../clewd";
import { acme, getJson, secret } from "../lib/acme";

async function slack(ctx: Context, method: string, body: Record<string, unknown>) {
  const token = secret(ctx, "SLACK_TOKEN", "a Slack user token, xoxp-...");
  const base = ctx.env.SLACK_API_URL ?? "https://slack.com/api";
  const res = await fetch(`${base}/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  // Slack answers 200 with { ok: false, error } for most failures.
  const json = await getJson(res, `Slack ${method}`);
  if (!json.ok) throw new Error(`Slack ${method}: ${json.error}`);
  return json;
}

export default {
  name: "slack",
  description: "Post to Slack and set your status",
  commands: [
    {
      name: "slack",
      description: "Talk to the Acme Slack",
      subcommands: [
        {
          name: "send",
          description: "Post a message to a channel",
          usage: "<message...> [--channel #name]",
          flags: { channel: { type: "string", short: "c", description: "Channel name or ID (default: acme.slack.defaultChannel)" } },
          async run(ctx) {
            const channel = (ctx.flags.channel as string | undefined) ?? acme(ctx).slack?.defaultChannel;
            const text = ctx.args.join(" ");
            if (!channel || !text) throw new Error('usage: clewd slack send "message" --channel #name');
            const res = await slack(ctx, "chat.postMessage", { channel, text });
            console.log(`Posted to ${channel} (ts ${res.ts})`);
          },
        },
        {
          name: "status",
          description: "Set or clear your Slack status",
          usage: "[text...] [--emoji :name:] [--clear]",
          flags: {
            emoji: { type: "string", short: "e", description: "Status emoji", default: ":speech_balloon:" },
            clear: { type: "boolean", description: "Clear your status" },
          },
          async run(ctx) {
            const clear = ctx.flags.clear === true;
            const text = clear ? "" : ctx.args.join(" ");
            if (!clear && !text) throw new Error('usage: clewd slack status "In a meeting" --emoji :calendar:');
            await slack(ctx, "users.profile.set", {
              profile: { status_text: text, status_emoji: clear ? "" : ctx.flags.emoji, status_expiration: 0 },
            });
            console.log(clear ? "Status cleared" : `Status set: ${ctx.flags.emoji} ${text}`);
          },
        },
      ],
    },
  ],
} satisfies Extension;
