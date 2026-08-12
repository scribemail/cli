import type { Command } from "commander";
import type { ToolRuntime } from "../generate/build-commands.js";
import { executeTool } from "../generate/runner.js";

/** `scribe call <tool_name>` — any tool by its exact MCP name (parity escape hatch). */
export async function callAction(
  runtime: ToolRuntime,
  command: Command,
  toolName: string,
  opts: { json?: unknown },
): Promise<void> {
  if (!runtime.tools.some((tool) => tool.name === toolName)) {
    command.error(`Unknown tool "${toolName}". List tools with: scribe tools`, { exitCode: 2 });
  }
  const args =
    opts.json && typeof opts.json === "object" && !Array.isArray(opts.json)
      ? (opts.json as Record<string, unknown>)
      : {};
  await executeTool(runtime, toolName, args);
}
