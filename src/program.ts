/**
 * The commander program. Everything side-effectful comes through CliDeps so
 * tests can drive the whole tree in memory (exitOverride + captured streams).
 */

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { callAction } from "./commands/call.js";
import { loginAction } from "./commands/login.js";
import { logoutAction } from "./commands/logout.js";
import { toolsAction } from "./commands/tools.js";
import { whoamiAction } from "./commands/whoami.js";
import { buildContext, type CliDeps, type CommandContext, type GlobalOpts } from "./context.js";
import {
  attachGeneratedCommands,
  createToolRuntime,
  type ToolRuntime,
} from "./generate/build-commands.js";
import { parseJsonValue } from "./generate/flags.js";
import { mcpAction } from "./mcp/serve.js";
import { CLI_VERSION } from "./version.js";

export interface ProgramOptions {
  /**
   * Skip building the generated tree (and its in-memory MCP handshake) for the
   * `scribe mcp` fast path — that command creates its own server anyway.
   */
  skipGenerated?: boolean;
}

export async function createProgram(deps: CliDeps, options: ProgramOptions = {}): Promise<Command> {
  const program = new Command();
  const write = (sink: (text: string) => void) => (str: string) => sink(str.replace(/\n$/, ""));

  program
    .name("scribe")
    .description(
      "Scribe (scribe-mail.com) on the command line: manage signatures, teammates, " +
        "campaigns and analytics — or serve them to a local agent over MCP.",
    )
    .version(CLI_VERSION)
    .option("--api-base-url <url>", "Scribe API origin override.")
    .option("--timeout-ms <n>", "Per-request timeout in milliseconds.")
    .option("--max-retries <n>", "Max retries for 429/5xx.")
    .option("--pretty", "Pretty-print JSON output.")
    .exitOverride()
    .configureOutput({ writeOut: write(deps.stdout), writeErr: write(deps.stderr) });

  let runtime: ToolRuntime | undefined;
  const holder: { ctx?: CommandContext } = {};

  if (!options.skipGenerated) {
    runtime = await createToolRuntime(deps);
  }

  // One context per invocation, built after global flags parse; the generated
  // commands read it through runtime.holder.
  program.hook("preAction", () => {
    holder.ctx = buildContext(program.opts<GlobalOpts>(), deps);
    if (runtime) runtime.holder.ctx = holder.ctx;
  });

  const ctx = (): CommandContext => {
    if (!holder.ctx) throw new Error("Internal error: context not initialized.");
    return holder.ctx;
  };

  program
    .command("login")
    .description("Sign in to Scribe via your browser (WorkOS AuthKit OAuth).")
    .option("--no-browser", "Print the sign-in URL instead of opening a browser.")
    .action(async (opts: { browser: boolean }) => {
      await loginAction(ctx(), { noBrowser: !opts.browser });
    });

  program
    .command("logout")
    .description("Sign out: revoke (best effort) and delete the stored credentials.")
    .option("--all", "Sign out of every environment.")
    .action(async (opts: { all?: boolean }) => {
      await logoutAction(ctx(), opts);
    });

  program
    .command("whoami")
    .description("Show the signed-in user, workspace, role, and token state.")
    .option("--json", "Machine-readable output.")
    .action(async (opts: { json?: boolean }) => {
      await whoamiAction(ctx(), opts);
    });

  program
    .command("mcp")
    .description("Serve all Scribe tools to a local agent over stdio MCP (uses your login).")
    .action(async () => {
      await mcpAction(ctx());
    });

  if (runtime) {
    const rt = runtime;
    const readStdin = () => readFileSync(0, "utf8");

    program
      .command("tools")
      .description("List every MCP tool and its CLI command.")
      .option("--json", "Machine-readable output.")
      .action((opts: { json?: boolean }) => {
        toolsAction(rt, ctx(), opts);
      });

    const call = program
      .command("call")
      .description("Call any tool by its exact MCP name (full parity escape hatch).")
      .argument("<tool_name>", "MCP tool name, e.g. list_signatures")
      .option("--json <json>", "Arguments object (JSON; @file or - for stdin).", (value: string) =>
        parseJsonValue(value, readStdin),
      )
      .action(async (toolName: string, opts: { json?: unknown }) => {
        await callAction(rt, call, toolName, opts);
      });

    attachGeneratedCommands(program, rt, readStdin);
  }

  return program;
}
