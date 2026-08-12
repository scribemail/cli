/**
 * Execute one tool through the in-memory MCP pair and render the result.
 *
 * stdout carries data (structuredContent as JSON); stderr carries the human
 * error text (already actionable — it is toToolError's output riding through
 * the MCP layer). Exit codes: 0 ok · 1 tool/API error · 3 not signed in.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AuthRequiredError } from "../auth/errors.js";
import { renderError } from "../render.js";
import type { ToolRuntime } from "./build-commands.js";
import { NO_AUTH_TOOLS } from "./mapping.js";

/** Thrown to carry the process exit code up to the entry point. */
export class ExitWithCode extends Error {
  constructor(readonly exitCode: number) {
    super(`exit ${exitCode}`);
    this.name = "ExitWithCode";
  }
}

export async function executeTool(
  runtime: ToolRuntime,
  toolName: string,
  args: Record<string, unknown>,
): Promise<void> {
  const ctx = runtime.holder.ctx;
  if (!ctx) throw new Error("Internal error: command context was not initialized.");

  // Pre-warm: refresh (or fail with the friendly message) BEFORE any work, so
  // auth problems never surface as a mid-command tool error.
  if (!NO_AUTH_TOOLS.has(toolName)) {
    try {
      await ctx.tokens.getAccessToken();
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        const rendered = renderError(err);
        for (const line of rendered.lines) ctx.deps.stderr(line);
        throw new ExitWithCode(rendered.exitCode);
      }
      throw err;
    }
  }

  const result = (await runtime.client.callTool({
    name: toolName,
    arguments: args,
  })) as CallToolResult;

  if (result.isError) {
    for (const line of textOf(result)) ctx.deps.stderr(line);
    throw new ExitWithCode(1);
  }

  if (result.structuredContent !== undefined) {
    ctx.deps.stdout(JSON.stringify(result.structuredContent, null, ctx.pretty ? 2 : 0));
  } else {
    for (const line of textOf(result)) ctx.deps.stdout(line);
  }
}

function textOf(result: CallToolResult): string[] {
  const content = Array.isArray(result.content) ? result.content : [];
  const lines = content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text);
  return lines.length > 0 ? lines : ["(no output)"];
}
