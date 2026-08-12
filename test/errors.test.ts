import { describe, expect, it, vi } from "vitest";
import { CommanderError } from "commander";
import { ScribeApiError } from "../../mcp-server/src/client.js";
import { AuthRequiredError } from "../src/auth/errors.js";
import { ExitWithCode } from "../src/generate/runner.js";
import { EXIT_API_ERROR, EXIT_AUTH, renderError } from "../src/render.js";
import { FRESH_TOKENS, harness, jsonResponse, run } from "./helpers.js";

describe("renderError", () => {
  it("AuthRequiredError → exit 3 with the login hint", () => {
    const rendered = renderError(new AuthRequiredError("You're not signed in. Run: scribe login"));
    expect(rendered.exitCode).toBe(EXIT_AUTH);
    expect(rendered.lines[0]).toContain("scribe login");
  });

  it("401 → session expired, exit 3", () => {
    const rendered = renderError(
      new ScribeApiError({ status: 401, type: "auth_error", code: "unauthorized", message: "x" }),
    );
    expect(rendered.exitCode).toBe(EXIT_AUTH);
    expect(rendered.lines[0]).toContain("scribe login");
  });

  it("403 feature_unavailable → remediation message + dashboard url", () => {
    const rendered = renderError(
      new ScribeApiError({
        status: 403,
        type: "forbidden",
        code: "feature_unavailable",
        message: "The workspace's plan does not include API access.",
        remediation: {
          action: "upgrade_plan",
          message: "Upgrade the plan to use the API.",
          dashboard_url: "https://app.scribe-mail.com/settings/plan",
        },
      }),
    );
    expect(rendered.exitCode).toBe(EXIT_API_ERROR);
    expect(rendered.lines.join("\n")).toContain("Upgrade the plan");
    expect(rendered.lines.join("\n")).toContain("https://app.scribe-mail.com/settings/plan");
  });

  it("bare 403 with a member role → owner/admin explanation", () => {
    const rendered = renderError(
      new ScribeApiError({
        status: 403,
        type: "forbidden",
        code: "insufficient_scope",
        message: "Not permitted.",
      }),
      { role: "member" },
    );
    expect(rendered.lines.join("\n")).toContain('role ("member")');
    expect(rendered.lines.join("\n")).toContain("owners and admins");
  });

  it("422 → per-field details with allowed values", () => {
    const rendered = renderError(
      new ScribeApiError({
        status: 422,
        type: "validation_error",
        code: "invalid",
        message: "Validation failed.",
        details: [
          { field: "kind", code: "enum", message: "not allowed", allowed: ["text", "image"] },
        ],
      }),
    );
    expect(rendered.lines.join("\n")).toContain("kind: not allowed (allowed: text, image)");
  });

  it("429 → retry hint", () => {
    const rendered = renderError(
      new ScribeApiError({
        status: 429,
        type: "rate_limit_error",
        code: "rate_limited",
        message: "Slow down.",
        retryAfterSeconds: 12,
      }),
    );
    expect(rendered.lines[0]).toContain("Retry in 12s");
  });
});

describe("program error paths", () => {
  it("not signed in → ExitWithCode(3) and the friendly message on stderr", async () => {
    const h = await harness(vi.fn() as unknown as typeof fetch);
    const result = await run(h, ["signatures", "list"]);
    expect(result).toBeInstanceOf(ExitWithCode);
    expect((result as ExitWithCode).exitCode).toBe(3);
    expect(h.err.join("\n")).toContain("scribe login");
  });

  it("API tool error (422) → tool text on stderr, ExitWithCode(1)", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) =>
      String(url).includes("/v1/")
        ? jsonResponse(
            {
              error: {
                type: "validation_error",
                code: "invalid_content",
                message: "draft_content is not a valid block tree.",
              },
            },
            422,
          )
        : jsonResponse({}),
    ) as unknown as typeof fetch;

    const h = await harness(fetchImpl);
    await h.store.saveTokens("prod", FRESH_TOKENS);
    const result = await run(h, ["signatures", "create", "--name", "X"]);
    expect(result).toBeInstanceOf(ExitWithCode);
    expect((result as ExitWithCode).exitCode).toBe(1);
    expect(h.err.join("\n")).toContain("draft_content is not a valid block tree");
  });

  it("missing required flag → usage error (commander exit 2)", async () => {
    const h = await harness(vi.fn() as unknown as typeof fetch);
    await h.store.saveTokens("prod", FRESH_TOKENS);
    const result = await run(h, ["signatures", "create"]);
    expect(result).toBeInstanceOf(CommanderError);
    expect((result as CommanderError).exitCode).toBe(2);
    expect(h.err.join("\n")).toContain("--name");
  });

  it("bad JSON flag value → usage error (commander exit 2)", async () => {
    const h = await harness(vi.fn() as unknown as typeof fetch);
    await h.store.saveTokens("prod", FRESH_TOKENS);
    const result = await run(h, [
      "signatures",
      "create",
      "--name",
      "X",
      "--draft-content",
      "{oops",
    ]);
    expect(result).toBeInstanceOf(CommanderError);
  });

  it("unknown tool via scribe call → usage error", async () => {
    const h = await harness(vi.fn() as unknown as typeof fetch);
    const result = await run(h, ["call", "does_not_exist"]);
    expect(result).toBeInstanceOf(CommanderError);
    expect(h.err.join("\n")).toContain("scribe tools");
  });

  it("the environment is fixed at build time: no --env flag, no SCRIBE_ENV override", async () => {
    vi.stubEnv("SCRIBE_ENV", "staging");
    try {
      const h = await harness(vi.fn() as unknown as typeof fetch);
      expect(h.program.options.some((o) => o.long === "--env")).toBe(false);
      // Even with SCRIBE_ENV set, the BUILT env (prod → no env tag) is used.
      const result = await run(h, ["signatures", "list"]);
      expect(result).toBeInstanceOf(ExitWithCode);
      expect(h.err.join("\n")).toContain("You're not signed in. Run: scribe login");
      expect(h.err.join("\n")).not.toContain("staging");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
