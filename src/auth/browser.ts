import { spawn } from "node:child_process";

/**
 * Open the system browser at `url`. Always spawn with an argv array — never a
 * shell string — so the URL cannot be interpreted by a shell. Returns false on
 * failure; callers must also print the URL for copy/paste (headless/SSH).
 */
export function openBrowser(url: string): boolean {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => {
      // Swallow: the printed URL is the fallback path.
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
