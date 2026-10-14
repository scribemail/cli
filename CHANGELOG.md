# Changelog

All notable changes to `@scribemail/cli`. The CLI bundles the tool core of the [Scribe MCP server](https://mcp.scribe-mail.com/mcp), so a tool change there reaches the CLI with its next release.

## 0.2.0 — 2026-10-14

### Added

- `scribe signatures duplicate`: copy a signature into a new one (its design and its reply/internal variants, assigned to no one) to try a change without touching the original.
- `scribe signatures test-email`: mail yourself a test of a signature's draft. `--email-id` shows it with a teammate's values.
- `scribe emails install`: install one email's signatures now, all of them or only `--signature-id`.
- `scribe teammates sync`: resync the workspace's teammates now instead of waiting for the daily sync.
- Smart field values on teammates and emails carry `image_url` on image smart fields (the profile picture, for instance).

### Changed

- Tool descriptions name Zoho Mail next to Google Workspace and Microsoft 365.
- Block ids in a block tree (`--draft-content`, `--content`) must be lowercase UUIDs. The input schema now says so, so a wrong id fails before the API call.
- `scribe assets create --file-base64` accepts a `data:` URI, line-wrapped base64 and base64url.
- `scribe docs search` tries again once when the help center search times out.
- A sign-in with an email that has no Scribe account now says to sign in with your Scribe login email, instead of pointing at an API key.
- `scribe mcp` sets every tool's read-only, destructive and idempotent hints explicitly.
- Bundles `@modelcontextprotocol/sdk` 1.30.0.

### Fixed

- `scribe workspace` works for a workspace without a name (it failed with a schema error).
- The README's `docs search` example passes `--query`.

## 0.1.1 — 2026-08-12

First release published by CI. Same code as 0.1.0.

## 0.1.0 — 2026-08-12

First release: browser sign-in (WorkOS AuthKit), `scribe mcp` (a stdio MCP server with the same tools as the remote server), and a command for every Scribe MCP tool.
