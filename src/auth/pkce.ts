import { createHash, randomBytes } from "node:crypto";

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: "S256";
}

/** RFC 7636 S256 pair. The verifier is base64url of 32 random bytes (43 chars). */
export function generatePkce(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  return { verifier, challenge, method: "S256" };
}

/** CSRF token for the OAuth `state` parameter. */
export function generateState(): string {
  return randomBytes(16).toString("base64url");
}
