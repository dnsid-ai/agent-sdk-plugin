/**
 * The agent's self-authentication token: a JWT signed by its own operational
 * key. The registry checks it against the key it has on file for `iss`, so
 * the agent can act on its own identity without an organization credential.
 *
 * Rules are the registry's (`dnsid/internal/auth/agent_auth.go`): `iss` and
 * `sub` are the agent domain, `aud` is the registry's canonical origin,
 * `exp - iat` is at most 15 minutes, `jti` is single-use, and `purpose`
 * names the one operation an agent may authorize itself for.
 */
import { jwkSignatureAlg, toBase64Url, type KeyProvider } from '@identity-digital/dnsid';

const b64 = (s: string) => toBase64Url(new TextEncoder().encode(s));

export interface AgentJwtOptions {
  domain: string;
  audience: string;
  keyProvider: KeyProvider;
  purpose?: string;
  /** Seconds. The registry rejects more than 900. */
  ttlSeconds?: number;
  now?: () => number;
}

export async function mintAgentJwt({
  domain,
  audience,
  keyProvider,
  purpose = 'tlog:issuance',
  ttlSeconds = 300,
  now = Date.now,
}: AgentJwtOptions): Promise<string> {
  if (ttlSeconds <= 0 || ttlSeconds > 900) {
    throw new Error('agent JWT lifetime must be 1..900 seconds');
  }

  const key = await keyProvider.signingKey();
  const iat = Math.floor(now() / 1000);
  const header = { alg: jwkSignatureAlg(key), typ: 'JWT', kid: key.kid };
  const claims = {
    iss: domain,
    sub: domain,
    aud: audience,
    jti: crypto.randomUUID(),
    iat,
    exp: iat + ttlSeconds,
    purpose,
  };

  const signingInput = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(claims))}`;
  const signature = await keyProvider.sign(new TextEncoder().encode(signingInput));
  return `${signingInput}.${toBase64Url(signature)}`;
}

/**
 * A fetch that puts a fresh agent JWT on every mutating request. One token
 * per request, because the registry burns each `jti` on first use.
 */
export function agentAuthFetch(
  base: typeof fetch,
  mint: () => Promise<string>,
): typeof fetch {
  return async (input, init) => {
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();

    if (method === 'GET' || method === 'HEAD') return base(input, init);

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set('Authorization', `Bearer ${await mint()}`);

    return base(input, { ...init, headers });
  };
}
