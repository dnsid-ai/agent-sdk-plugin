# Giving an agent a DNSid identity

This guide gives an agent built with the Claude Agent SDK a DNSid identity,
using the DNSid plugin for the Agent SDK. The plugin does three things: it
publishes the agent's identity, it verifies other agents before the agent calls
them, and it signs what the agent sends so other agents can verify it. By the
end, you will know what each one does and how to read what it reports.

The guide follows one small program, `alice.ts`, an agent named Alice, written
in section 2. Each section runs it with a different prompt.

Everything runs on DNSid Local, a complete DNSid system in Docker on your
machine. Where production differs, a short **In production** note says how.

## Prerequisites

- Docker
- Node 22.18 or later
- Model credentials for the Agent SDK: `ANTHROPIC_API_KEY` or
  `CLAUDE_CODE_OAUTH_TOKEN`, in your environment or in a `.env` file in the
  directory section 2 makes.
- The `dnsid` command-line tool. Build it from the `dnsid` repo with
  `make build` and add `bin/dnsid` to your PATH.

## 1. Start DNSid Local and register an agent

DNSid Local runs a registry, a DNS server, a transparency log, and an HTTPS
proxy with its own certificate authority, in Docker. Agents on it are real DNSid
identities that only your machine can resolve.

Start it:

```sh
dnsid local up
```

> **TODO (for us, remove before publishing).** `local up` pulls
> `ghcr.io/identity-digital/dnsid-local-registry:main`. The fix for the status
> document, dnsid PR #2371, is merged. On the next run, make sure that a
> verifier can verify a local identity with that image, then remove this note.

A DNSid identity belongs to an agent, but an organization answers for it: the
**accountable entity**, which owns the agent's domain. The **registry** is the
DNSid service that manages identities for that organization. `local up` creates
one organization, with the id `dnsid.test`, and every agent you add belongs to
it.

Register two agents, Alice and Bob:

```sh
dnsid local agent add alice --upstream http://localhost:3001
dnsid local agent add bob   --upstream http://localhost:3002
```

`agent add alice` generated her keypair, the **operational key**, in
`~/.dnsid-local/agents/alice.dev.dnsid.test/`, and registered the public key.
The registry lists her as `VERIFIED`: accepted, not yet published.

Every command from here on runs as Alice. `dnsid local run alice -- <cmd>` sets
her environment: her key directory, and how to reach DNSid Local.

Ask the registry for Alice's status:

```sh
dnsid local run alice --port 3001 -- dnsid status --domain alice.dev.dnsid.test
```

```
Agent:       ag-...
Domain:      alice.dev.dnsid.test
Status:      VERIFIED
Environment: production
Created:     2026-09-15 04:52:51 +0000 UTC
Updated:     2026-09-15 04:52:51 +0000 UTC
Managed:     dnsid

Transparency Log:
  Log reference (lr=): c2sp-tlog:testnet:https://registry.dev.dnsid.test#ag-...
  Stream explorer:     http://127.0.0.1:7755/streams/alice.dev.dnsid.test

Next: run `dnsid log issue --domain alice.dev.dnsid.test` to countersign the transparency-log ISSUANCE.
```

The "Next" line is what section 3 automates.

> **In production.** The same steps against the hosted registry:
>
> ```sh
> dnsid auth login
> dnsid init --env production --domain agent.example.com
> dnsid verify
> dnsid challenge
> export DNSID_CONFIG_DIR=~/.dnsid/agent.example.com
> ```
>
> `init` writes the same three files. `verify` and `challenge` prove you control
> the domain and the key, and the registry publishes real DNS records. The
> accountable entity is your organization. There is no `local run`.
> `DNSID_CONFIG_DIR` is the only variable to set.
>
> **TODO (for us).** Not run. The commands come from `dnsid/internal/cli` and
> `dnsid/WALKTHROUGH.md`, which only exercised `--env sandbox`. Run the
> own-domain path once before publishing.

## 2. Add the plugin

Make a directory for Alice, and install the Agent SDK and the plugin:

```sh
mkdir alice && cd alice
npm init -y && npm pkg set type=module
npm install @anthropic-ai/claude-agent-sdk @dnsid-ai/agent-sdk-plugin
```

> **TODO (for us, remove before publishing).** The plugin is not on npm. Until
> then, install it from a sibling checkout:
>
> ```sh
> git clone git@github.com:dnsid-ai/agent-sdk-plugin.git && (cd agent-sdk-plugin && npm install)
> mkdir alice && cd alice && npm init -y && npm pkg set type=module
> npm install @anthropic-ai/claude-agent-sdk ../agent-sdk-plugin
> ```

Save this as `alice.ts`:

```ts
/**
 * Alice: an Agent SDK program with the DNSid plugin loaded. The guide runs it
 * with a different prompt per section; the program never changes.
 *
 *   dnsid local run alice --port 3001 -- node alice.ts '<prompt>'
 */
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';

const prompt = process.argv[2] ?? 'Say hello and stop.';
const pluginRoot = fileURLToPath(
  new URL('.', import.meta.resolve('@dnsid-ai/agent-sdk-plugin/package.json')),
);

// DNSid Local only: the registry expects its HTTPS name as the token audience,
// but `dnsid local run` sets DNSID_REGISTRY_URL to a local HTTP port.
const zone = process.env.DNSID_TESTNET_ZONE;
if (zone) {
  process.env.DNSID_AGENT_AUTH_AUDIENCE ??= `https://registry.${zone}`;
}

for await (const message of query({
  prompt,
  options: {
    plugins: [{ type: 'local', path: pluginRoot }],
    allowedTools: ['mcp__plugin_dnsid_dnsid__fetch'],
    maxTurns: 6,
  },
})) {
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') console.log(block.text);
    }
  }
  if (message.type === 'result' && message.subtype !== 'success') {
    console.error('result:', message.subtype);
  }
}
```

A plain `query()` program with the plugin as one entry in `plugins:`. The one
tool it allows is the plugin's own, `fetch`. Every command from here on runs in
this directory.

Run it as Alice. The prompt is the first argument:

```sh
dnsid local run alice --port 3001 -- node --env-file-if-exists=.env alice.ts \
  'What does the DNSid line at the start of this session say about your own identity? Quote it and stop.'
```

Alice quotes:

```
DNSid: this agent is alice.dev.dnsid.test. alice.dev.dnsid.test: ISSUANCE accepted into the transparency log (c2sp-tlog:testnet:https://registry.dev.dnsid.test#ag-...); the registry is publishing its DNS record.
```

That line came from the plugin. Section 3 explains what it means.

## 3. Bring the agent online

At session start, the plugin made Alice live. Live means her identity record is
in DNS. Look it up:

```sh
dig @127.0.0.1 -p 7753 _dnsid.alice.dev.dnsid.test TXT +short
```

```
"v=dnsid-draft-01;ek=https://dnsid.dnsid.test/.well-known/dnsid-ek.json;gi=dnsid.test;ku=https://alice.dev.dnsid.test/.well-known/jwks.json;lr=c2sp-tlog:testnet:https://registry.dev.dnsid.test#ag-...;sg=...;su=https://registry.dev.dnsid.test/v1/status/alice.dev.dnsid.test"
```

One record, five fields a peer uses.

- `ku`: where Alice's public key is.
- `su`: where her current status is. Right now it says `ACTIVE`.
- `ek`: where the accountable entity's public key is. That key, the **entity
  key**, signed this record, and the signature is `sg`. The registry holds the
  entity key.
- `lr`: where her history is. It names a **transparency log**, an append-only
  public logbook of identity events, and her stream in it.

Before this run, DNS had no record for Alice, and her stream in the log was
empty. The record is only valid once the stream holds an **ISSUANCE** event, the
entry that starts an identity's history. The plugin saves the event it submitted
as `issuance.json` in her key directory. Decode it:

```sh
dnsid local run alice --port 3001 -- node -p \
  'JSON.parse(Buffer.from(require(process.env.DNSID_CONFIG_DIR + "/issuance.json").entryBytes, "base64url"))'
```

```
{
  type: 'ISSUANCE',
  fqdn: 'alice.dev.dnsid.test',
  gi: 'dnsid.test',
  ek: { kty: 'OKP', crv: 'Ed25519', kid: '4od3n...', x: 'Fg8O...' },
  ku: { kty: 'OKP', crv: 'Ed25519', kid: 'Scjox...', x: 'hf07...' },
  lr: 'c2sp-tlog:testnet:https://registry.dev.dnsid.test#ag-...',
  seq: 0,
  ts: 1789448219,
  sigs: {
    ae: { kid: '4od3n...', sig: 'uel1h...' },
    op: { kid: 'Scjox...', sig: 'H2p3W...' }
  }
}
```

The event pins both public keys, `ek` and `ku`, and carries two signatures: `ae`
(accountable entity) by the entity key, `op` (operational) by Alice's key.
`seq: 0` makes it the first event in her stream. Anyone can read the stream. A
second ISSUANCE for Alice, from a registry that issued another key in her name,
would be visible there.

The log follows the public C2SP transparency-log specs (`tlog-checkpoint`,
`tlog-tiles`, `tlog-witness`, at <https://c2sp.org>). The entry format is
DNSid's own, defined in the DNSid specification's `c2sp-tlog` log-method
extension.

> **TODO (for us).** Link the DNSid spec once its public location is known.

The registry holds one key and Alice holds the other, so neither can produce the
ISSUANCE alone. The plugin got the event signed by the registry, signed it with
Alice's key, and submitted it to the log, in four steps.

1. It asked the registry for Alice's registration status and got `VERIFIED`.
2. It asked the registry to prepare Alice's ISSUANCE event. The registry built
   the event, signed it with the entity key, and returned it. Nothing was
   written to the log yet.
3. It signed the event with Alice's operational key and submitted it to the log,
   authenticated to the registry with a short-lived token signed by the same
   key.
4. The log accepted the event. The registry moved Alice to `READY` and published
   her DNS record.

Run the section 2 command again. Alice quotes:

```
DNSid: this agent is alice.dev.dnsid.test. alice.dev.dnsid.test is online (READY).
```

The plugin found her `READY` and only reported. Without the plugin, the CLI does
the same four steps: `dnsid log issue --domain alice.dev.dnsid.test`.

> **In production.** The same code runs. `DNSID_CONFIG_DIR` points at the
> directory `dnsid init` wrote. The plugin authenticates to the registry at
> `https://api.dnsid.ai` unless `DNSID_AGENT_AUTH_AUDIENCE` names another
> registry. One registry setting, `TLOG_REQUIRE_ISSUANCE`, decides whether an
> agent waits at `VERIFIED` until its ISSUANCE is accepted. DNSid Local sets it
> on. If your registry sets it off, `dnsid verify` alone reaches `READY`, and
> the plugin still submits the ISSUANCE.

## 4. Verify a peer

Before every call to another agent, the plugin verifies that agent's identity.
Bob is registered but not online: section 1 left him `VERIFIED`, and no one
submitted his ISSUANCE. Ask Alice to call him:

```sh
dnsid local run alice --port 3001 -- node --env-file-if-exists=.env alice.ts \
  'Use the dnsid fetch tool to GET https://bob.dev.dnsid.test/. Quote the response body, or the denial reason, and stop.'
```

Alice is refused and quotes:

```
DNSid: bob.dev.dnsid.test: DNSResolution: no _dnsid TXT record found for bob.dev.dnsid.test
```

> **TODO (for us).** This output is from 2026-09-15 through `WebFetch`, which
> the same hook guards. Run it once through the `fetch` tool on a fresh DNSid
> Local before publishing.

A refusal has the shape `DNSid: <host>: <code>: <detail>`. The host is the
hostname of the URL. The path, the port, and the IP address play no part. The
code names the step that failed, of four:

1. Fetch the `_dnsid` TXT record at the host.
2. Fetch the entity key and the agent key the record names, and verify the
   record's signature.
3. Fetch the agent's status document. A revoked or retired agent fails here.
4. Verify the agent's stream in the transparency log.

Only an agent that passes all four, with state `ACTIVE`, may be called. The
plugin caches a success until the verdict expires, which the SDK sets from the
DNS TTL and the certificate expiry, and a failure for 30 seconds. A refusal is
the peer's to fix. The code tells its operator where: the record, a key, the
status, or the log.

One more outcome exists: the plugin could not verify at all, for example the
record names a transparency log the plugin does not trust. The reason then
contains `Cannot verify`. This is not a statement about the peer. By default it
is still a refusal. The environment variable `DNSID_ON_UNVERIFIABLE=ask` makes
it a permission prompt instead. Nothing makes it an allow.

The plugin verifies `WebFetch` the same way. The example program does not allow
that tool: `WebFetch` resolves names with your machine's DNS, which does not
know DNSid Local's zone. Two things the plugin does not verify. It does not see
`Bash`, so `curl` in a shell command is not verified. And an MCP tool whose
arguments carry no URL is verified only if the environment variable
`DNSID_MCP_SERVER_DOMAINS` maps its server to a domain.

Now bring Bob online. The plugin did this for Alice at session start. Bob's
program has no plugin, so the CLI does the same four steps:

```sh
dnsid local run bob --port 3002 -- dnsid log issue --domain bob.dev.dnsid.test
```

```
Transparency-log ISSUANCE accepted for bob.dev.dnsid.test.
Log reference: c2sp-tlog:testnet:https://registry.dev.dnsid.test#ag-...@4
Stream explorer: http://127.0.0.1:7755/streams/bob.dev.dnsid.test
Run `dnsid status --domain bob.dev.dnsid.test` to confirm the agent reaches READY.
```

DNSid Local forwards HTTPS for `bob.dev.dnsid.test` to the `--upstream` from
section 1, port 3002. Bob is a plain HTTP server there. Save this as `bob.ts`,
next to `alice.ts`:

```ts
/**
 * Bob: the peer Alice calls. A plain HTTP server behind DNSid Local's proxy.
 * GET answers anyone; POST must carry a DNSid HTTP message signature, and the
 * reply names who sent it.
 *
 *   dnsid local run bob --port 3002 -- node bob.ts
 */
import { createServer, type IncomingMessage } from 'node:http';
import { text } from 'node:stream/consumers';
import { VerificationError } from '@dnsid-ai/sdk';
import { HttpSignaturesProfile } from '@dnsid-ai/http-signatures';
import { createVerifier } from '@dnsid-ai/agent-sdk-plugin/verify';

export function handler(domain: string, bob: HttpSignaturesProfile) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'GET') return new Response(`hello from ${domain}\n`);
    try {
      const sender = await bob.verifySignedHttpRequest(request.clone());
      console.log(
        `verified signed ${request.method} ${new URL(request.url).pathname} from ${sender.domain}`,
      );
      return Response.json({ from: sender.domain, received: await request.text() });
    } catch (error) {
      if (!(error instanceof VerificationError)) throw error;
      return new Response(`DNSid: ${error.code}: ${error.message}\n`, { status: 401 });
    }
  };
}

// The proxy terminates TLS, so the request arrives as http. The signature
// covers the URL Alice used, which is https at Bob's domain.
async function toRequest(req: IncomingMessage, domain: string): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
  }
  const method = req.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await text(req);
  return new Request(`https://${domain}${req.url ?? '/'}`, { method, headers, body });
}

if (import.meta.main) {
  const domain = process.env.DNSID_DOMAIN;
  if (!domain) throw new Error('DNSID_DOMAIN is not set');

  const respond = handler(
    domain,
    new HttpSignaturesProfile({ domain, identityResolver: await createVerifier() }),
  );
  const port = Number(process.env.PORT ?? 3002);
  createServer(async (req, res) => {
    const response = await respond(await toRequest(req, domain));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  }).listen(port, () => console.log(`${domain} listening on ${port}`));
}
```

It answers `GET` to anyone, and verifies the signature on every `POST`. Section
5 uses the second half. Install the two DNSid packages it uses, and start it in
another terminal:

```sh
npm install @dnsid-ai/sdk @dnsid-ai/http-signatures
dnsid local run bob --port 3002 -- node bob.ts
```

```
bob.dev.dnsid.test listening on 3002
```

Run the first prompt of this section again. Alice quotes Bob's reply:

```
hello from bob.dev.dnsid.test
```

Bob answered because his identity verified. He does not yet know who asked. The
`fetch` tool already told him. Section 5 shows how.

> **In production.** Nothing changes. `DNSID_ON_UNVERIFIABLE` and
> `DNSID_MCP_SERVER_DOMAINS` are the only settings this feature reads.

## 5. Sign a request

The `fetch` tool signs every request with Alice's operational key. Ask Alice to
`POST` to Bob:

```sh
dnsid local run alice --port 3001 -- node --env-file-if-exists=.env alice.ts \
  'Use the dnsid fetch tool to POST {"hello":"bob"} to https://bob.dev.dnsid.test/ as application/json. Quote the response body and stop.'
```

Alice quotes Bob's reply:

```json
{ "from": "alice.dev.dnsid.test", "received": "{\"hello\":\"bob\"}" }
```

Bob's terminal prints:

```
verified signed POST / from alice.dev.dnsid.test
```

Bob read the sender from the request. The tool added three headers before it
sent it:

```
content-digest: sha-256=:5lvq...:
signature-input: sig1=("@method" "@authority" "@target-uri" "content-digest" "content-type");keyid="alice.dev.dnsid.test#Scjox...";alg="ed25519";created=1789527598;nonce="uUwm..."
signature: sig1=:2RIu...:
```

This is an HTTP message signature (RFC 9421). `signature-input` lists what
`signature` covers: the method, the host, the full URL, a SHA-256 digest of the
body, and every header Alice gave the tool. `keyid` names the signer and her
key. `Scjox...` is the `kid` of the `ku` key in her ISSUANCE in section 3.
`created` lets Bob reject an old request.

Bob verifies with one call, in `bob.ts`:

```ts
const sender = await bob.verifySignedHttpRequest(request);
```

The call reads the domain from `keyid`, verifies Alice's identity in the four
steps of section 4, fetches her public key from her `ku` URL, and verifies the
signature with it. `sender.domain` is `alice.dev.dnsid.test`. A `POST` without a
signature does not reach that line:

```sh
curl -s -X POST -H 'content-type: application/json' -d '{"hello":"bob"}' http://127.0.0.1:3002/
```

```
DNSid: SignatureInvalid: missing Signature or Signature-Input headers
```

Alice can prove who she is because she holds `private.jwk`. Section 7 moves that
key out of a file.

> **In production.** Nothing changes. The tool reads no setting of its own.

## 6. What you built

Three parties, two keys, one record.

- The **registry** holds the entity key. It signed Alice's `_dnsid` record and
  the `ae` signature on her ISSUANCE, and it serves her status.
- **Alice** holds the operational key. It signed the `op` signature on her
  ISSUANCE and every request the `fetch` tool sends.
- The **transparency log** holds her ISSUANCE, which pins both public keys.
- **Bob** holds nothing of Alice's. From `keyid` in one request he found her
  record, both keys, her status, and her stream, and verified the signature.

The plugin did the first three for Alice at session start, verified Bob before
she called him, and signed what she sent. The two sections left are for
production: where the operational key lives, and what to set.

## 7. Keys

Sections 3 and 5 signed with `private.jwk`, the operational key on disk. The
plugin can sign with a key in AWS KMS instead. Set one variable:

```sh
export DNSID_AWS_KMS_KEY_ID=arn:aws:kms:us-east-1:123456789012:key/...
```

The plugin then never reads `private.jwk`. Every signature, the ISSUANCE in
section 3 and the request in section 5, is an AWS `Sign` call, and the key never
leaves KMS. AWS credentials come from the standard AWS environment. The key must
be an Ed25519 key, or an ECDSA P-256 key with
`DNSID_AWS_KMS_ALGORITHM=ECDSA_SHA_256`.

The registry must hold that key's public half, so it is the key `ku` points at.
`dnsid init` generates a local key and registers that one. Register a KMS key
through the registry API.

> **TODO (for us).** Not run against KMS. `dnsid init` has no option to register
> an existing public key, and the test for `src/shared/key-provider.ts` uses a
> fake KMS only. Run once with a real key before publishing, and write the
> registration step from that run.

## 8. Production checklist

All plugin configuration is environment variables that start with `DNSID_`. The
README lists every one. `local run` sets the DNSid Local ones. In production,
`DNSID_CONFIG_DIR` is the only variable an agent with a key file needs. A bad
value fails the hook, and the hook denies.

Before the first production run:

1. `dnsid init`, `dnsid verify`, `dnsid challenge` for your domain, as in
   section 1.
2. Set `DNSID_CONFIG_DIR`. Nothing from `local run` applies.
3. Run the section 2 prompt. The DNSid line must say `is online (READY)`.
4. From another agent with the plugin, run the section 4 `fetch` prompt against
   your domain. It must be allowed.
5. If your agent calls MCP servers that are agents, set
   `DNSID_MCP_SERVER_DOMAINS`.
