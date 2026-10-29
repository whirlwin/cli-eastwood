# Acme company CLI

A complete `~/.config/cli-eastwood/` for a made-up company, Acme, showing
how a team can turn clewd into its own internal CLI. Needs clewd 0.1.3 or
later.

```
acme-company-cli/
├── config.ts            Acme settings: Slack channel, Jira site, SSH hosts
├── lib/acme.ts          shared helpers (outside extensions/, so not loaded as one)
└── extensions/
    ├── slack.ts         clewd slack send | status
    ├── jira.ts          clewd jira mine | show | open | create
    └── ssh.ts           clewd ssh <host> | list | all
```

## Try it

Point clewd at a scratch config dir so your own setup stays untouched:

```sh
export XDG_CONFIG_HOME="$(mktemp -d)"
cp -R examples/acme-company-cli "$XDG_CONFIG_HOME/cli-eastwood"
clewd ext doctor
clewd --help
```

To make it your real setup, copy it to `~/.config/cli-eastwood/` instead.
That replaces an existing `config.ts` and any extensions with the same
file names, so merge by hand if you already have some.

## Commands

| Command | |
| --- | --- |
| `clewd slack send "deploy done" [-c #channel]` | Post a message (default channel from config) |
| `clewd slack status "Lunch" [-e :pizza:] [--clear]` | Set or clear your Slack status |
| `clewd jira mine [-n 20]` | Open issues assigned to you |
| `clewd jira show OPS-123` | Summary, status, assignee and link |
| `clewd jira open OPS-123` | Open it in the browser |
| `clewd jira create "Fix the thing" [-p OPS] [-t Bug]` | Create an issue |
| `clewd ssh list` | Known hosts |
| `clewd ssh web-1` | Interactive shell, through the bastion |
| `clewd ssh web-1 -- uptime` | Run one command |
| `clewd ssh all -- uptime` | Run a command on every host in parallel |

## Secrets

Tokens come from the environment, never from `config.ts`, so the config can
be committed and shared across the team:

| Variable | |
| --- | --- |
| `SLACK_TOKEN` | Slack user token (`xoxp-...`) with `chat:write` and `users.profile:write` |
| `JIRA_EMAIL` | The email you sign in to Jira with |
| `JIRA_TOKEN` | API token from https://id.atlassian.com/manage-profile/security/api-tokens |

Load them from your password manager or secret store, for example in your
shell profile: `export JIRA_TOKEN="$(op read op://work/jira/token)"`.

## Patterns worth copying

- **Settings in `config.ts`, read through one typed helper.** `lib/acme.ts`
  defines `AcmeConfig` and `acme(ctx)`, so every extension gets the same typed
  view of `ctx.config.acme`.
- **Validate anything that ends up in a URL or a command line.** Jira issue
  keys must look like `OPS-123`, and `ssh` only connects to host names that are
  in the config, so a stray argument can't add ssh options.
- **`ctx.exec` for interactive programs, `ctx.$` for captured output.**
  `clewd ssh web-1` hands the terminal to ssh; `clewd ssh all` captures output
  from every host and prefixes each line with the host name.
- **Exit codes mean something.** `ssh all` returns 1 if any host failed, so it
  works in scripts.

`src/examples.test.ts` installs this directory into a temp config and runs
every command against fake Slack and Jira servers and a fake `ssh`.
