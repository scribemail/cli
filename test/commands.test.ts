import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExitWithCode } from "../src/generate/runner.js";
import {
  FRESH_TOKENS,
  fullSignature,
  harness,
  jsonResponse,
  run,
  signaturePage,
} from "./helpers.js";

const jwt = (claims: object) =>
  `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

describe("generated commands end-to-end", () => {
  it("signatures list sends the right request and prints structured JSON", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers) });
      return jsonResponse(signaturePage);
    }) as unknown as typeof fetch;

    const h = await harness(fetchImpl);
    await h.store.saveTokens("prod", FRESH_TOKENS);

    const result = await run(h, ["signatures", "list", "--limit", "2"]);
    expect(result).toBeUndefined();

    const apiCall = calls.find((c) => c.url.includes("/v1/signatures"));
    expect(apiCall).toBeDefined();
    const url = new URL(apiCall!.url);
    expect(url.searchParams.get("limit")).toBe("2");
    expect(apiCall!.headers.get("Authorization")).toBe("Bearer at_test");
    expect(apiCall!.headers.get("User-Agent")).toMatch(/^scribe-cli\//);

    const parsed = JSON.parse(h.out.at(-1)!) as { data: unknown[]; pagination: unknown };
    expect(parsed.data).toHaveLength(1);
    expect(parsed.pagination).toBeDefined();
  });

  it("create accepts --draft-content @file and flags override --json", async () => {
    let sentBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("/v1/signatures")) {
        sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ data: fullSignature });
      }
      return jsonResponse({});
    }) as unknown as typeof fetch;

    const h = await harness(fetchImpl);
    await h.store.saveTokens("prod", FRESH_TOKENS);

    const dir = mkdtempSync(join(tmpdir(), "scribe-cmd-"));
    const treePath = join(dir, "tree.json");
    // Minimal block tree that satisfies the content input schema.
    const tree = {
      id: "root",
      type: "stack",
      role: null,
      visible: true,
      blockStyle: {},
      children: [],
    };
    writeFileSync(treePath, JSON.stringify(tree));

    const result = await run(h, [
      "signatures",
      "create",
      "--json",
      '{"name":"from json"}',
      "--name",
      "CLI wins",
      "--draft-content",
      `@${treePath}`,
    ]);
    expect(result).toBeUndefined();
    // The API client nests the payload under its resource key.
    const payload = sentBody.signature as Record<string, unknown>;
    expect(payload.name).toBe("CLI wins");
    expect(payload.draft_content).toMatchObject({ id: "root", type: "stack" });
  });

  it("scribe call reaches a tool by MCP name", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) =>
      String(url).includes("/v1/workspace")
        ? jsonResponse({
            data: {
              id: "ws-1",
              name: "GVA",
              plan: {
                tier: "business",
                kind: "paid",
                status: "active",
                billing_interval: "yearly",
                cancel_at_period_end: false,
                started_at: null,
                ends_at: null,
              },
              seat_count: 3,
              event_tracking: { id: "ET-1", enabled: true },
            },
          })
        : jsonResponse({}),
    ) as unknown as typeof fetch;

    const h = await harness(fetchImpl);
    await h.store.saveTokens("prod", FRESH_TOKENS);

    const result = await run(h, ["call", "get_workspace"]);
    expect(result).toBeUndefined();
    const parsed = JSON.parse(h.out.at(-1)!) as { data: { name: string } };
    expect(parsed.data.name).toBe("GVA");
  });

  it("--api-base-url beats the environment default", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      urls.push(String(url));
      return jsonResponse(signaturePage);
    }) as unknown as typeof fetch;

    const h = await harness(fetchImpl);
    await h.store.saveTokens("prod", FRESH_TOKENS);
    await run(h, ["--api-base-url", "https://api.override.test", "signatures", "list"]);
    expect(urls.some((u) => u.startsWith("https://api.override.test/v1/signatures"))).toBe(true);
  });

  it("whoami --json refreshes claims and reports the workspace", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) =>
      String(url).includes("/v1/workspace")
        ? jsonResponse({
            data: {
              id: "ws-1",
              name: "GVA",
              plan: {
                tier: "business",
                kind: "paid",
                status: "active",
                billing_interval: "yearly",
                cancel_at_period_end: false,
                started_at: null,
                ends_at: null,
              },
              seat_count: 3,
              event_tracking: { id: "ET-1", enabled: true },
            },
          })
        : jsonResponse({}),
    ) as unknown as typeof fetch;

    const h = await harness(fetchImpl);
    await h.store.saveTokens("prod", FRESH_TOKENS);

    await run(h, ["whoami", "--json"]);
    const info = JSON.parse(h.out.at(-1)!) as Record<string, unknown>;
    expect(info.email).toBe("gil@example.test");
    expect(info.role).toBe("admin");
    expect((info.workspace as { name: string }).name).toBe("GVA");
    expect(info.env).toBe("prod");
  });

  it("tools lists the cross-reference including call-only aliases", async () => {
    const h = await harness(vi.fn() as unknown as typeof fetch);
    await run(h, ["tools"]);
    const text = h.out.join("\n");
    expect(text).toContain("list_signatures");
    expect(text).toContain("scribe signatures list");
    expect(text).toContain("get_analytics_overview");
    expect(text).toContain("scribe call");
  });
});

describe("login end-to-end (stubbed AuthKit + real loopback)", () => {
  it("registers, opens the browser, exchanges the code, stores tokens, greets", async () => {
    const ISSUER = "https://rational-purity-21.authkit.app";
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("oauth-authorization-server")) {
        return jsonResponse({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/oauth2/authorize`,
          token_endpoint: `${ISSUER}/oauth2/token`,
          registration_endpoint: `${ISSUER}/oauth2/register`,
          revocation_endpoint: `${ISSUER}/oauth2/revoke`,
        });
      }
      if (u.endsWith("/oauth2/register")) {
        const body = JSON.parse(String(init?.body)) as { redirect_uris: string[] };
        return jsonResponse({
          client_id: "client_e2e",
          redirect_uris: body.redirect_uris,
          token_endpoint_auth_method: "none",
        });
      }
      if (u.endsWith("/oauth2/token")) {
        const form = new URLSearchParams(String(init?.body));
        expect(form.get("grant_type")).toBe("authorization_code");
        expect(form.get("code")).toBe("code_e2e");
        expect(form.get("code_verifier")).toBeTruthy();
        expect(form.get("resource")).toBe("https://mcp.scribe-mail.com/mcp");
        return jsonResponse({
          access_token: jwt({ sub: "user_1", org_id: "org_1", role: "admin" }),
          refresh_token: "rt_e2e",
          expires_in: 300,
          id_token: jwt({ email: "gil@example.test" }),
        });
      }
      if (u.includes("/v1/workspace")) {
        return jsonResponse({
          data: {
            id: "ws-1",
            name: "GVA Consulting",
            plan: {
              tier: "business",
              kind: "paid",
              status: "active",
              billing_interval: "yearly",
              cancel_at_period_end: false,
              started_at: null,
              ends_at: null,
            },
            seat_count: 3,
            event_tracking: { id: "ET-1", enabled: true },
          },
        });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    }) as unknown as typeof fetch;

    const h = await harness(fetchImpl);
    // "Browser": parse the authorize URL, then hit the loopback redirect with
    // the state it carries — exactly what AuthKit does after sign-in.
    h.deps.openBrowser = (authorizeUrl) => {
      const parsed = new URL(authorizeUrl);
      expect(parsed.origin).toBe(ISSUER);
      expect(parsed.searchParams.get("scope")).toBe("openid profile email offline_access");
      expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
      expect(parsed.searchParams.get("resource")).toBe("https://mcp.scribe-mail.com/mcp");
      expect(parsed.searchParams.get("prompt")).toBe("login");
      const redirect = parsed.searchParams.get("redirect_uri")!;
      const state = parsed.searchParams.get("state")!;
      void fetch(`${redirect}?code=code_e2e&state=${encodeURIComponent(state)}`);
      return true;
    };

    const result = await run(h, ["login"]);
    expect(result).toBeUndefined();

    const stored = await h.store.getEnv("prod");
    expect(stored.registration?.clientId).toBe("client_e2e");
    expect(stored.tokens?.refreshToken).toBe("rt_e2e");
    expect(stored.tokens?.email).toBe("gil@example.test");
    expect(h.err.join("\n")).toContain('workspace "GVA Consulting"');
  });

  it("warns clearly when the token has no organization instead of a confusing 401", async () => {
    const ISSUER = "https://rational-purity-21.authkit.app";
    const workspaceCalls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("oauth-authorization-server")) {
        return jsonResponse({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/oauth2/authorize`,
          token_endpoint: `${ISSUER}/oauth2/token`,
          registration_endpoint: `${ISSUER}/oauth2/register`,
        });
      }
      if (u.endsWith("/oauth2/register")) {
        const body = JSON.parse(String(init?.body)) as { redirect_uris: string[] };
        return jsonResponse({
          client_id: "client_noorg",
          redirect_uris: body.redirect_uris,
          token_endpoint_auth_method: "none",
        });
      }
      if (u.endsWith("/oauth2/token")) {
        // An org-less session token: sub/sid but NO org_id claim.
        return jsonResponse({
          access_token: jwt({ sub: "user_1", sid: "sess_1" }),
          refresh_token: "rt_noorg",
          expires_in: 300,
        });
      }
      if (u.includes("/v1/workspace")) workspaceCalls.push(u);
      return jsonResponse({});
    }) as unknown as typeof fetch;

    const h = await harness(fetchImpl);
    h.deps.openBrowser = (authorizeUrl) => {
      const parsed = new URL(authorizeUrl);
      const redirect = parsed.searchParams.get("redirect_uri")!;
      const state = parsed.searchParams.get("state")!;
      void fetch(`${redirect}?code=code_x&state=${encodeURIComponent(state)}`);
      return true;
    };

    const result = await run(h, ["login"]);
    expect(result).toBeUndefined();
    expect(h.err.join("\n")).toContain("did not select a workspace");
    // No point hitting the API with a token we know it will reject.
    expect(workspaceCalls).toEqual([]);
  });
});

describe("logout", () => {
  it("revokes best-effort, clears tokens, keeps the registration", async () => {
    const revoked: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith("/oauth2/revoke")) {
        revoked.push(String(init?.body));
        return new Response(null, { status: 200 });
      }
      return jsonResponse({});
    }) as unknown as typeof fetch;

    const h = await harness(fetchImpl);
    await h.store.saveRegistration("prod", {
      authkitDomain: "https://rational-purity-21.authkit.app",
      clientId: "client_1",
      authorizationEndpoint: "https://rational-purity-21.authkit.app/oauth2/authorize",
      tokenEndpoint: "https://rational-purity-21.authkit.app/oauth2/token",
      revocationEndpoint: "https://rational-purity-21.authkit.app/oauth2/revoke",
      redirectUris: ["http://127.0.0.1:8976/callback"],
      tokenEndpointAuthMethod: "none",
      clientSecretExpiresAt: 0,
      registeredAt: "2026-01-01T00:00:00Z",
    });
    await h.store.saveTokens("prod", FRESH_TOKENS);

    await run(h, ["logout"]);
    expect(revoked).toHaveLength(1);
    expect(revoked[0]).toContain("rt_test");
    const stored = await h.store.getEnv("prod");
    expect(stored.tokens).toBeUndefined();
    expect(stored.registration?.clientId).toBe("client_1");
    // Prod build: no env naming in the message.
    expect(h.err.join("\n")).toContain("Signed out. Credentials removed");
  });

  it("is a no-op with a friendly message when not signed in", async () => {
    const h = await harness(vi.fn() as unknown as typeof fetch);
    await run(h, ["logout"]);
    expect(h.err.join("\n")).toContain("nothing to do");
  });
});

describe("mcp fast path", () => {
  it("ExitWithCode is exported for the entry point", () => {
    expect(new ExitWithCode(3).exitCode).toBe(3);
  });
});
