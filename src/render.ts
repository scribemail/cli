/**
 * Error → human message + exit code. CLI wording (never the MCP tool texts:
 * those tell an agent what to do; these tell a person at a terminal).
 *
 * Exit codes: 0 ok · 1 API/tool error · 2 usage error · 3 not signed in.
 */

import { ScribeApiError } from "../../mcp-server/src/client.js";
import { AuthRequiredError, LoginFlowError } from "./auth/errors.js";

export const EXIT_OK = 0;
export const EXIT_API_ERROR = 1;
export const EXIT_USAGE = 2;
export const EXIT_AUTH = 3;

export interface RenderedError {
  lines: string[];
  exitCode: number;
}

const ROLE_HINT =
  "Only workspace owners and admins can use the Scribe API — ask an owner/admin " +
  "to change your role, then run scribe login again.";

export function renderError(err: unknown, opts: { role?: string } = {}): RenderedError {
  if (err instanceof AuthRequiredError) {
    return { lines: [err.message], exitCode: EXIT_AUTH };
  }
  if (err instanceof LoginFlowError) {
    return { lines: [`Login failed: ${err.message}`], exitCode: EXIT_API_ERROR };
  }
  if (err instanceof ScribeApiError) {
    return renderApiError(err, opts);
  }
  const message = err instanceof Error ? err.message : String(err);
  return { lines: [`Unexpected error: ${message}`], exitCode: EXIT_API_ERROR };
}

function renderApiError(err: ScribeApiError, opts: { role?: string }): RenderedError {
  const lines: string[] = [];

  switch (err.status) {
    case 401:
      // A held token the API rejects = the session is no longer valid.
      lines.push("The Scribe API rejected your credentials. Run: scribe login");
      return { lines, exitCode: EXIT_AUTH };
    case 403: {
      if (err.code === "feature_unavailable") {
        lines.push(err.message);
      } else {
        lines.push(err.message);
        const role = opts.role;
        if (role && role !== "owner" && role !== "admin") {
          lines.push(`Your Scribe role ("${role}") doesn't include API access. ${ROLE_HINT}`);
        } else if (!err.remediation) {
          lines.push(ROLE_HINT);
        }
      }
      break;
    }
    case 422: {
      lines.push(err.message);
      for (const detail of err.details ?? []) {
        const allowed = detail.allowed
          ? ` (allowed: ${detail.allowed.map(String).join(", ")})`
          : "";
        lines.push(`  - ${detail.field}: ${detail.message}${allowed}`);
      }
      break;
    }
    case 429: {
      const wait = err.retryAfterSeconds != null ? ` Retry in ${err.retryAfterSeconds}s.` : "";
      lines.push(`${err.message}${wait}`);
      break;
    }
    default:
      lines.push(err.message);
  }

  if (err.remediation) {
    if (err.remediation.message) lines.push(err.remediation.message);
    if (err.remediation.dashboard_url) lines.push(`Open: ${err.remediation.dashboard_url}`);
  }
  return { lines, exitCode: EXIT_API_ERROR };
}
