/** An AWS KMS stand-in that signs with an in-memory Ed25519 key. */
import { vi } from 'vitest';
import { toArrayBuffer } from '@dnsid-ai/sdk';
import type { AwsKmsFacade } from '@dnsid-ai/key-aws';

export async function stubKms() {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const facade: AwsKmsFacade = {
    createSigningKey: vi.fn(),
    getPublicKey: vi.fn(async ({ keyId }) => ({
      keyId: 'arn:aws:kms:eu-west-1:1:key/' + keyId,
      publicKey: spki,
      keySpec: 'ECC_NIST_EDWARDS25519',
      keyUsage: 'SIGN_VERIFY',
      signingAlgorithms: ['ED25519_SHA_512'],
    })),
    sign: vi.fn(async ({ message }) => ({
      signature: new Uint8Array(
        await crypto.subtle.sign('Ed25519', pair.privateKey, toArrayBuffer(message)),
      ),
    })),
  };
  return { facade, publicKey: pair.publicKey };
}
