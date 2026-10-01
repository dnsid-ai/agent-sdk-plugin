# Giving an agent a DNSid identity

This guide gives an agent built with the Claude Agent SDK a DNSid identity,
using the DNSid plugin for the Agent SDK. The plugin does three things: it
publishes the agent's identity, it verifies other agents before the agent calls
them, and it signs what the agent sends so other agents can verify it. By the
end, you will know what each one does and how to read what it reports.

The guide follows one small program, `alice.ts`, an agent named Alice, written
in section 2. Each section runs it with a different prompt.

Everything runs on DNSid Local, a complete DNSid system in Docker on your
machine.

## Prerequisites

- Docker
- Node 24 or later
- Optional: model credentials for the Agent SDK, `ANTHROPIC_API_KEY` or
  `CLAUDE_CODE_OAUTH_TOKEN`, in your environment or in a `.env` file in the
  directory section 2 makes. Without them, the Agent SDK uses your Claude Code
  login.
- The `dnsid` command-line tool. Install it as
  [the CLI installation page](https://docs.dnsid.ai/cli-installation) says, for
  example with `brew install dnsid-ai/tap/dnsid`. Then `dnsid --version` shows
  the version.

## 1. Start DNSid Local and register an agent

DNSid Local runs a registry, a DNS server, a transparency log, and an HTTPS
proxy with its own certificate authority, in Docker. Agents on it are real DNSid
identities that only your machine can resolve.

Start it:

```sh
dnsid local up
```

A DNSid identity belongs to an agent, but an organization answers for it: the
**accountable entity**, which owns the agent's domain. The **registry** is the
DNSid service that manages identities for that organization. On DNSid Local,
each agent is its own accountable entity. Alice's id is `alice.test`.

Register two agents, Alice and Bob:

```sh
dnsid local agent add alice --upstream http://localhost:3001
dnsid local agent add bob   --upstream http://localhost:3002
```

`agent add alice` generated her keypair, the **operational key**, in
`~/.dnsid-local/agents/alice.test/`, and registered the public key. The registry
lists her as `VERIFIED`: accepted, not yet published.

Every command from here on runs as Alice. `dnsid local run alice -- <cmd>` sets
her environment: her key directory, and how to reach DNSid Local.

Ask the registry for Alice's status:

```sh
dnsid local run alice --port 3001 -- dnsid status --domain alice.test
```

```
Agent:       ag-...
Domain:      alice.test
Status:      VERIFIED
Environment: production
Created:     2026-10-01 02:41:58.26682155 +0000 UTC
Updated:     2026-10-01 02:41:58.267820007 +0000 UTC
Managed:     dnsid

Transparency Log:
  Log reference (lr=): c2sp-tlog:testnet:https://registry.test#ag-...
  Stream explorer:     http://127.0.0.1:7755/streams/alice.test

Next: run `dnsid log issue --domain alice.test` to countersign the transparency-log ISSUANCE.
```

The "Next" line is what section 3 automates.

## 2. Add the plugin

Make a directory for Alice, and install the Agent SDK and the plugin:

```sh
mkdir alice && cd alice
npm init -y && npm pkg set type=module
npm install @anthropic-ai/claude-agent-sdk @dnsid-ai/agent-sdk-plugin
```

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
    // Keep your Claude Code settings, memory, and claude.ai connectors out of
    // Alice's session.
    settingSources: [],
    env: {
      ...process.env,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    },
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
tool it allows is the plugin's own, `fetch`. `settingSources` and `env` keep
your own Claude Code settings, memory, and claude.ai connectors out of Alice's
session. Every command from here on runs in this directory.

Run it as Alice. The prompt is the first argument:

```sh
dnsid local run alice --port 3001 -- node --env-file-if-exists=.env alice.ts \
  'What does the DNSid line at the start of this session say about your own identity? Quote it and stop.'
```

Alice quotes:

```
DNSid: this agent is alice.test. alice.test: ISSUANCE accepted into the transparency log (c2sp-tlog:testnet:https://registry.test#ag-...); the registry is publishing its DNS record.
```

That line came from the plugin. Section 3 explains what it means.

## 3. Bring the agent online

At session start, the plugin made Alice live. Live means her identity record is
in DNS. Look it up:

```sh
dig @127.0.0.1 -p 7753 _dnsid.alice.test TXT +short
```

```
"v=dnsid-draft-01;ek=https://dnsid.alice.test/.well-known/dnsid-ek.json;gi=alice.test;ku=https://alice.test/.well-known/jwks.json;lr=c2sp-tlog:testnet:https://registry.test#ag-...;sg=...;su=https://registry.test/v1/status/alice.test"
```

One record, five fields a peer uses.

- `ku`: where Alice's public key is.
- `su`: where her current status is. Right now it says `ACTIVE`.
- `ek`: where the accountable entity's public key is. That key is the **entity
  key**. The registry holds it.
- `sg`: the entity key's signature over this record.
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
  ek: { alg: 'EdDSA', crv: 'Ed25519', kid: '2VUql...', kty: 'OKP', use: 'sig', x: 'vDUul...' },
  fqdn: 'alice.test',
  gi: 'alice.test',
  kind: 'dnsid.lifecycle',
  ku: { alg: 'EdDSA', crv: 'Ed25519', kid: 'hdGpN...', kty: 'OKP', use: 'sig', x: '3-5Ua...' },
  log_origin: 'registry.test',
  lr: 'c2sp-tlog:testnet:https://registry.test#ag-...',
  method: 'c2sp-tlog',
  seq: 0,
  sigs: {
    ae: { kid: '2VUql...', sig: 'Pd4JF...' },
    op: { kid: 'hdGpN...', sig: 'nzgGQ...' }
  },
  stream_id: 'ag-...',
  ts: 1790822534,
  type: 'ISSUANCE',
  v: 1
}
```

The event pins both public keys, `ek` and `ku`, and carries two signatures: `ae`
(accountable entity) by the entity key, `op` (operational) by Alice's key.
`seq: 0` makes it the first event in her stream. Anyone can read the stream. A
second ISSUANCE for Alice, from a registry that issued another key in her name,
would be visible there.

The log follows the public C2SP transparency-log specs (`tlog-checkpoint`,
`tlog-tiles`, `tlog-witness`, at <https://c2sp.org>). The entry format is
DNSid's own, defined in the `c2sp-tlog` log-method extension of the
[DNSid specification](https://docs.dnsid.ai/the-standard.html).

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
DNSid: this agent is alice.test. alice.test is online (READY).
```

The plugin found her `READY` and only reported. Without the plugin, the CLI does
the same four steps: `dnsid log issue --domain alice.test`.

## 4. Verify a peer

Before every call to another agent, the plugin verifies that agent's identity.
Bob is registered but not online: section 1 left him `VERIFIED`, and no one
submitted his ISSUANCE. Ask Alice to call him:

```sh
dnsid local run alice --port 3001 -- node --env-file-if-exists=.env alice.ts \
  'Use the dnsid fetch tool to GET https://bob.test/. Quote the response body, or the denial reason, and stop.'
```

Alice is refused and quotes:

```
DNSid: bob.test: DNSResolution: no _dnsid TXT record found for bob.test
```

A refusal has the shape `DNSid: <host>: <code>: <detail>`. The host is the
hostname of the URL. The path, the port, and the IP address play no part. The
code names the step that failed, of four:

1. Fetch the `_dnsid` TXT record at the host.
2. Fetch the entity key and the agent key the record names, and verify the
   record's signature.
3. Fetch the agent's status document. A revoked or retired agent fails here.
4. Verify the agent's stream in the transparency log.

Only an agent that passes all four, with state `ACTIVE`, may be called. The
plugin keeps a failure for 30 seconds. A refusal is the peer's to fix. The code
tells its operator where: the record, a key, the status, or the log.

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
dnsid local run bob --port 3002 -- dnsid log issue --domain bob.test
```

```
Transparency-log ISSUANCE accepted for bob.test.
Log reference: c2sp-tlog:testnet:https://registry.test#ag-...@1
Stream explorer: http://127.0.0.1:7755/streams/bob.test
Run `dnsid status --domain bob.test` to confirm the agent reaches READY.
```

DNSid Local forwards HTTPS for `bob.test` to the `--upstream` from section 1,
port 3002. Bob is a plain HTTP server there. Save this as `bob.ts`, next to
`alice.ts`:

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
5 uses the second half. Install the two DNSid SDK packages it uses, from npm
([SDK overview](https://docs.dnsid.ai/sdk-overview.html)), and start it in
another terminal:

```sh
npm install @dnsid-ai/sdk @dnsid-ai/http-signatures
dnsid local run bob --port 3002 -- node bob.ts
```

```
bob.test listening on 3002
```

The plugin keeps the refusal from the first run for 30 seconds. After that, run
the first prompt of this section again. Alice quotes Bob's reply:

```
hello from bob.test
```

Bob answered because his identity verified. He does not yet know who asked. The
`fetch` tool already told him. Section 5 shows how.

## 5. Sign a request

The `fetch` tool signs every request with Alice's operational key. Ask Alice to
`POST` to Bob:

```sh
dnsid local run alice --port 3001 -- node --env-file-if-exists=.env alice.ts \
  'Use the dnsid fetch tool to POST {"hello":"bob"} to https://bob.test/ as application/json. Quote the response body and stop.'
```

Alice quotes Bob's reply:

```json
{ "from": "alice.test", "received": "{\"hello\":\"bob\"}" }
```

Bob's terminal prints:

```
verified signed POST / from alice.test
```

Bob read the sender from the request. The tool added three headers before it
sent it:

```
content-digest: sha-256=:5lvq...:
signature-input: sig1=("@method" "@authority" "@target-uri" "content-digest" "content-type");keyid="alice.test#hdGpN...";alg="ed25519";created=1790822689;nonce="Jz-GO..."
signature: sig1=:ypHxY...:
```

This is an HTTP message signature (RFC 9421). `signature-input` lists what
`signature` covers: the method, the host, the full URL, a SHA-256 digest of the
body, and every header Alice gave the tool. `keyid` names the signer and her
key. `hdGpN...` is the `kid` of the `ku` key in her ISSUANCE in section 3.
`created` lets Bob reject an old request.

Bob verifies with one call, in `bob.ts`:

```ts
const sender = await bob.verifySignedHttpRequest(request);
```

The call reads the domain from `keyid`, verifies Alice's identity in the four
steps of section 4, fetches her public key from her `ku` URL, and verifies the
signature with it. `sender.domain` is `alice.test`. A `POST` without a signature
does not reach that line:

```sh
curl -s -X POST -H 'content-type: application/json' -d '{"hello":"bob"}' http://127.0.0.1:3002/
```

```
DNSid: SignatureInvalid: missing Signature or Signature-Input headers
```

## 6. What you built

Three parties, two keys, one record.

- The **registry** holds the entity key. It signed Alice's `_dnsid` record and
  the `ae` signature on her ISSUANCE, and it serves her status.
- **Alice** holds the operational key. It signed the `op` signature on her
  ISSUANCE and every request the `fetch` tool sends.
- The **transparency log** holds her ISSUANCE, which pins both public keys.
- **Bob** holds nothing of Alice's. From `keyid` in one request he found her
  record, both keys, her status, and her stream, and verified the signature.

The plugin brought Alice online at session start, verified Bob before she called
him, and signed what she sent.
