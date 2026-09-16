/**
 * Selects the key that signs for this agent. If DNSID_AWS_KMS_KEY_ID is set,
 * the agent signs with that AWS KMS key. If it is not set, this returns
 * undefined and the caller signs with the key file. `agentIdentity` in
 * `identity.ts` is the one caller.
 */
import type { KeyProvider } from '@identity-digital/dnsid';
import type {
  AwsKmsFacade,
  AwsKmsSigningAlgorithm,
  AwsSdkKmsClient,
} from '@identity-digital/dnsid-key-aws';

const ALGORITHMS = new Set<AwsKmsSigningAlgorithm>(['ED25519_SHA_512', 'ECDSA_SHA_256']);

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function algorithmFromEnv(env: NodeJS.ProcessEnv): AwsKmsSigningAlgorithm {
  const algorithm = (env.DNSID_AWS_KMS_ALGORITHM ?? 'ED25519_SHA_512') as AwsKmsSigningAlgorithm;
  if (!ALGORITHMS.has(algorithm)) {
    throw new Error(`DNSID_AWS_KMS_ALGORITHM must be one of ${[...ALGORITHMS].join(', ')}`);
  }
  return algorithm;
}

// The imports are here, not at the top of the file, so that a file-backed
// deployment never loads the AWS SDK.
async function awsKmsFacade(): Promise<AwsKmsFacade> {
  const { AwsSdkKmsFacade } = await import('@identity-digital/dnsid-key-aws');
  const { KMSClient } = await import('@aws-sdk/client-kms');
  // The linked dnsid-ts checkout has its own copy of @aws-sdk/client-kms, so
  // TypeScript sees two different KMSClient types. Remove the cast when
  // dnsid-ts is on npm.
  return new AwsSdkKmsFacade(new KMSClient({}) as unknown as AwsSdkKmsClient);
}

/**
 * `facade` is the KMS connection. Pass one, or this builds one from the AWS
 * SDK. The key lists come from the environment. Key rotation is the
 * operator's job.
 */
export async function keyProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  facade?: AwsKmsFacade,
): Promise<KeyProvider | undefined> {
  const activeKeyId = env.DNSID_AWS_KMS_KEY_ID;
  if (!activeKeyId) return;

  const algorithm = algorithmFromEnv(env);
  const { AwsKmsKeyProvider } = await import('@identity-digital/dnsid-key-aws');
  return AwsKmsKeyProvider.load(facade ?? (await awsKmsFacade()), {
    activeKeyId,
    algorithm,
    retainedKeyIds: list(env.DNSID_AWS_KMS_RETAINED_KEY_IDS),
    pendingKeyIds: list(env.DNSID_AWS_KMS_PENDING_KEY_IDS),
  });
}
