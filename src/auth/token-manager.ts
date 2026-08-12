/**
 * Access-token supply with auto-refresh.
 *
 * WorkOS access tokens live ~5 minutes and refresh tokens ROTATE on every
 * refresh, so a naive concurrent refresh bricks the session: the loser spends
 * a dead refresh token. Hence three layers:
 *   1. freshness margin (60s) so a token handed out survives one command's
 *      retries/backoff;
 *   2. in-process single-flight (memoized promise);
 *   3. cross-process lock file + mandatory RE-READ after acquiring — the other
 *      process may have already refreshed and persisted the rotated token.
 */

import { envTag, type CliEnv } from "../cli-env.js";
import { AuthRequiredError } from "./errors.js";
import type { CredentialStore, StoredTokens } from "./store.js";
import { refreshTokens, TokenEndpointError } from "./tokens.js";

const SKEW_MS = 60_000;

const NOT_SIGNED_IN = (env: CliEnv) => `You're not signed in${envTag(env)}. Run: scribe login`;
const SESSION_EXPIRED = (env: CliEnv) =>
  `Your session has expired${envTag(env)}. Run: scribe login`;

function isFresh(tokens: StoredTokens): boolean {
  return Date.now() < tokens.expiresAt - SKEW_MS;
}

export class TokenManager {
  private inflight?: Promise<StoredTokens>;

  constructor(
    private readonly env: CliEnv,
    private readonly store: CredentialStore,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getAccessToken(): Promise<string> {
    return (await this.getTokenSet()).accessToken;
  }

  /** Full token set (whoami needs the denormalized claims). */
  async getTokenSet(): Promise<StoredTokens> {
    const { tokens } = await this.store.getEnv(this.env.name);
    if (!tokens) throw new AuthRequiredError(NOT_SIGNED_IN(this.env));
    if (isFresh(tokens)) return tokens;

    this.inflight ??= this.refreshUnderLock().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  /**
   * Adapter for ScribeClient's TokenProvider: resolves to null instead of
   * throwing so un-authed calls surface as the client's clean 401 error path
   * (commands pre-warm the token first, which throws the friendly message).
   */
  tokenProvider(): () => Promise<string | null> {
    return async () => {
      try {
        return await this.getAccessToken();
      } catch (err) {
        if (err instanceof AuthRequiredError) return null;
        throw err;
      }
    };
  }

  private async refreshUnderLock(): Promise<StoredTokens> {
    return this.store.withLock(async () => {
      // Re-read: a concurrent process may have refreshed while we waited.
      const { tokens, registration } = await this.store.getEnv(this.env.name);
      if (!tokens) throw new AuthRequiredError(NOT_SIGNED_IN(this.env));
      if (isFresh(tokens)) return tokens;
      if (!registration) throw new AuthRequiredError(NOT_SIGNED_IN(this.env));

      try {
        const rotated = await refreshTokens(registration, tokens, {
          resource: this.env.resourceIndicator,
          fetchImpl: this.fetchImpl,
        });
        // Persist BEFORE resolving: the rotated refresh token must never be
        // handed out while the dead one is still on disk.
        await this.store.saveTokens(this.env.name, rotated);
        return rotated;
      } catch (err) {
        if (err instanceof TokenEndpointError && err.code === "invalid_grant") {
          await this.store.clearTokens(this.env.name);
          throw new AuthRequiredError(SESSION_EXPIRED(this.env));
        }
        if (err instanceof TokenEndpointError && err.code === "invalid_client") {
          // Registration purged server-side; the refresh token died with it.
          await this.store.clearRegistration(this.env.name);
          await this.store.clearTokens(this.env.name);
          throw new AuthRequiredError(SESSION_EXPIRED(this.env));
        }
        throw err;
      }
    });
  }
}
