/**
 * Non-secret settings layering: flags > env vars > config file > per-env
 * defaults, funneled through the tool core's resolveConfig so normalization
 * (trailing /v1 stripping, int parsing) stays single-sourced.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveConfig, type ResolvedConfig } from "../../mcp-server/src/config.js";
import type { CliEnv } from "./cli-env.js";

export interface CliConfigFlags {
  apiBaseUrl?: string;
  timeoutMs?: string;
  maxRetries?: string;
}

interface ConfigFile {
  api_base_url?: string;
  timeout_ms?: string | number;
  max_retries?: string | number;
}

function readConfigFile(dir: string): ConfigFile {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as ConfigFile;
  } catch {
    // Missing or unreadable — defaults apply.
  }
  return {};
}

const asString = (v: string | number | undefined): string | undefined =>
  v === undefined ? undefined : String(v);

export function resolveCliConfig(
  flags: CliConfigFlags,
  env: CliEnv,
  configDir: string,
): ResolvedConfig {
  const file = readConfigFile(configDir);
  return resolveConfig({
    SCRIBE_API_BASE_URL:
      flags.apiBaseUrl ?? process.env.SCRIBE_API_BASE_URL ?? file.api_base_url ?? env.apiBaseUrl,
    REQUEST_TIMEOUT_MS:
      flags.timeoutMs ?? process.env.REQUEST_TIMEOUT_MS ?? asString(file.timeout_ms),
    MAX_RETRIES: flags.maxRetries ?? process.env.MAX_RETRIES ?? asString(file.max_retries),
  });
}
