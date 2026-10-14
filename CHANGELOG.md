# Changelog

What changed in each version of the Scribe CLI (`@scribemail/cli`). The CLI has the same tools as the [Scribe MCP server](https://help.scribe-mail.com/en/ai-agents/connect), so changes to those tools are listed here too.

## 0.2.0 — 2026-10-14

### New

- `scribe signatures duplicate`: copy a signature, with its design and its reply and internal versions, to try a change without touching the original. The copy is assigned to no one.
- `scribe signatures test-email`: send yourself a test of a signature's draft. Add `--email-id` to see it with a teammate's details.
- `scribe emails install`: install the signatures of one email address now, all of them or only the one given with `--signature-id`.
- `scribe teammates sync`: sync your teammates from your directory now instead of waiting for the daily sync.
- Teammates and email addresses now include the picture URL of image smart fields, such as the profile picture (`image_url`).

### Improvements

- Zoho Mail is now named next to Google Workspace and Microsoft 365 wherever the tools describe the supported mail providers.
- Signature content (`--draft-content`, `--content`) must use lowercase UUIDs as block ids. The CLI now checks this before calling the API and says so.
- `scribe assets create --file-base64` also accepts a `data:` URI and base64 split over several lines.
- `scribe docs search` tries again once when the help center is slow to answer.
- If you sign in with an email that has no Scribe account, the error now tells you to sign in with your Scribe login email.
- `scribe mcp` tells your agent, for each tool, whether it only reads, whether it can change or delete data, and whether it is safe to repeat.

### Bug fixes

- `scribe workspace` no longer fails for a workspace without a name.

## 0.1.1 — 2026-08-12

No change for users.

## 0.1.0 — 2026-08-12

First version: sign in with your browser, manage your workspace from the terminal with a command for each Scribe tool, and connect a local AI agent with `scribe mcp`.
