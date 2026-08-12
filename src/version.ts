/** Injected by tsup `define` at build time; falls back for tsx/vitest runs. */
declare const __CLI_VERSION__: string | undefined;

export const CLI_VERSION = typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.0.0-dev";

/** Distinct UA so backend analytics can split CLI traffic from the remote MCP server. */
export const CLI_USER_AGENT = `scribe-cli/${CLI_VERSION}`;
