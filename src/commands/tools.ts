import type { CommandContext } from "../context.js";
import type { ToolRuntime } from "../generate/build-commands.js";
import { EXCLUDED_TOOLS, TOOL_COMMAND_MAP } from "../generate/mapping.js";

/** `scribe tools` — the MCP-name ↔ CLI-command cross-reference. */
export function toolsAction(
  runtime: ToolRuntime,
  ctx: CommandContext,
  opts: { json?: boolean },
): void {
  const rows = runtime.tools
    .map((tool) => {
      const path = TOOL_COMMAND_MAP[tool.name];
      return {
        tool: tool.name,
        command: path ? `scribe ${path.join(" ")}` : null,
        note: EXCLUDED_TOOLS.has(tool.name) ? "deprecated alias; via `scribe call` only" : null,
      };
    })
    .sort((a, b) => a.tool.localeCompare(b.tool));

  if (opts.json) {
    ctx.deps.stdout(JSON.stringify(rows, null, ctx.pretty ? 2 : 0));
    return;
  }
  const width = Math.max(...rows.map((r) => r.tool.length)) + 2;
  for (const row of rows) {
    const target = row.command ?? `(${row.note ?? "unmapped"})`;
    ctx.deps.stdout(`${row.tool.padEnd(width)}${target}`);
  }
}
