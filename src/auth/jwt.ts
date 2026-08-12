/**
 * Unverified JWT payload decode, for displaying claims from tokens we already
 * trust (they came from our own credential store, issued to us by AuthKit).
 * Never use this to authorize anything.
 */

export interface JwtClaims {
  iss?: string;
  sub?: string;
  sid?: string;
  org_id?: string;
  role?: string;
  email?: string;
  exp?: number;
  permissions?: string[];
  [key: string]: unknown;
}

export function decodeJwtClaims(token: string): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(payload);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as JwtClaims;
  } catch {
    return null;
  }
}
