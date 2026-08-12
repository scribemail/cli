# @scribemail/cli

Scribe ([scribe-mail.com](https://www.scribe-mail.com)) on the command line: manage your workspace's email signatures, teammates, smart fields, folders, assets, marketing campaigns, and analytics — or serve the whole tool surface to a **local AI agent over MCP**.

The CLI ships the exact same 60+ tools as the [Scribe remote MCP server](https://mcp.scribe-mail.com/mcp), generated from the same code, so the two never drift.

## Install & sign in

```bash
npm install -g @scribemail/cli
scribe login
```

`scribe login` opens your browser and signs you in with your Scribe account (WorkOS AuthKit OAuth 2.1 + PKCE — no API key to paste). Credentials are stored in `~/.config/scribe/credentials.json` (0600) and refreshed automatically.

> **Requirements:** the signed-in member must be a workspace **owner or admin**, and the workspace plan must include API access. One login is bound to one workspace — run `scribe login` again to switch.

## Use with a local agent (MCP)

```bash
claude mcp add --scope user scribe -- scribe mcp     # Claude Code
```

Claude Desktop / Cursor config:

```json
{ "mcpServers": { "scribe": { "command": "scribe", "args": ["mcp"] } } }
```

`scribe mcp` is a stdio MCP server running as you — same tools, names, and schemas as the remote server.

## Use from the shell

Every tool is also a subcommand. JSON goes to stdout, errors to stderr:

```bash
scribe whoami
scribe signatures list --limit 10
scribe signatures create --name "Sales" --draft-content @tree.json
scribe signatures publish --id <uuid>
scribe teammates list --auto-paginate
scribe analytics views --start-date 2026-07-01 --end-date 2026-08-01 --group-by signature_template
scribe docs search "dns setup"
```

- `scribe tools` — every MCP tool name and its CLI command.
- `scribe call <tool_name> --json '{...}'` — call any tool by its exact MCP name.
- Complex fields (block trees, conditions) take inline JSON, `@file`, or `-` (stdin); `--json` supplies the whole arguments object and explicit flags override it.
- Booleans: `--x` / `--no-x`; leaving both off omits the field (PATCH semantics).

**Exit codes:** `0` ok · `1` API/tool error · `2` usage error · `3` not signed in.

**Global flags:** `--api-base-url`, `--timeout-ms`, `--max-retries`, `--pretty`. The target environment (production for the published package) is baked in at build time — there is no user-facing environment switch.

## Commands

| Group                                                          | Commands                                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `signatures`                                                   | `list` `create` `update` `delete` `publish` `install` `preview` `html` `installations`          |
| `signatures variants`                                          | `list` `update` `publish` `delete`                                                              |
| `signatures recipients`                                        | `list` `add` `remove` `set-rules` `add-entities` `remove-entities`                              |
| `teammates` / `emails` / `smart-fields` / `folders` / `assets` | `list` `create` `update` `delete`                                                               |
| `campaigns`                                                    | `list` `create` `update` `delete` `preview` `schedule` `pause` `resume`                         |
| `analytics`                                                    | `views` `clicks` `events` `events-summary`                                                      |
| `visitors`                                                     | `list` `get` `breakdown`                                                                        |
| `integrations`                                                 | `list` `entities`                                                                               |
| top-level                                                      | `workspace` · `billing documents` · `content-schema` · `docs search` · `docs read` · `feedback` |
| session                                                        | `login` · `logout` · `whoami` · `mcp` · `tools` · `call`                                        |

## Headless / SSH

Login needs a browser reaching `127.0.0.1` on the machine running the CLI. Over SSH, forward the callback port and use `--no-browser`:

```bash
ssh -L 8976:127.0.0.1:8976 yourserver
scribe login --no-browser   # then open the printed URL locally
```

## Contributing

This repo builds against a sibling checkout of `scribemail/mcp-server` (the tool core is imported from `../mcp-server/src` and bundled at build time):

```bash
git clone git@github.com:scribemail/mcp-server.git
git clone git@github.com:scribemail/cli.git
cd mcp-server && pnpm install && cd ../cli && pnpm install
pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
```

The target environment is fixed at build time with no runtime override: `pnpm build` targets production (what npm users get); `pnpm build:staging` produces an internal staging build. Dev runs (`pnpm dev`, tests) resolve to production defaults — use a staging build to exercise staging.

Releases: `pnpm release` (bumps, tags `vX.Y.Z`, pushes; GitHub Actions publishes to npm via OIDC Trusted Publishing).
