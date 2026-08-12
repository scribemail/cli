/**
 * Environment registry: which AuthKit domain issues tokens and which API origin
 * they are spent against. Mirrors mcp-server/wrangler.jsonc — keep in sync.
 */

export type ScribeEnvName = "prod" | "staging" | "dev";

export interface CliEnv {
  name: ScribeEnvName;
  /** WorkOS AuthKit domain: OAuth issuer, authorize/token/register endpoints. */
  authkitDomain: string;
  /** Default Scribe public-API origin (overridable via SCRIBE_API_BASE_URL / --api-base-url). */
  apiBaseUrl: string;
  /**
   * RFC 8707 resource indicator, sent on the authorize + token requests. This
   * is load-bearing: it selects AuthKit's MCP-auth flow, which adds the org
   * picker and mints an org-bound JWT (`org_id` claim). Without it AuthKit
   * issues a plain session token with NO org_id — and the Scribe API rejects
   * those. Must match the "MCP resource indicator" registered per WorkOS env.
   */
  resourceIndicator: string;
}

const ENVS: Record<ScribeEnvName, CliEnv> = {
  prod: {
    name: "prod",
    authkitDomain: "https://rational-purity-21.authkit.app",
    apiBaseUrl: "https://api.scribe-mail.com",
    resourceIndicator: "https://mcp.scribe-mail.com/mcp",
  },
  staging: {
    name: "staging",
    authkitDomain: "https://fortunate-serenity-56-staging.authkit.app",
    apiBaseUrl: "https://api.scribe-mail-staging.com",
    resourceIndicator: "https://mcp.scribe-mail-staging.com/mcp",
  },
  dev: {
    name: "dev",
    authkitDomain: "https://decent-poem-09-development.authkit.app",
    apiBaseUrl: "http://api.lvh.me:3000",
    resourceIndicator: "http://localhost:8787/mcp",
  },
};

export const ENV_NAMES = Object.keys(ENVS) as ScribeEnvName[];

/**
 * The environment is fixed at BUILD time (tsup `define`; `pnpm build` → prod,
 * `pnpm build:staging` → staging) and there is NO runtime switch — a published
 * production binary cannot be pointed at staging. Dev runs (tsx/vitest, no
 * define) resolve to prod; use a staging build to exercise staging.
 */
declare const __SCRIBE_DEFAULT_ENV__: string | undefined;

export const BUILT_ENV_NAME: string =
  typeof __SCRIBE_DEFAULT_ENV__ !== "undefined" ? __SCRIBE_DEFAULT_ENV__ : "prod";

/**
 * Suffix naming the environment in user-facing messages — empty on production
 * builds (the published CLI has exactly one environment, naming it is noise);
 * internal staging/dev builds keep it so output is unambiguous.
 */
export function envTag(env: CliEnv): string {
  return env.name === "prod" ? "" : ` (env: ${env.name})`;
}

/** The one environment this binary was built for; throws on a bad build define. */
export function resolveEnv(): CliEnv {
  const raw = BUILT_ENV_NAME.trim().toLowerCase();
  const env = ENVS[raw as ScribeEnvName];
  if (!env) {
    throw new Error(
      `This binary was built with an unknown environment "${raw}" ` +
        `(expected one of: ${ENV_NAMES.join(", ")}) — rebuild with a valid SCRIBE_BUILD_ENV.`,
    );
  }
  return env;
}
