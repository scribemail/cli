// The shebang lives in tsup's banner (dist only), alongside a createRequire
// shim that lets bundled CJS deps (commander) require node builtins from ESM.
import { CommanderError } from "commander";
import { defaultDeps } from "./context.js";
import { ExitWithCode } from "./generate/runner.js";
import { createProgram } from "./program.js";
import { renderError } from "./render.js";

async function main(): Promise<void> {
  const deps = defaultDeps();
  try {
    // `scribe mcp` skips the generated tree: it builds its own stdio server,
    // and agents launching it should not pay the in-memory handshake twice.
    const program = await createProgram(deps, { skipGenerated: process.argv[2] === "mcp" });
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof ExitWithCode) {
      process.exitCode = err.exitCode;
      return;
    }
    if (err instanceof CommanderError) {
      // help/version exit 0; usage errors exit per commander (mapped to 2 below).
      process.exitCode = err.exitCode === 0 ? 0 : 2;
      return;
    }
    const rendered = renderError(err);
    for (const line of rendered.lines) deps.stderr(line);
    process.exitCode = rendered.exitCode;
  }
}

void main();
