import type { EnvCredentials } from "../auth/store.js";
import { ENV_NAMES, envTag } from "../cli-env.js";
import type { CommandContext } from "../context.js";

export interface LogoutOptions {
  all?: boolean;
}

export async function logoutAction(ctx: CommandContext, opts: LogoutOptions): Promise<void> {
  const names = opts.all ? [...ENV_NAMES] : [ctx.env.name];
  let anyCleared = false;

  for (const name of names) {
    const creds = await ctx.store.getEnv(name);
    if (!creds.tokens) continue;
    anyCleared = true;
    await revokeBestEffort(ctx, creds, name);
    // Tokens go; the registration stays (reusable, and re-registering on every
    // login would pollute the AuthKit client list).
    await ctx.store.clearTokens(name);
    const label = name === "prod" ? "" : ` of ${name}`;
    ctx.deps.stderr(`Signed out${label}. Credentials removed from ${ctx.store.path}.`);
  }

  if (!anyCleared) {
    ctx.deps.stderr(
      opts.all
        ? "Not signed in to any environment — nothing to do."
        : `Not signed in${envTag(ctx.env)} — nothing to do.`,
    );
  }
}

/** RFC 7009 revocation; failures never block a local sign-out. */
async function revokeBestEffort(
  ctx: CommandContext,
  creds: EnvCredentials,
  name: string,
): Promise<void> {
  const endpoint = creds.registration?.revocationEndpoint;
  if (!endpoint || !creds.tokens || !creds.registration) return;
  try {
    const body = new URLSearchParams({
      token: creds.tokens.refreshToken,
      token_type_hint: "refresh_token",
      client_id: creds.registration.clientId,
    });
    if (creds.registration.clientSecret && creds.registration.tokenEndpointAuthMethod !== "none") {
      body.set("client_secret", creds.registration.clientSecret);
    }
    await ctx.deps.fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch {
    ctx.deps.stderr(`Note: could not revoke the ${name} session server-side (network issue).`);
  }
}
