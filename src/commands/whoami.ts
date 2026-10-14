import { ScribeClient } from "../../../mcp-server/src/client.js";
import { decodeJwtClaims } from "../auth/jwt.js";
import type { CommandContext } from "../context.js";
import { CLI_USER_AGENT } from "../version.js";

export interface WhoamiOptions {
  json?: boolean;
}

export async function whoamiAction(ctx: CommandContext, opts: WhoamiOptions): Promise<void> {
  // Refreshes when stale; throws AuthRequiredError when not signed in.
  const tokens = await ctx.tokens.getTokenSet();
  const claims = decodeJwtClaims(tokens.accessToken) ?? {};

  let workspace: { name?: string | null; plan?: unknown; seat_count?: number } | undefined;
  let workspaceError: string | undefined;
  try {
    const client = new ScribeClient({
      baseUrl: ctx.config.apiBaseUrl,
      token: ctx.tokens.tokenProvider(),
      timeoutMs: ctx.config.timeoutMs,
      maxRetries: ctx.config.maxRetries,
      userAgent: CLI_USER_AGENT,
      fetchImpl: ctx.deps.fetchImpl,
    });
    workspace = (await client.getWorkspace()).data;
  } catch (err) {
    workspaceError = (err as Error).message;
  }

  const expiresInS = Math.max(0, Math.round((tokens.expiresAt - Date.now()) / 1000));
  const info = {
    email: tokens.email ?? null,
    user_id: tokens.userId ?? claims.sub ?? null,
    org_id: tokens.orgId ?? claims.org_id ?? null,
    role: tokens.role ?? claims.role ?? null,
    env: ctx.env.name,
    api_base_url: ctx.config.apiBaseUrl,
    workspace: workspace ? { name: workspace.name, seat_count: workspace.seat_count } : null,
    access_token_expires_in_seconds: expiresInS,
    credentials_path: ctx.store.path,
  };

  if (opts.json) {
    ctx.deps.stdout(JSON.stringify(info, null, ctx.pretty ? 2 : 0));
    return;
  }

  ctx.deps.stdout(`Signed in as: ${info.email ?? info.user_id ?? "unknown"}`);
  // WorkOS access tokens carry no role claim today — show it only if one appears.
  if (info.role) ctx.deps.stdout(`Role:         ${info.role}`);
  ctx.deps.stdout(
    `Workspace:    ${workspace?.name ?? (workspaceError ? `(unavailable: ${workspaceError})` : "unknown")}`,
  );
  ctx.deps.stdout(`Org id:       ${info.org_id ?? "unknown"}`);
  ctx.deps.stdout(`Environment:  ${info.env} (${info.api_base_url})`);
  ctx.deps.stdout(`Token:        expires in ${expiresInS}s`);
  ctx.deps.stdout(`Credentials:  ${info.credentials_path}`);
}
