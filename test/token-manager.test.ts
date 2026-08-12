import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialStore, type ClientRegistration, type StoredTokens } from "../src/auth/store.js";
import { TokenManager } from "../src/auth/token-manager.js";
import { AuthRequiredError } from "../src/auth/errors.js";
import type { CliEnv } from "../src/cli-env.js";

const ENV: CliEnv = {
  name: "prod",
  authkitDomain: "https://issuer.test",
  apiBaseUrl: "https://api.test",
  resourceIndicator: "https://mcp.test/mcp",
};

const REG: ClientRegistration = {
  authkitDomain: "https://issuer.test",
  clientId: "client_1",
  authorizationEndpoint: "https://issuer.test/oauth2/authorize",
  tokenEndpoint: "https://issuer.test/oauth2/token",
  redirectUris: ["http://127.0.0.1:8976/callback"],
  tokenEndpointAuthMethod: "none",
  clientSecretExpiresAt: 0,
  registeredAt: "2026-01-01T00:00:00Z",
};

const jwt = (claims: object) =>
  `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function tokens(over: Partial<StoredTokens> = {}): StoredTokens {
  return {
    accessToken: "at_fresh",
    refreshToken: "rt_1",
    expiresAt: Date.now() + 10 * 60_000,
    ...over,
  };
}

describe("TokenManager", () => {
  let dir: string;
  let store: CredentialStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "scribe-tm-"));
    store = new CredentialStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns a fresh token without any network call", async () => {
    await store.saveTokens("prod", tokens());
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const tm = new TokenManager(ENV, store, fetchImpl);
    expect(await tm.getAccessToken()).toBe("at_fresh");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws AuthRequiredError when never signed in", async () => {
    const tm = new TokenManager(ENV, store, vi.fn() as unknown as typeof fetch);
    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(tm.getAccessToken()).rejects.toThrow(/scribe login/);
  });

  it("refreshes an expiring token and persists the rotation before resolving", async () => {
    await store.saveRegistration("prod", REG);
    await store.saveTokens("prod", tokens({ expiresAt: Date.now() + 10_000 })); // inside 60s skew

    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("grant_type")).toBe("refresh_token");
      expect(form.get("refresh_token")).toBe("rt_1");
      return jsonResponse({
        access_token: jwt({ org_id: "org_1" }),
        refresh_token: "rt_2",
        expires_in: 300,
      });
    }) as unknown as typeof fetch;

    const tm = new TokenManager(ENV, store, fetchImpl);
    const token = await tm.getAccessToken();
    expect(token).toBe(jwt({ org_id: "org_1" }));
    expect((await store.getEnv("prod")).tokens?.refreshToken).toBe("rt_2");
  });

  it("single-flights concurrent refreshes in process (one network call)", async () => {
    await store.saveRegistration("prod", REG);
    await store.saveTokens("prod", tokens({ expiresAt: Date.now() - 1 }));

    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: jwt({}), refresh_token: "rt_2", expires_in: 300 }),
    ) as unknown as typeof fetch;

    const tm = new TokenManager(ENV, store, fetchImpl);
    const [a, b, c] = await Promise.all([
      tm.getAccessToken(),
      tm.getAccessToken(),
      tm.getAccessToken(),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("re-reads under the lock: a token refreshed by another process is used as-is", async () => {
    await store.saveRegistration("prod", REG);
    await store.saveTokens("prod", tokens({ expiresAt: Date.now() - 1 }));

    // Simulate the other process: by the time we hold the lock, the store has
    // fresh tokens. Monkey-patch withLock to interleave the write.
    const realWithLock = store.withLock.bind(store);
    vi.spyOn(store, "withLock").mockImplementation(async (fn) => {
      await store.saveTokens("prod", tokens({ accessToken: "at_other", refreshToken: "rt_other" }));
      return realWithLock(fn);
    });

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const tm = new TokenManager(ENV, store, fetchImpl);
    expect(await tm.getAccessToken()).toBe("at_other");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("invalid_grant clears tokens (keeps registration) and reports session expiry", async () => {
    await store.saveRegistration("prod", REG);
    await store.saveTokens("prod", tokens({ expiresAt: 0 }));

    const fetchImpl = (async () =>
      jsonResponse({ error: "invalid_grant" }, 400)) as unknown as typeof fetch;
    const tm = new TokenManager(ENV, store, fetchImpl);

    await expect(tm.getAccessToken()).rejects.toThrow(/session has expired/);
    expect((await store.getEnv("prod")).tokens).toBeUndefined();
    expect((await store.getEnv("prod")).registration?.clientId).toBe("client_1");
  });

  it("invalid_client clears the registration too", async () => {
    await store.saveRegistration("prod", REG);
    await store.saveTokens("prod", tokens({ expiresAt: 0 }));

    const fetchImpl = (async () =>
      jsonResponse({ error: "invalid_client" }, 401)) as unknown as typeof fetch;
    const tm = new TokenManager(ENV, store, fetchImpl);

    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(AuthRequiredError);
    expect((await store.getEnv("prod")).registration).toBeUndefined();
  });

  it("tokenProvider() maps AuthRequiredError to null for the client's 401 path", async () => {
    const tm = new TokenManager(ENV, store, vi.fn() as unknown as typeof fetch);
    expect(await tm.tokenProvider()()).toBeNull();

    await store.saveTokens("prod", tokens());
    expect(await tm.tokenProvider()()).toBe("at_fresh");
  });
});
