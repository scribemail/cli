/**
 * Dependency container. Everything with a side effect (fetch, streams, browser,
 * credential dir, exit) is injectable so tests drive the whole program through
 * createProgram(deps) with no real I/O.
 */

import type { ResolvedConfig } from "../../mcp-server/src/config.js";
import { openBrowser } from "./auth/browser.js";
import { CredentialStore } from "./auth/store.js";
import { TokenManager } from "./auth/token-manager.js";
import { resolveEnv, type CliEnv } from "./cli-env.js";
import { resolveCliConfig, type CliConfigFlags } from "./config.js";

export interface CliDeps {
  fetchImpl: typeof fetch;
  /** Data output (JSON results). */
  stdout: (text: string) => void;
  /** Human-facing messages, progress, errors. */
  stderr: (text: string) => void;
  openBrowser: (url: string) => boolean;
  /** Override the credential/config directory (tests). */
  configDir?: string;
}

export function defaultDeps(): CliDeps {
  return {
    fetchImpl: (input, init) => fetch(input, init),
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
    openBrowser,
  };
}

/** Per-invocation context, built once the global flags are parsed. */
export interface CommandContext {
  env: CliEnv;
  config: ResolvedConfig;
  store: CredentialStore;
  tokens: TokenManager;
  deps: CliDeps;
  pretty: boolean;
}

export interface GlobalOpts extends CliConfigFlags {
  pretty?: boolean;
}

export function buildContext(opts: GlobalOpts, deps: CliDeps): CommandContext {
  // Fixed at build time (see cli-env.ts) — no flag, no env var, no override.
  const env = resolveEnv();
  const store = deps.configDir ? new CredentialStore(deps.configDir) : new CredentialStore();
  return {
    env,
    config: resolveCliConfig(opts, env, store.dir),
    store,
    tokens: new TokenManager(env, store, deps.fetchImpl),
    deps,
    pretty: opts.pretty ?? false,
  };
}
