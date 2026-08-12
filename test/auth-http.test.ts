import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchAsMetadata, normalizeDomain } from "../src/auth/discovery.js";
import { CANDIDATE_PORTS, ensureRegistration, registerClient } from "../src/auth/dcr.js";
import { exchangeCode, refreshTokens, TokenEndpointError } from "../src/auth/tokens.js";
import { CredentialStore, type ClientRegistration } from "../src/auth/store.js";
import type { CliEnv } from "../src/cli-env.js";
import { LoginFlowError } from "../src/auth/errors.js";

const ISSUER = "https://issuer.test";

const META = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oauth2/authorize`,
  token_endpoint: `${ISSUER}/oauth2/token`,
  registration_endpoint: `${ISSUER}/oauth2/register`,
  revocation_endpoint: `${ISSUER}/oauth2/revoke`,
};

const ENV: CliEnv = {
  name: "prod",
  authkitDomain: ISSUER,
  apiBaseUrl: "https://api.test",
  resourceIndicator: "https://mcp.test/mcp",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const jwt = (claims: object) =>
  `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

function registration(over: Partial<ClientRegistration> = {}): ClientRegistration {
  return {
    authkitDomain: ISSUER,
    clientId: "client_1",
    authorizationEndpoint: "https://issuer.test/oauth2/authorize",
    tokenEndpoint: META.token_endpoint,
    revocationEndpoint: META.revocation_endpoint,
    redirectUris: ["http://127.0.0.1:8976/callback"],
    tokenEndpointAuthMethod: "none",
    clientSecretExpiresAt: 0,
    registeredAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("discovery", () => {
  it("normalizes domains", () => {
    expect(normalizeDomain("issuer.test/")).toBe("https://issuer.test");
    expect(normalizeDomain("https://issuer.test//")).toBe("https://issuer.test");
  });

  it("fetches and validates metadata", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe(`${ISSUER}/.well-known/oauth-authorization-server`);
      return jsonResponse(META);
    }) as unknown as typeof fetch;
    const meta = await fetchAsMetadata(ISSUER, fetchImpl);
    expect(meta.token_endpoint).toBe(META.token_endpoint);
  });

  it("throws LoginFlowError on non-200 and on missing endpoints", async () => {
    const bad = (async () => jsonResponse({}, 500)) as unknown as typeof fetch;
    await expect(fetchAsMetadata(ISSUER, bad)).rejects.toBeInstanceOf(LoginFlowError);
    const incomplete = (async () => jsonResponse({ issuer: ISSUER })) as unknown as typeof fetch;
    await expect(fetchAsMetadata(ISSUER, incomplete)).rejects.toBeInstanceOf(LoginFlowError);
  });
});

describe("dcr", () => {
  let dir: string;
  let store: CredentialStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "scribe-dcr-"));
    store = new CredentialStore(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("registers a public client with all candidate redirect URIs", async () => {
    let sentBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ client_id: "client_new", token_endpoint_auth_method: "none" });
    }) as unknown as typeof fetch;

    const reg = await registerClient(
      META,
      CANDIDATE_PORTS.map((p) => `http://127.0.0.1:${p}/callback`),
      fetchImpl,
    );
    expect(sentBody.client_name).toBe("Scribe CLI");
    expect(sentBody.token_endpoint_auth_method).toBe("none");
    expect((sentBody.redirect_uris as string[]).length).toBe(CANDIDATE_PORTS.length);
    expect(reg.clientId).toBe("client_new");
    expect(reg.clientSecret).toBeUndefined();
    expect(reg.tokenEndpoint).toBe(META.token_endpoint);
  });

  it("ensureRegistration reuses a stored, matching registration without any network", async () => {
    await store.saveRegistration("prod", registration());
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { registration: reg } = await ensureRegistration(ENV, store, fetchImpl);
    expect(reg.clientId).toBe("client_1");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ensureRegistration re-registers when the AuthKit domain changed", async () => {
    await store.saveRegistration("prod", registration({ authkitDomain: "https://old.test" }));
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes("well-known")) return jsonResponse(META);
      return jsonResponse({ client_id: "client_fresh" });
    }) as unknown as typeof fetch;
    const { registration: reg } = await ensureRegistration(ENV, store, fetchImpl);
    expect(reg.clientId).toBe("client_fresh");
    expect((await store.getEnv("prod")).registration?.clientId).toBe("client_fresh");
  });

  it("ensureRegistration re-registers when a client secret has expired", async () => {
    await store.saveRegistration(
      "prod",
      registration({ clientSecret: "sec", clientSecretExpiresAt: 1 }),
    );
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes("well-known")) return jsonResponse(META);
      return jsonResponse({ client_id: "client_fresh" });
    }) as unknown as typeof fetch;
    const { registration: reg } = await ensureRegistration(ENV, store, fetchImpl);
    expect(reg.clientId).toBe("client_fresh");
  });
});

describe("tokens", () => {
  it("exchanges a code with PKCE and denormalizes claims", async () => {
    let sentForm = new URLSearchParams();
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      sentForm = new URLSearchParams(String(init?.body));
      return jsonResponse({
        access_token: jwt({ sub: "user_1", org_id: "org_1", role: "admin" }),
        refresh_token: "rt_1",
        expires_in: 300,
        id_token: jwt({ email: "gil@example.test" }),
      });
    }) as unknown as typeof fetch;

    const before = Date.now();
    const tokens = await exchangeCode(
      registration(),
      {
        code: "code_1",
        redirectUri: "http://127.0.0.1:8976/callback",
        codeVerifier: "ver_1",
        resource: "https://mcp.test/mcp",
      },
      fetchImpl,
    );

    expect(sentForm.get("grant_type")).toBe("authorization_code");
    expect(sentForm.get("code")).toBe("code_1");
    expect(sentForm.get("code_verifier")).toBe("ver_1");
    expect(sentForm.get("client_id")).toBe("client_1");
    expect(sentForm.get("client_secret")).toBeNull();
    expect(sentForm.get("resource")).toBe("https://mcp.test/mcp");
    expect(tokens.refreshToken).toBe("rt_1");
    expect(tokens.orgId).toBe("org_1");
    expect(tokens.role).toBe("admin");
    expect(tokens.email).toBe("gil@example.test");
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 299_000);
  });

  it("sends client_secret only for non-public registrations", async () => {
    let sentForm = new URLSearchParams();
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      sentForm = new URLSearchParams(String(init?.body));
      return jsonResponse({ access_token: jwt({}), refresh_token: "rt", expires_in: 300 });
    }) as unknown as typeof fetch;

    await refreshTokens(
      registration({ clientSecret: "sec_1", tokenEndpointAuthMethod: "client_secret_post" }),
      { accessToken: "old", refreshToken: "rt_old", expiresAt: 0 },
      { resource: "https://mcp.test/mcp", fetchImpl },
    );
    expect(sentForm.get("grant_type")).toBe("refresh_token");
    expect(sentForm.get("refresh_token")).toBe("rt_old");
    expect(sentForm.get("client_secret")).toBe("sec_1");
    expect(sentForm.get("resource")).toBe("https://mcp.test/mcp");
  });

  it("maps token-endpoint failures to TokenEndpointError with the OAuth code", async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        { error: "invalid_grant", error_description: "expired" },
        400,
      )) as unknown as typeof fetch;
    await expect(
      refreshTokens(
        registration(),
        { accessToken: "a", refreshToken: "r", expiresAt: 0 },
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ name: "TokenEndpointError", code: "invalid_grant", status: 400 });
  });

  it("keeps the previous refresh token when the response omits one", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ access_token: jwt({}), expires_in: 300 })) as unknown as typeof fetch;
    const tokens = await refreshTokens(
      registration(),
      { accessToken: "a", refreshToken: "rt_keep", expiresAt: 0 },
      { fetchImpl },
    );
    expect(tokens.refreshToken).toBe("rt_keep");
  });

  it("TokenEndpointError is exported and instanceof-able", () => {
    const err = new TokenEndpointError({ code: "x", status: 400, message: "m" });
    expect(err).toBeInstanceOf(TokenEndpointError);
  });
});
