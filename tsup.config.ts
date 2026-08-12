import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

// The published tarball must be self-contained: the source imports the tool core
// from ../mcp-server/src (a build-time sibling checkout), so everything — core,
// zod, the MCP SDK, commander — is bundled into one ESM file.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  noExternal: [/.*/],
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __createRequire } from "node:module";',
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  clean: true,
  minify: false,
  sourcemap: false,
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
    // Baked-in target environment: `pnpm build` → prod (what npm users get),
    // `pnpm build:staging` → staging (internal testing builds only).
    __SCRIBE_DEFAULT_ENV__: JSON.stringify(process.env.SCRIBE_BUILD_ENV ?? "prod"),
  },
});
