/**
 * `recordJSON` and `errJSON` reimplement the same-named functions in
 * `dnsid-sdk-compliance/shims/ts/shim.mjs`, so a record printed here is
 * comparable to one printed by any DNSid SDK.
 * The shim is the authority: mirror it.
 */
import { z } from 'zod';
import type { DnsIdTxtRecord } from '@identity-digital/dnsid';

/** The shim's rule: absent and empty both become `null`. */
const optional = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value;

const tag = z.string().nullable();

/** A parsed record, in the same JSON format that every DNSid SDK produces. */
export const record = z.object({
  v: z.string(),
  gi: tag,
  oi: tag,
  ek: tag,
  ku: tag,
  lr: tag,
  su: tag,
  sg: tag,
  fl: tag,
  ka: tag,
  cu: tag,
  unknown: z.record(z.string(), z.string()).describe('Unrecognized tags, unchanged.'),
});

export type RecordJSON = z.infer<typeof record>;

/**
 * Converts a record to JSON. Each key is a DNS tag name, and unrecognized tags
 * go under `unknown`.
 */
export function recordJSON(record: DnsIdTxtRecord): RecordJSON {
  return {
    v: record.v,
    gi: optional(record.gi),
    oi: null, // `oi` is draft-00's governance identifier, replaced by `gi` and `ek`.
    ek: optional(record.ek),
    ku: optional(record.ku),
    lr: optional(record.lr),
    su: optional(record.su),
    sg: optional(record.sg),
    fl: optional(record.fl),
    ka: optional(record.ka),
    cu: optional(record.cu),
    unknown: Object.fromEntries(record.unknownTags),
  };
}

/** A stage that threw an error. `error` names the SDK error class. `message` gives context. */
export const failed = z.object({
  ok: z.literal(false),
  error: z.string(),
  message: z.string(),
});

export type ErrJSON = z.infer<typeof failed>;

/** `error` is the SDK's error class name. A program should branch on `error`, not on `message`. */
export function errJSON(error: unknown): ErrJSON {
  const name = (error as Error | undefined)?.name;
  return {
    ok: false,
    error: name && name !== 'Error' ? name : 'Error',
    message: String((error as Error | undefined)?.message ?? error),
  };
}
