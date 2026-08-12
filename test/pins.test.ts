import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

interface Pkg {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const read = (url: URL) => JSON.parse(readFileSync(url, "utf8")) as Pkg;

/**
 * The bundle contains exactly one zod and one MCP SDK — but the code compiled
 * into it comes from BOTH repos. Diverging pins would mean the tool core runs
 * against versions it was never tested with; fail fast instead.
 */
describe("cross-repo dependency pins", () => {
  it("zod and @modelcontextprotocol/sdk match mcp-server exactly", () => {
    const cli = read(new URL("../package.json", import.meta.url));
    const core = read(new URL("../../mcp-server/package.json", import.meta.url));
    for (const name of ["zod", "@modelcontextprotocol/sdk"]) {
      const cliPin = cli.devDependencies?.[name];
      const corePin = core.dependencies?.[name] ?? core.devDependencies?.[name];
      expect(cliPin, `${name} missing from cli devDependencies`).toBeDefined();
      expect(cliPin, `${name}: cli pins ${cliPin}, mcp-server pins ${corePin}`).toBe(corePin);
    }
  });
});
