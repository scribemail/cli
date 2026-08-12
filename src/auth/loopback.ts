/**
 * Loopback OAuth redirect receiver.
 *
 * Binds 127.0.0.1 explicitly (never 0.0.0.0, never the hostname "localhost" —
 * the registered redirect URIs use the literal IP so browser and server always
 * agree). Serves exactly one valid callback; everything else 404s. The state
 * parameter is compared in constant time BEFORE the code is read. No token or
 * code is ever echoed into the response HTML.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { LoginFlowError } from "./errors.js";

export interface LoopbackServer {
  port: number;
  redirectUri: string;
  waitForCallback(): Promise<{ code: string }>;
  close(): void;
}

const DEFAULT_TIMEOUT_MS = 300_000;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:90vh;color:#1a1a2e}main{text-align:center;max-width:28rem}h1{font-size:1.25rem}p{color:#555}</style>
</head><body><main><h1>${title}</h1><p>${body}</p></main><script>setTimeout(()=>window.close(),1500)</script></body></html>`;
}

/** Constant-time string comparison without leaking length (compares digests). */
function safeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}

function listenOn(port: number, server: Server): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener("listening", onListening);
      if (err.code === "EADDRINUSE" || err.code === "EACCES") resolve(false);
      else reject(err);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve(true);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export async function startLoopback(opts: {
  candidatePorts: number[];
  expectedState: string;
  timeoutMs?: number;
}): Promise<LoopbackServer> {
  let settled = false;
  let resolveCallback!: (result: { code: string }) => void;
  let rejectCallback!: (err: Error) => void;
  const callbackPromise = new Promise<{ code: string }>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    if (settled) {
      res.writeHead(410, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page("Already handled", "This sign-in was already completed. Close this tab."));
      return;
    }

    const error = url.searchParams.get("error");
    if (error) {
      // error_description is attacker-influenced input — escape before rendering.
      const description = url.searchParams.get("error_description") ?? "";
      settled = true;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page("Sign-in failed", escapeHtml(`${error}: ${description}`)));
      rejectCallback(new LoginFlowError(`Sign-in was not completed (${error}). ${description}`));
      return;
    }

    const state = url.searchParams.get("state") ?? "";
    if (!safeEqual(state, opts.expectedState)) {
      settled = true;
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page("State mismatch", "Possible CSRF — run scribe login again."));
      rejectCallback(new LoginFlowError("State mismatch on the OAuth callback (possible CSRF)."));
      return;
    }

    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page("Missing code", "The callback did not include an authorization code."));
      return;
    }

    settled = true;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      page("You're signed in to Scribe", "You can close this tab and return to your terminal."),
    );
    resolveCallback({ code });
  });

  let boundPort: number | undefined;
  for (const port of opts.candidatePorts) {
    if (await listenOn(port, server)) {
      boundPort = port;
      break;
    }
  }
  if (boundPort === undefined) {
    throw new LoginFlowError(
      `Ports ${opts.candidatePorts.join(", ")} are all in use on 127.0.0.1 — ` +
        "close the conflicting process and run scribe login again.",
    );
  }

  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectCallback(new LoginFlowError("Timed out waiting for the browser sign-in."));
    }
    server.close();
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const close = () => {
    clearTimeout(timer);
    server.close();
    // Break keep-alive connections so the process can exit promptly.
    server.closeAllConnections?.();
  };

  return {
    port: boundPort,
    redirectUri: `http://127.0.0.1:${boundPort}/callback`,
    waitForCallback: () => callbackPromise.finally(close),
    close,
  };
}
