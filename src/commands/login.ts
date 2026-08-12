import { ScribeApiError, ScribeClient } from "../../../mcp-server/src/client.js";
import { runLoginFlow } from "../auth/flow.js";
import type { StoredTokens } from "../auth/store.js";
import { envTag } from "../cli-env.js";
import type { CommandContext } from "../context.js";
import { CLI_USER_AGENT } from "../version.js";

export interface LoginOptions {
  noBrowser?: boolean;
}

export async function loginAction(ctx: CommandContext, opts: LoginOptions): Promise<void> {
  const tokens = await runLoginFlow({
    env: ctx.env,
    store: ctx.store,
    fetchImpl: ctx.deps.fetchImpl,
    openBrowser: ctx.deps.openBrowser,
    log: ctx.deps.stderr,
    noBrowser: opts.noBrowser,
  });

  // The API rejects any token that isn't bound to a workspace — catch it here
  // with a clear explanation instead of a downstream 401.
  if (!tokens.orgId) {
    ctx.deps.stderr(
      "Warning: the sign-in did not select a workspace (the token has no organization). " +
        "API calls will fail. Run `scribe login` again and pick a workspace when prompted; " +
        "if no workspace screen appears, check the WorkOS MCP Auth configuration for this environment.",
    );
    return;
  }

  await greet(ctx, tokens);
}

/** Verify the session against the API and explain the outcome in one line. */
async function greet(ctx: CommandContext, tokens: StoredTokens): Promise<void> {
  const who = tokens.email ?? tokens.userId ?? "you";
  const client = new ScribeClient({
    baseUrl: ctx.config.apiBaseUrl,
    token: tokens.accessToken,
    timeoutMs: ctx.config.timeoutMs,
    maxRetries: ctx.config.maxRetries,
    userAgent: CLI_USER_AGENT,
    fetchImpl: ctx.deps.fetchImpl,
  });

  // The token carries no role claim and the public API has no "who am I"
  // endpoint, so the greeting names only what is actually known.
  try {
    const workspace = await client.getWorkspace();
    ctx.deps.stderr(`Signed in as ${who} (workspace "${workspace.data.name}")${envTag(ctx.env)}.`);
  } catch (err) {
    if (err instanceof ScribeApiError && err.status === 403) {
      // Signed in, but the API is not usable yet — keep the tokens and say why.
      ctx.deps.stderr(`Signed in as ${who}${envTag(ctx.env)}, but the API returned:`);
      ctx.deps.stderr(`  ${err.message}`);
      if (err.remediation?.message) ctx.deps.stderr(`  ${err.remediation.message}`);
      if (err.remediation?.dashboard_url)
        ctx.deps.stderr(`  Open: ${err.remediation.dashboard_url}`);
      if (!err.remediation) {
        ctx.deps.stderr(
          "  Only workspace owners and admins can use the Scribe API — ask an owner/admin to change your role.",
        );
      }
      return;
    }
    ctx.deps.stderr(
      `Signed in as ${who}${envTag(ctx.env)}. Could not verify the workspace: ${(err as Error).message}`,
    );
  }
}
