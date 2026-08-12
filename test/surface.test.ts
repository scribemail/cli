import { describe, expect, it, vi } from "vitest";
import type { Command } from "commander";
import { EXCLUDED_TOOLS, TOOL_COMMAND_MAP } from "../src/generate/mapping.js";
import { harness } from "./helpers.js";

const h = await harness(vi.fn() as unknown as typeof fetch);

function findCommand(root: Command, path: string[]): Command | undefined {
  let current: Command | undefined = root;
  for (const segment of path) {
    current = current?.commands.find((c) => c.name() === segment);
  }
  return current;
}

function walkLeaves(command: Command, path: string[] = []): string[][] {
  if (command.commands.length === 0) return [path];
  return command.commands.flatMap((child) => walkLeaves(child, [...path, child.name()]));
}

describe("surface parity", () => {
  it("every server tool is either mapped or explicitly excluded — and nothing extra", async () => {
    const { createToolRuntime } = await import("../src/generate/build-commands.js");
    const runtime = await createToolRuntime(h.deps);
    const serverTools = new Set(runtime.tools.map((t) => t.name));
    const declared = new Set([...Object.keys(TOOL_COMMAND_MAP), ...EXCLUDED_TOOLS]);

    const undeclared = [...serverTools].filter((name) => !declared.has(name));
    const stale = [...declared].filter((name) => !serverTools.has(name));

    expect(undeclared, "new tools need a mapping decision in generate/mapping.ts").toEqual([]);
    expect(stale, "mapping entries for tools the server no longer registers").toEqual([]);
  });

  it("no two tools map to the same command path", () => {
    const seen = new Map<string, string>();
    for (const [tool, path] of Object.entries(TOOL_COMMAND_MAP)) {
      const key = path.join(" ");
      expect(seen.has(key), `duplicate path "${key}" (${seen.get(key)} vs ${tool})`).toBe(false);
      seen.set(key, tool);
    }
  });

  it("every mapped path exists in the program with its flags", () => {
    for (const [tool, path] of Object.entries(TOOL_COMMAND_MAP)) {
      const command = findCommand(h.program, [...path]);
      expect(command, `missing command for ${tool}: scribe ${path.join(" ")}`).toBeDefined();
      // Every generated leaf carries the --json escape hatch.
      expect(command!.options.some((o) => o.long === "--json")).toBe(true);
    }
  });

  it("excluded tools have no generated command", () => {
    for (const tool of EXCLUDED_TOOLS) {
      const path = Object.values(TOOL_COMMAND_MAP).find((p) => p.join("-") === tool);
      expect(path).toBeUndefined();
    }
    // The deprecated analytics aliases specifically must not appear anywhere.
    const leaves = walkLeaves(h.program).map((p) => p.join(" "));
    expect(leaves.some((l) => l.includes("overview"))).toBe(false);
  });

  it("the generated tree is stable (snapshot)", () => {
    const tree = walkLeaves(h.program)
      .map((path) => {
        const command = findCommand(h.program, path);
        const flags = (command?.options ?? []).map((o) => o.flags).sort();
        return `${path.join(" ")} :: ${flags.join(", ")}`;
      })
      .sort();
    expect(tree).toMatchSnapshot();
  });
});
