import { LoginFlowError } from "./errors.js";

/** RFC 8414 authorization-server metadata (the subset the CLI uses). */
export interface AsMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  device_authorization_endpoint?: string;
  code_challenge_methods_supported?: string[];
}

/** Normalize an AuthKit domain into a bare origin (mirrors mcp-server/src/oauth.ts). */
export function normalizeDomain(raw: string): string {
  const value = raw.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export async function fetchAsMetadata(
  authkitDomain: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AsMetadata> {
  const url = `${normalizeDomain(authkitDomain)}/.well-known/oauth-authorization-server`;
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    throw new LoginFlowError(
      `Could not reach the sign-in service (${url}): ${(err as Error).message}`,
    );
  }
  if (!response.ok) {
    throw new LoginFlowError(`Sign-in service discovery failed: HTTP ${response.status} at ${url}`);
  }
  let meta: Partial<AsMetadata>;
  try {
    meta = (await response.json()) as Partial<AsMetadata>;
  } catch {
    throw new LoginFlowError(`Sign-in service discovery returned invalid JSON (${url}).`);
  }
  if (!meta.issuer || !meta.authorization_endpoint || !meta.token_endpoint) {
    throw new LoginFlowError(`Sign-in service metadata is missing required endpoints (${url}).`);
  }
  return meta as AsMetadata;
}
