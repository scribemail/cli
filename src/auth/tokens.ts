/**
 * Token endpoint calls: authorization-code exchange and refresh.
 *
 * Scope is requested at the AUTHORIZE step only, and must be exactly
 * `openid profile email offline_access` — adding Scribe permission slugs makes
 * AuthKit fail the handshake with invalid_scope (see mcp-server/src/oauth.ts).
 * `offline_access` is load-bearing: without it no refresh token is issued.
 */

import { decodeJwtClaims } from "./jwt.js";
import type { ClientRegistration, StoredTokens } from "./store.js";

export const OAUTH_SCOPES = "openid profile email offline_access";

/** Typed failure from the token endpoint ({error, error_description} body). */
export class TokenEndpointError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(args: { code: string; status: number; message: string }) {
    super(args.message);
    this.name = "TokenEndpointError";
    this.code = args.code;
    this.status = args.status;
  }
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
}

async function postForm(
  registration: ClientRegistration,
  form: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  const body = new URLSearchParams({ ...form, client_id: registration.clientId });
  // Public client normally; honor a secret-bearing registration if one exists.
  if (registration.clientSecret && registration.tokenEndpointAuthMethod !== "none") {
    body.set("client_secret", registration.clientSecret);
  }
  let response: Response;
  try {
    response = await fetchImpl(registration.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
  } catch (err) {
    throw new TokenEndpointError({
      code: "network_error",
      status: 0,
      message: `Could not reach the token endpoint: ${(err as Error).message}`,
    });
  }
  let parsed: TokenResponse & { error?: string; error_description?: string };
  try {
    parsed = (await response.json()) as typeof parsed;
  } catch {
    parsed = {};
  }
  if (!response.ok || !parsed.access_token) {
    throw new TokenEndpointError({
      code: parsed.error ?? "invalid_response",
      status: response.status,
      message: parsed.error_description ?? `Token request failed (HTTP ${response.status}).`,
    });
  }
  return parsed;
}

function toStoredTokens(parsed: TokenResponse, previousRefreshToken?: string): StoredTokens {
  const accessToken = parsed.access_token as string;
  const claims = decodeJwtClaims(accessToken) ?? {};
  const idClaims = parsed.id_token ? (decodeJwtClaims(parsed.id_token) ?? {}) : {};
  return {
    accessToken,
    // WorkOS rotates refresh tokens on every refresh; fall back only if absent.
    refreshToken: parsed.refresh_token ?? previousRefreshToken ?? "",
    expiresAt: Date.now() + (parsed.expires_in ?? 300) * 1000,
    orgId: typeof claims.org_id === "string" ? claims.org_id : undefined,
    userId: typeof claims.sub === "string" ? claims.sub : undefined,
    role: typeof claims.role === "string" ? claims.role : undefined,
    email:
      typeof idClaims.email === "string"
        ? idClaims.email
        : typeof claims.email === "string"
          ? claims.email
          : undefined,
  };
}

export async function exchangeCode(
  registration: ClientRegistration,
  args: { code: string; redirectUri: string; codeVerifier: string; resource?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<StoredTokens> {
  const form: Record<string, string> = {
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.codeVerifier,
  };
  if (args.resource) form.resource = args.resource;
  const parsed = await postForm(registration, form, fetchImpl);
  return toStoredTokens(parsed);
}

export async function refreshTokens(
  registration: ClientRegistration,
  current: StoredTokens,
  opts: { resource?: string; fetchImpl?: typeof fetch } = {},
): Promise<StoredTokens> {
  const form: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: current.refreshToken,
  };
  // Keep the refreshed token bound to the same resource (org-bound JWT).
  if (opts.resource) form.resource = opts.resource;
  const parsed = await postForm(registration, form, opts.fetchImpl ?? fetch);
  return toStoredTokens(parsed, current.refreshToken);
}
