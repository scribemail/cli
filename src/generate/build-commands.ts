/**
 * Generate the command tree from the tool registry itself.
 *
 * An SDK Client is connected to createServer(deps) over InMemoryTransport (the
 * same harness as mcp-server/test/tools.test.ts); tools/list drives command
 * construction and tools/call executes them. The CLI therefore sees exactly
 * what any MCP client sees — same schemas, same output-guard reconciliation,
 * same error texts — parity by construction.
 *
 * The server is created BEFORE the CLI's global flags are parsed (commander
 * needs the tree up front), so ToolDeps starts with placeholder config and a
 * context holder; the preAction hook fills both in before any tool executes.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Command } from "commander";
import { resolveConfig } from "../../../mcp-server/src/config.js";
import { createServer } from "../../../mcp-server/src/server.js";
import type { ToolDeps } from "../../../mcp-server/src/tools/shared.js";
import type { CliDeps, CommandContext } from "../context.js";
import { CLI_USER_AGENT, CLI_VERSION } from "../version.js";
import { applyAugmentations } from "./augmentations.js";
import {
  buildToolArgs,
  flagSpecsFromSchema,
  optionsForSpec,
  parseJsonValue,
  type JsonSchemaObject,
} from "./flags.js";
import { EXCLUDED_TOOLS, TOOL_COMMAND_MAP } from "./mapping.js";
import { executeTool } from "./runner.js";

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: JsonSchemaObject;
}

export interface ToolRuntime {
  client: Client;
  tools: ToolInfo[];
  /** Mutable: preAction assigns the resolved per-invocation context. */
  holder: { ctx?: CommandContext };
}

export async function createToolRuntime(deps: CliDeps): Promise<ToolRuntime> {
  // Tools read deps.config per call (buildClient), but registerTools copies deps
  // with an object spread, so a getter would be read once, before preAction.
  // Hand it one config object instead and update that object in place when
  // preAction sets the invocation's context.
  const config = resolveConfig(undefined);
  let ctx: CommandContext | undefined;
  const holder = {
    get ctx() {
      return ctx;
    },
    set ctx(value: CommandContext | undefined) {
      ctx = value;
      if (value) Object.assign(config, value.config);
    },
  };
  const toolDeps: ToolDeps = {
    config,
    getToken: async () => (holder.ctx ? holder.ctx.tokens.tokenProvider()() : null),
    userAgent: CLI_USER_AGENT,
    fetchImpl: deps.fetchImpl,
  };
  const server = createServer(toolDeps);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "scribe-cli", version: CLI_VERSION });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  return { client, tools: tools as unknown as ToolInfo[], holder };
}

/** Look up (or create) the nested subcommand group for a command path. */
function groupFor(program: Command, path: readonly string[]): Command {
  let current = program;
  for (const segment of path) {
    const existing = current.commands.find((c) => c.name() === segment);
    // .command() copies inherited settings (exitOverride, output) automatically.
    current =
      existing ?? current.command(segment).description(`Scribe ${segment.replaceAll("-", " ")}`);
  }
  return current;
}

export function attachGeneratedCommands(
  program: Command,
  runtime: ToolRuntime,
  readStdin: () => string,
): void {
  for (const tool of runtime.tools) {
    if (EXCLUDED_TOOLS.has(tool.name)) continue;
    const path = TOOL_COMMAND_MAP[tool.name];
    if (!path) continue; // surface.test.ts fails the build on unmapped tools

    const parent = path.length > 1 ? groupFor(program, path.slice(0, -1)) : program;
    const leaf = parent.command(path[path.length - 1]);
    const specs = flagSpecsFromSchema(tool.inputSchema);

    leaf.description(firstSentence(tool.description));
    for (const spec of specs) {
      for (const option of optionsForSpec(spec, readStdin)) leaf.addOption(option);
    }
    leaf.option(
      "--json <json>",
      "Full arguments object (JSON; @file or - for stdin); explicit flags override its keys.",
      (value: string) => parseJsonValue(value, readStdin),
    );
    leaf.addHelpText(
      "after",
      `\nMCP tool: ${tool.name}\n${tool.description ? `\n${tool.description}\n` : ""}`,
    );

    applyAugmentations(tool.name, leaf);

    leaf.action(async (opts: Record<string, unknown>) => {
      const { args, missingRequired } = buildToolArgs(specs, opts, opts.json);
      if (missingRequired.length > 0) {
        leaf.error(`Missing required option(s): ${missingRequired.join(", ")}`, {
          exitCode: 2,
          code: "scribe.missingRequired",
        });
      }
      await executeTool(runtime, tool.name, args);
    });
  }
}

function firstSentence(text: string | undefined): string {
  if (!text) return "";
  const period = text.indexOf(". ");
  const cut = period > 0 ? text.slice(0, period + 1) : text.split("\n", 1)[0];
  return cut.length > 120 ? `${cut.slice(0, 117)}…` : cut;
}
