/**
 * Post-build smoke tests against the BUNDLED bin (dist/index.js). Run with
 * `pnpm test:e2e` after `pnpm build` — this is the release gate proving the
 * published tarball is self-contained.
 */

import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EXCLUDED_TOOLS, TOOL_COMMAND_MAP } from "../src/generate/mapping.js";

const execFileAsync = promisify(execFile);
const BIN = join(import.meta.dirname, "..", "dist", "index.js");

describe.skipIf(!existsSync(BIN))("bundled bin", () => {
  const configDir = mkdtempSync(join(tmpdir(), "scribe-e2e-"));
  const env = { ...process.env, SCRIBE_CONFIG_DIR: configDir };

  it("--version prints the package version", async () => {
    const { stdout } = await execFileAsync("node", [BIN, "--version"], { env });
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("--help lists the hand-written and generated commands", async () => {
    const { stdout } = await execFileAsync("node", [BIN, "--help"], { env });
    for (const expected of [
      "login",
      "logout",
      "whoami",
      "mcp",
      "call",
      "signatures",
      "teammates",
    ]) {
      expect(stdout).toContain(expected);
    }
  });

  it("a data command without login exits 3 with the login hint", async () => {
    try {
      await execFileAsync("node", [BIN, "signatures", "list"], { env });
      expect.unreachable("should have exited non-zero");
    } catch (err) {
      const e = err as { code: number; stderr: string };
      expect(e.code).toBe(3);
      expect(e.stderr).toContain("scribe login");
    }
  });

  it("mcp mode serves the full tool surface over stdio", async () => {
    const transport = new StdioClientTransport({
      command: "node",
      args: [BIN, "mcp"],
      env: { ...env, PATH: process.env.PATH ?? "" } as Record<string, string>,
      stderr: "ignore",
    });
    const client = new Client({ name: "e2e", version: "0.0.0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      const names = new Set(tools.map((t) => t.name));
      const expected = new Set([...Object.keys(TOOL_COMMAND_MAP), ...EXCLUDED_TOOLS]);
      expect(names).toEqual(expected);
    } finally {
      await client.close();
    }
  });
});
