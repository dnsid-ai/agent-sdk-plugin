/** The durable operation survives a round trip byte for byte, and create is create-once. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ManagedIssuanceState } from '@dnsid-ai/sdk';

import { issuanceFile } from '../../src/online/issuance-file.ts';

const intent: ManagedIssuanceState = {
  domain: 'alice.example.com',
  governanceId: 'example.com',
  idempotencyKey: 'bring-online:alice.example.com',
  entityKid: 'ek',
  entityThumbprint: 'et',
  operationalKid: 'ok',
  operationalThumbprint: 'ot',
  activated: false,
};

describe('issuanceFile', () => {
  it('loads nothing, creates once, persists bytes exactly', async () => {
    const file = issuanceFile(
      join(mkdtempSync(join(tmpdir(), 'iss-')), 'sub', 'issuance.json'),
    );
    expect(await file.loadIssuance()).toBeUndefined();
    expect(await file.createIssuance(intent)).toBeUndefined();
    expect(await file.createIssuance({ ...intent, entityKid: 'other' })).toEqual(intent);

    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
    await file.persistIssuance({
      ...intent,
      entryBytes: bytes,
      entryHash: 'h',
      logReference: 'lr',
    });
    const loaded = await file.loadIssuance();
    expect(loaded?.entryBytes).toEqual(bytes);
    expect(loaded).toMatchObject({
      entryHash: 'h',
      logReference: 'lr',
      activated: false,
    });
  });
});
