/**
 * Credential storage: one JSON file per user, one node per environment.
 *
 * Protection model matches ~/.aws/credentials and gh's hosts.yml: directory
 * 0700, file 0600, atomic tmp+rename writes, and a loud warning (plus
 * auto-tighten) when a load finds looser permissions. The secrets are a
 * short-lived access token and a rotating, revocable refresh token — an OS
 * keychain was deliberately not used (native-module install pain, and a file
 * fallback would be needed for headless machines anyway).
 */

import { chmodSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ClientRegistration {
  /** The AuthKit domain this client belongs to; a domain change invalidates it. */
  authkitDomain: string;
  clientId: string;
  /** Absent for public clients (token_endpoint_auth_method "none" — the normal case). */
  clientSecret?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: string;
  /** Epoch seconds; 0 = never expires. */
  clientSecretExpiresAt: number;
  registeredAt: string;
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires (computed from expires_in at receipt). */
  expiresAt: number;
  orgId?: string;
  userId?: string;
  email?: string;
  role?: string;
}

export interface EnvCredentials {
  registration?: ClientRegistration;
  tokens?: StoredTokens;
}

export interface CredentialsFile {
  version: 1;
  environments: Record<string, EnvCredentials>;
}

const EMPTY: CredentialsFile = { version: 1, environments: {} };
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 10_000;
const LOCK_POLL_MS = 100;

function defaultConfigDir(): string {
  const override = process.env.SCRIBE_CONFIG_DIR?.trim();
  if (override) return override;
  if (process.platform === "win32" && process.env.APPDATA) {
    return join(process.env.APPDATA, "scribe");
  }
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return join(xdg && xdg !== "" ? xdg : join(homedir(), ".config"), "scribe");
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class CredentialStore {
  readonly dir: string;
  readonly path: string;
  private readonly lockPath: string;

  constructor(dir: string = defaultConfigDir()) {
    this.dir = dir;
    this.path = join(dir, "credentials.json");
    this.lockPath = join(dir, "credentials.json.lock");
  }

  async load(): Promise<CredentialsFile> {
    let text: string;
    try {
      this.warnAndTightenPermissions();
      text = await readFile(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY);
      throw err;
    }
    try {
      const parsed = JSON.parse(text) as CredentialsFile;
      if (parsed && typeof parsed === "object" && parsed.environments) return parsed;
      return structuredClone(EMPTY);
    } catch {
      // Corrupt store: keep the evidence, start clean, and say so once.
      const backup = `${this.path}.corrupt-${Date.now()}`;
      try {
        renameSync(this.path, backup);
        console.error(`[scribe] credentials file was unreadable; moved to ${backup}`);
      } catch {
        // Best effort only.
      }
      return structuredClone(EMPTY);
    }
  }

  async getEnv(name: string): Promise<EnvCredentials> {
    return (await this.load()).environments[name] ?? {};
  }

  async saveRegistration(name: string, registration: ClientRegistration): Promise<void> {
    await this.mutate((file) => {
      file.environments[name] = { ...file.environments[name], registration };
    });
  }

  async saveTokens(name: string, tokens: StoredTokens): Promise<void> {
    await this.mutate((file) => {
      file.environments[name] = { ...file.environments[name], tokens };
    });
  }

  async clearTokens(name: string): Promise<void> {
    await this.mutate((file) => {
      const env = file.environments[name];
      if (env) delete env.tokens;
    });
  }

  async clearRegistration(name: string): Promise<void> {
    await this.mutate((file) => {
      const env = file.environments[name];
      if (env) delete env.registration;
    });
  }

  async clearEnv(name: string): Promise<void> {
    await this.mutate((file) => {
      delete file.environments[name];
    });
  }

  /**
   * Cross-process mutual exclusion via an O_EXCL lock file (pid + timestamp,
   * no secrets). WorkOS rotates refresh tokens, so two processes refreshing
   * concurrently would brick the session — callers wrap refresh in withLock
   * and MUST re-read the store after acquiring (the other process may have
   * already refreshed and persisted a rotated token).
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    this.ensureDir();
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        const handle = await open(this.lockPath, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
        await handle.close();
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        if (this.lockIsStale()) {
          try {
            rmSync(this.lockPath, { force: true });
          } catch {
            // Another process may have removed it first.
          }
          continue;
        }
        if (Date.now() > deadline) {
          throw new Error(
            `Timed out waiting for the credentials lock (${this.lockPath}). ` +
              "If no other scribe process is running, delete the lock file and retry.",
          );
        }
        await sleep(LOCK_POLL_MS);
      }
    }
    try {
      return await fn();
    } finally {
      rmSync(this.lockPath, { force: true });
    }
  }

  private lockIsStale(): boolean {
    try {
      return Date.now() - statSync(this.lockPath).mtimeMs > LOCK_STALE_MS;
    } catch {
      return false;
    }
  }

  private async mutate(apply: (file: CredentialsFile) => void): Promise<void> {
    const file = await this.load();
    apply(file);
    this.write(file);
  }

  /** Atomic write: tmp file in the same dir (0600) then rename over the target. */
  private write(file: CredentialsFile): void {
    this.ensureDir();
    const tmp = `${this.path}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.path);
    if (process.platform !== "win32") chmodSync(this.path, 0o600);
  }

  private ensureDir(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  private warnAndTightenPermissions(): void {
    if (process.platform === "win32") return;
    try {
      const mode = statSync(this.path).mode & 0o777;
      if ((mode & 0o077) !== 0) {
        console.error(
          `[scribe] warning: ${this.path} had permissions ${mode.toString(8)}; tightening to 600.`,
        );
        chmodSync(this.path, 0o600);
      }
    } catch {
      // Missing file — nothing to tighten.
    }
  }
}
