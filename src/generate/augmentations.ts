/**
 * CLI-only conveniences layered on top of the generated commands. These only
 * ADD flags that pre-fill the tool's real arguments — the tool contract itself
 * (and its server-side validation) is untouched, so parity holds.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { InvalidArgumentError } from "commander";

export function applyAugmentations(toolName: string, command: Command): void {
  if (toolName === "create_asset") {
    command.option(
      "--file <path>",
      "Read a local image and fill file_base64 + filename (instead of --file-base64).",
    );
    command.hook("preAction", (thisCommand) => {
      const opts = thisCommand.opts<Record<string, unknown>>();
      const path = opts.file;
      if (typeof path !== "string") return;
      let bytes: Buffer;
      try {
        bytes = readFileSync(path);
      } catch (err) {
        throw new InvalidArgumentError(`Could not read ${path}: ${(err as Error).message}`);
      }
      thisCommand.setOptionValue("fileBase64", bytes.toString("base64"));
      if (opts.filename === undefined) thisCommand.setOptionValue("filename", basename(path));
    });
  }
}
