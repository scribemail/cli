/**
 * RFC 7591 Dynamic Client Registration against WorkOS AuthKit.
 *
 * Registration is anonymous and per-install per-environment; the result is
 * persisted so login reuses it. We request a PUBLIC client
 * (token_endpoint_auth_method "none" — verified supported): PKCE carries the
 * proof, and there is no secret worth storing. The fixed candidate ports are
 * all registered up front so login can bind whichever is free without
 * re-registering (AuthKit accepted loopback URIs in verification, but variable
 * RFC 8252 ports are not relied upon).
 */

import type { CliEnv } from "../cli-env.js";
import type { AsMetadata } from "./discovery.js";
import { fetchAsMetadata } from "./discovery.js";
import { LoginFlowError } from "./errors.js";
import type { ClientRegistration, CredentialStore } from "./store.js";

export const CANDIDATE_PORTS = [8976, 8977, 8978, 8979, 8980];

export function redirectUriForPort(port: number): string {
  return `http://127.0.0.1:${port}/callback`;
}

interface RegistrationResponse {
  client_id?: string;
  client_secret?: string;
  client_secret_expires_at?: number;
  redirect_uris?: string[];
  token_endpoint_auth_method?: string;
}

export async function registerClient(
  meta: AsMetadata,
  redirectUris: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<ClientRegistration> {
  if (!meta.registration_endpoint) {
    throw new LoginFlowError(
      "The sign-in service does not advertise dynamic client registration; cannot log in.",
    );
  }
  let response: Response;
  try {
    response = await fetchImpl(meta.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_name: "Scribe CLI",
        redirect_uris: redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
  } catch (err) {
    throw new LoginFlowError(`Client registration failed: ${(err as Error).message}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new LoginFlowError(
      `Client registration was rejected (HTTP ${response.status}): ${body.slice(0, 300)}`,
    );
  }
  const parsed = (await response.json()) as RegistrationResponse;
  if (!parsed.client_id) {
    throw new LoginFlowError("Client registration response did not include a client_id.");
  }
  return {
    authkitDomain: meta.issuer,
    clientId: parsed.client_id,
    clientSecret: parsed.client_secret,
    authorizationEndpoint: meta.authorization_endpoint,
    tokenEndpoint: meta.token_endpoint,
    revocationEndpoint: meta.revocation_endpoint,
    redirectUris: parsed.redirect_uris ?? redirectUris,
    tokenEndpointAuthMethod: parsed.token_endpoint_auth_method ?? "none",
    clientSecretExpiresAt: parsed.client_secret_expires_at ?? 0,
    registeredAt: new Date().toISOString(),
  };
}

function registrationUsable(reg: ClientRegistration, env: CliEnv): boolean {
  if (reg.authkitDomain !== env.authkitDomain) return false;
  if (
    reg.clientSecret &&
    reg.clientSecretExpiresAt !== 0 &&
    reg.clientSecretExpiresAt * 1000 < Date.now()
  ) {
    return false;
  }
  return reg.redirectUris.length > 0;
}

/** Reuse the stored registration when valid; otherwise discover + register + persist. */
export async function ensureRegistration(
  env: CliEnv,
  store: CredentialStore,
  fetchImpl: typeof fetch = fetch,
): Promise<{ registration: ClientRegistration; meta?: AsMetadata }> {
  const existing = (await store.getEnv(env.name)).registration;
  if (existing && registrationUsable(existing, env)) return { registration: existing };

  const meta = await fetchAsMetadata(env.authkitDomain, fetchImpl);
  const registration = await registerClient(
    meta,
    CANDIDATE_PORTS.map(redirectUriForPort),
    fetchImpl,
  );
  await store.saveRegistration(env.name, registration);
  return { registration, meta };
}
