import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { generatePkce, generateState } from "../src/auth/pkce.js";
import { decodeJwtClaims } from "../src/auth/jwt.js";

const BASE64URL = /^[A-Za-z0-9_-]+$/;

describe("pkce", () => {
  it("generates a 43-char base64url verifier and its S256 challenge", () => {
    const { verifier, challenge, method } = generatePkce();
    expect(method).toBe("S256");
    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(BASE64URL);
    expect(challenge).toMatch(BASE64URL);
    const expected = createHash("sha256").update(verifier, "ascii").digest("base64url");
    expect(challenge).toBe(expected);
  });

  it("matches the RFC 7636 appendix B test vector", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    const digest = createHash("sha256").update(verifier, "ascii").digest("base64url");
    expect(digest).toBe(expected);
  });

  it("generates unique url-safe state values", () => {
    const a = generateState();
    const b = generateState();
    expect(a).toMatch(BASE64URL);
    expect(a).not.toBe(b);
  });
});

describe("jwt decode", () => {
  const payload = (claims: object) =>
    `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

  it("decodes payload claims without verification", () => {
    const claims = decodeJwtClaims(payload({ sub: "user_1", org_id: "org_1", role: "admin" }));
    expect(claims).toMatchObject({ sub: "user_1", org_id: "org_1", role: "admin" });
  });

  it("returns null for malformed tokens", () => {
    expect(decodeJwtClaims("not-a-jwt")).toBeNull();
    expect(decodeJwtClaims("a.b")).toBeNull();
    expect(decodeJwtClaims("a.###.c")).toBeNull();
    expect(decodeJwtClaims(`a.${Buffer.from("[1]").toString("base64url")}.c`)).toBeNull();
  });
});
