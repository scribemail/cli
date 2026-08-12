/**
 * Interactive login orchestration: DCR (reused when possible) → PKCE + state →
 * loopback receiver → system browser → code exchange → persisted tokens.
 */

import type { CliEnv } from "../cli-env.js";
import { ensureRegistration } from "./dcr.js";
import { LoginFlowError } from "./errors.js";
import { startLoopback } from "./loopback.js";
import { generatePkce, generateState } from "./pkce.js";
import type { CredentialStore, StoredTokens } from "./store.js";
import { exchangeCode, OAUTH_SCOPES } from "./tokens.js";

export interface LoginFlowDeps {
  env: CliEnv;
  store: CredentialStore;
  fetchImpl?: typeof fetch;
  /** Returns false when no browser could be opened (the URL is always printed). */
  openBrowser: (url: string) => boolean;
  /** Human-facing progress goes to stderr; stdout stays clean for data. */
  log: (line: string) => void;
  noBrowser?: boolean;
  timeoutMs?: number;
}

function portsFromRedirectUris(uris: string[]): number[] {
  const ports: number[] = [];
  for (const uri of uris) {
    try {
      const url = new URL(uri);
      if (url.hostname === "127.0.0.1" && url.pathname === "/callback") {
        ports.push(Number(url.port));
      }
    } catch {
      // Skip malformed entries.
    }
  }
  return ports;
}

export async function runLoginFlow(deps: LoginFlowDeps): Promise<StoredTokens> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const { registration } = await ensureRegistration(deps.env, deps.store, fetchImpl);

  const candidatePorts = portsFromRedirectUris(registration.redirectUris);
  if (candidatePorts.length === 0) {
    throw new LoginFlowError(
      "The stored client registration has no loopback redirect — delete " +
        `${deps.store.path} and run scribe login again.`,
    );
  }

  const pkce = generatePkce();
  const state = generateState();
  const loopback = await startLoopback({
    candidatePorts,
    expectedState: state,
    timeoutMs: deps.timeoutMs,
  });

  const authorizeUrl = new URL(registration.authorizationEndpoint);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", registration.clientId);
  authorizeUrl.searchParams.set("redirect_uri", loopback.redirectUri);
  authorizeUrl.searchParams.set("scope", OAUTH_SCOPES);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", pkce.challenge);
  authorizeUrl.searchParams.set("code_challenge_method", pkce.method);
  // RFC 8707 — selects AuthKit's MCP-auth flow (org picker + org-bound JWT).
  authorizeUrl.searchParams.set("resource", deps.env.resourceIndicator);
  // Force a full interactive sign-in: a silently reused authkit.app session
  // skips the organization-selection step and yields a token with NO org_id,
  // which the Scribe API rejects.
  authorizeUrl.searchParams.set("prompt", "login");

  deps.log("Opening your browser to sign in to Scribe…");
  deps.log(`If it does not open, visit: ${authorizeUrl.toString()}`);
  if (!deps.noBrowser) deps.openBrowser(authorizeUrl.toString());

  try {
    const { code } = await loopback.waitForCallback();
    const tokens = await exchangeCode(
      registration,
      {
        code,
        redirectUri: loopback.redirectUri,
        codeVerifier: pkce.verifier,
        resource: deps.env.resourceIndicator,
      },
      fetchImpl,
    );
    await deps.store.saveTokens(deps.env.name, tokens);
    return tokens;
  } finally {
    loopback.close();
  }
}
