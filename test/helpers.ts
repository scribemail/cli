import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { CredentialStore, type StoredTokens } from "../src/auth/store.js";
import type { CliDeps } from "../src/context.js";
import { createProgram } from "../src/program.js";

export interface Harness {
  program: Command;
  deps: CliDeps;
  store: CredentialStore;
  configDir: string;
  out: string[];
  err: string[];
  browserUrls: string[];
}

export const FRESH_TOKENS: StoredTokens = {
  accessToken: "at_test",
  refreshToken: "rt_test",
  expiresAt: Date.now() + 3_600_000,
  orgId: "org_test",
  userId: "user_test",
  email: "gil@example.test",
  role: "admin",
};

/** Build the whole program with captured streams and a temp credential dir. */
export async function harness(fetchImpl: typeof fetch): Promise<Harness> {
  const configDir = mkdtempSync(join(tmpdir(), "scribe-cli-"));
  const out: string[] = [];
  const err: string[] = [];
  const browserUrls: string[] = [];
  const deps: CliDeps = {
    fetchImpl,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    openBrowser: (url) => {
      browserUrls.push(url);
      return true;
    },
    configDir,
  };
  const program = await createProgram(deps);
  return { program, deps, store: new CredentialStore(configDir), configDir, out, err, browserUrls };
}

export async function run(h: Harness, argv: string[]): Promise<unknown> {
  try {
    await h.program.parseAsync(argv, { from: "user" });
    return undefined;
  } catch (err) {
    return err;
  }
}

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Full signature shape (create/update/get responses — content trees included). */
export const fullSignature = {
  id: "sig-1",
  name: "Primary",
  content: { type: "stack", children: [] },
  draft_content: { type: "stack", children: [] },
  priority: 1,
  signature_installation_activated: true,
  folder_id: null,
  last_published_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  reply_variant_activated: false,
  internal_variant_activated: false,
  hidden_on_reply: false,
  hidden_on_internal: false,
  show_marketing_campaigns_on_reply: true,
  show_marketing_campaigns_on_internal: true,
  reply_variant_uuid: null,
  internal_variant_uuid: null,
};

export const signaturePage = {
  data: [
    {
      id: "sig-1",
      name: "Primary",
      priority: 1,
      signature_installation_activated: true,
      folder_id: null,
      last_published_at: "2026-01-01T00:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      reply_variant_activated: false,
      internal_variant_activated: false,
      hidden_on_reply: false,
      hidden_on_internal: false,
      show_marketing_campaigns_on_reply: true,
      show_marketing_campaigns_on_internal: true,
      reply_variant_uuid: null,
      internal_variant_uuid: null,
      has_content: true,
      has_draft_content: false,
    },
  ],
  pagination: { page: 1, limit: 2, total_count: 1, total_pages: 1, has_more: false },
};
