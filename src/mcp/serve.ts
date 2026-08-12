/**
 * `scribe mcp` — the full tool surface as a local stdio MCP server, running as
 * the logged-in user. Modeled on mcp-server/src/stdio.ts: stdout is the MCP
 * channel, all human logging goes to stderr. Wire into a local agent with:
 *
 *   claude mcp add --scope user scribe -- scribe mcp
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../../../mcp-server/src/server.js";
import { AuthRequiredError } from "../auth/errors.js";
import { envTag } from "../cli-env.js";
import type { CommandContext } from "../context.js";
import { CLI_USER_AGENT } from "../version.js";

export async function mcpAction(ctx: CommandContext): Promise<void> {
  // Preflight is advisory only: an agent may start the server before the user
  // has logged in, and every tool then returns a clear auth error.
  try {
    await ctx.tokens.getAccessToken();
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      ctx.deps.stderr(`[scribe] warning: ${err.message} — tool calls will fail auth until then.`);
    } else {
      throw err;
    }
  }

  const server = createServer({
    config: ctx.config,
    // Auto-refreshing provider: long sessions always send a current token.
    getToken: ctx.tokens.tokenProvider(),
    userAgent: `${CLI_USER_AGENT} (mcp-stdio)`,
    fetchImpl: ctx.deps.fetchImpl,
  });
  await server.connect(new StdioServerTransport());
  // The open stdin handle keeps the process alive until the client disconnects.
  ctx.deps.stderr(
    `[scribe] mcp stdio server ready${envTag(ctx.env)} (API base: ${ctx.config.apiBaseUrl})`,
  );
}
