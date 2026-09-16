/**
 * Verdict cache shared across hook runs. Each hook run is a fresh process, so
 * the cache is a JSON file. Entries are keyed by domain and expire at the
 * verdict's own `expiresAt`. The SDK sets `expiresAt` to the earliest of the
 * DNS TTL, the TLS certificate expiry, and the record's `ka` bound.
 *
 * Rules:
 * - A success is cached until `expiresAt`.
 * - A non-transient failure is cached for FAILURE_TTL_MS. A model often
 *   retries a failed call at once. Without this, each retry would repeat the
 *   full verification against the peer's DNS, key server, status URL, and log.
 * - A transient failure is not cached.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { VerifyAgentIdentityOutput } from './verdict.ts';

const FAILURE_TTL_MS = 30_000;

type Entries = Record<string, { verdict: VerifyAgentIdentityOutput; expiresAt: number }>;

export class VerdictCache {
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  private load(): Entries {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Entries;
    } catch {
      return {};
    }
  }

  get(domain: string, now = Date.now()): VerifyAgentIdentityOutput | undefined {
    const entry = this.load()[domain];
    return entry && entry.expiresAt > now ? entry.verdict : undefined;
  }

  set(domain: string, verdict: VerifyAgentIdentityOutput, now = Date.now()): void {
    const expiresAt = verdict.ok
      ? Date.parse(verdict.expiresAt)
      : verdict.transient
        ? Number.NaN
        : now + FAILURE_TTL_MS;
    if (Number.isNaN(expiresAt) || expiresAt <= now) return;

    const entries = this.load();
    for (const [key, entry] of Object.entries(entries)) {
      if (entry.expiresAt <= now) delete entries[key];
    }
    entries[domain] = { verdict, expiresAt };

    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(entries));
    renameSync(tmp, this.file);
  }
}
