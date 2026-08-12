import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientRegistration, StoredTokens } from "../src/auth/store.js";
import { CredentialStore } from "../src/auth/store.js";

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

const TOKENS: StoredTokens = {
  accessToken: "at_1",
  refreshToken: "rt_1",
  expiresAt: 1786500000000,
  orgId: "org_1",
  email: "user@example.test",
};

describe("CredentialStore", () => {
  let dir: string;
  let store: CredentialStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "scribe-store-"));
    store = new CredentialStore(join(dir, "scribe"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("round-trips registrations and tokens across environments", async () => {
    await store.saveRegistration("prod", REG);
    await store.saveTokens("prod", TOKENS);
    await store.saveTokens("staging", { ...TOKENS, accessToken: "at_staging" });

    expect((await store.getEnv("prod")).registration?.clientId).toBe("client_1");
    expect((await store.getEnv("prod")).tokens?.accessToken).toBe("at_1");
    expect((await store.getEnv("staging")).tokens?.accessToken).toBe("at_staging");
    expect((await store.getEnv("staging")).registration).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")("writes file 0600 and dir 0700", async () => {
    await store.saveTokens("prod", TOKENS);
    expect(statSync(store.path).mode & 0o777).toBe(0o600);
    expect(statSync(store.dir).mode & 0o777).toBe(0o700);
  });

  it.skipIf(process.platform === "win32")("tightens loose permissions on load", async () => {
    await store.saveTokens("prod", TOKENS);
    const { chmodSync } = await import("node:fs");
    chmodSync(store.path, 0o644);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await store.load();
    expect(statSync(store.path).mode & 0o777).toBe(0o600);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("tightening to 600"));
  });

  it("clearTokens keeps the registration; clearRegistration keeps tokens", async () => {
    await store.saveRegistration("prod", REG);
    await store.saveTokens("prod", TOKENS);
    await store.clearTokens("prod");
    expect((await store.getEnv("prod")).registration?.clientId).toBe("client_1");
    expect((await store.getEnv("prod")).tokens).toBeUndefined();

    await store.saveTokens("prod", TOKENS);
    await store.clearRegistration("prod");
    expect((await store.getEnv("prod")).registration).toBeUndefined();
    expect((await store.getEnv("prod")).tokens?.accessToken).toBe("at_1");
  });

  it("backs up a corrupt file instead of silently wiping it", async () => {
    await store.saveTokens("prod", TOKENS);
    writeFileSync(store.path, "{not json");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const loaded = await store.load();
    expect(loaded.environments).toEqual({});
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("credentials file was unreadable"));
    // The evidence file exists and holds the corrupt payload.
    const backups = errSpy.mock.calls[0][0] as string;
    const backupPath = backups.slice(backups.indexOf("moved to ") + "moved to ".length);
    expect(readFileSync(backupPath, "utf8")).toBe("{not json");
  });

  it("withLock serializes concurrent mutations", async () => {
    const order: string[] = [];
    await Promise.all([
      store.withLock(async () => {
        order.push("a-start");
        await new Promise((r) => setTimeout(r, 50));
        order.push("a-end");
      }),
      store.withLock(async () => {
        order.push("b-start");
        order.push("b-end");
      }),
    ]);
    // Whichever ran first fully completed before the other started.
    expect(order.slice(0, 2)).toEqual([order[0], `${order[0].split("-")[0]}-end`]);
  });

  it("withLock breaks a stale lock and releases on error", async () => {
    await store.saveTokens("prod", TOKENS); // ensures dir exists
    const lockPath = `${store.path}.lock`;
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, at: Date.now() - 60_000 }));
    const { utimesSync } = await import("node:fs");
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath, old, old);

    await expect(
      store.withLock(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Lock was released despite the error.
    await store.withLock(async () => {});
  });
});
