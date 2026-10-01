/** The selector: nothing without the variable, a working KMS provider with it, against a stub KMS. */
import { describe, expect, it } from 'vitest';
import { toArrayBuffer } from '@dnsid-ai/sdk';

import { keyProviderFromEnv } from '../../src/shared/key-provider.ts';
import { stubKms } from './fixtures/kms.ts';

describe('keyProviderFromEnv', () => {
  it('is undefined when no KMS key is named, so the file is used', async () => {
    expect(await keyProviderFromEnv({})).toBeUndefined();
  });

  it('signs with the KMS key when DNSID_AWS_KMS_KEY_ID is set', async () => {
    const { facade, publicKey } = await stubKms();
    const provider = await keyProviderFromEnv(
      { DNSID_AWS_KMS_KEY_ID: 'alias/alice' },
      facade,
    );
    const key = await provider!.signingKey();
    expect(key).toMatchObject({
      kty: 'OKP',
      crv: 'Ed25519',
      kid: 'arn:aws:kms:eu-west-1:1:key/alias/alice',
    });
    const message = new TextEncoder().encode('hello');
    const signature = await provider!.sign(message);
    expect(
      await crypto.subtle.verify(
        'Ed25519',
        publicKey,
        toArrayBuffer(signature),
        toArrayBuffer(message),
      ),
    ).toBe(true);
  });

  it('refuses an algorithm KMS does not offer for DNSid keys', async () => {
    await expect(
      keyProviderFromEnv({
        DNSID_AWS_KMS_KEY_ID: 'k',
        DNSID_AWS_KMS_ALGORITHM: 'RSASSA_PSS_SHA_256',
      }),
    ).rejects.toThrow(/DNSID_AWS_KMS_ALGORITHM/);
  });
});
