// Interactive release cutter — run via `pnpm release`.
//
// Prompts for the version bump, then does everything behind the scenes:
//   1. preflight (on a clean tree, mcp-server sibling checkout present),
//   2. local verify (typecheck + test + build + test:e2e) so a broken release
//      never gets tagged,
//   3. `pnpm version` (bumps package.json + commits + creates the vX.Y.Z tag),
//   4. push the branch + tag — which triggers .github/workflows/release.yml
//      (npm publish via OIDC Trusted Publishing → GitHub Release).
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

const rl = createInterface({ input, output });
let finished = false;
// Closing stdin (Ctrl-D / piped EOF) mid-prompt is a clean abort, not a crash.
rl.on("close", () => {
  if (!finished) fail("Aborted (input closed).");
});

const ask = async (q) => (await rl.question(q)).trim();
const yes = (s) => s.toLowerCase() === "y" || s.toLowerCase() === "yes";

async function main() {
  // --- Preflight ---------------------------------------------------------------------------------
  let branch;
  try {
    branch = sh("git rev-parse --abbrev-ref HEAD");
  } catch {
    fail("Not a git repository.");
  }
  if (sh("git status --porcelain")) {
    fail("Working tree is not clean — commit or stash your changes before releasing.");
  }
  if (!existsSync(new URL("../../mcp-server/src/server.ts", import.meta.url))) {
    fail("The build imports ../mcp-server — clone scribemail/mcp-server next to this repo first.");
  }

  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const current = pkg.version;
  const [maj, min, pat] = current.split(".").map(Number);
  const next = {
    patch: `${maj}.${min}.${pat + 1}`,
    minor: `${maj}.${min + 1}.0`,
    major: `${maj + 1}.0.0`,
  };

  if (
    branch !== "main" &&
    !yes(await ask(`⚠ You are on "${branch}", not "main". Continue anyway? [y/N] `))
  ) {
    fail("Aborted.");
  }

  console.log(`\nCurrent version: v${current}\n`);
  console.log(`  1) patch  →  v${next.patch}`);
  console.log(`  2) minor  →  v${next.minor}`);
  console.log(`  3) major  →  v${next.major}`);
  console.log(`  4) custom`);

  let bumpArg;
  let target;
  switch (await ask("\nSelect a bump [1-4]: ")) {
    case "1":
      bumpArg = "patch";
      target = next.patch;
      break;
    case "2":
      bumpArg = "minor";
      target = next.minor;
      break;
    case "3":
      bumpArg = "major";
      target = next.major;
      break;
    case "4": {
      const v = (await ask("Enter version (x.y.z): ")).replace(/^v/, "");
      if (!/^\d+\.\d+\.\d+$/.test(v)) fail(`"${v}" is not a valid x.y.z version.`);
      bumpArg = v;
      target = v;
      break;
    }
    default:
      fail("Aborted — no valid option selected.");
  }

  if (!yes(await ask(`\nRelease v${target}? This verifies, tags, and pushes. [y/N] `))) {
    fail("Aborted.");
  }
  finished = true;
  rl.close();

  // --- Verify (fail before tagging, not after) ---------------------------------------------------
  console.log("\n▸ Verifying (typecheck + test + build + e2e)…");
  try {
    run("pnpm", ["typecheck"]);
    run("pnpm", ["test"]);
    run("pnpm", ["build"]);
    run("pnpm", ["test:e2e"]);
  } catch {
    fail("Pre-release checks failed — nothing was tagged.");
  }

  // --- Bump + tag + push -------------------------------------------------------------------------
  console.log(`\n▸ Bumping to v${target} and tagging…`);
  run("pnpm", ["version", bumpArg, "--message", "release: v%s"]);
  // Push the branch first, then the tag as its own push. A combined branch+tag push
  // (git push --follow-tags) can leave GitHub registering only the branch event, so the
  // tag-triggered Release workflow never fires. Two separate pushes guarantee a clean
  // tag-create event that triggers .github/workflows/release.yml.
  console.log("\n▸ Pushing branch…");
  run("git", ["push", "origin", "HEAD"]);
  console.log("▸ Pushing tag…");
  run("git", ["push", "origin", `v${target}`]);

  console.log(`\n✔ Released v${target}. GitHub Actions is publishing to npm:`);
  console.log("  https://github.com/scribemail/cli/actions\n");
}

main().catch((err) => fail(err?.message ?? String(err)));
