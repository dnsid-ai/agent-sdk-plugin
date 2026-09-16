# dnsid-agent-sdk-plugin

DNSid identity for agents built on the
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk), as a standard
plugin. Load it and the agent:

1. **Verifies peers.** Before any call to another agent, a hook verifies the
   peer's DNSid identity and denies the call unless it is `ACTIVE`. The model
   cannot skip it.
2. **Is verifiable.** A `fetch` tool signs outbound requests with the agent's
   own key, so the peer can verify who called.
3. **Brings itself online.** At session start, the agent submits its own
   transparency-log ISSUANCE, authenticating with its own key.

[`docs/guide.md`](docs/guide.md) walks through all three on a local testnet.

## Setup

Not on npm yet. It needs a built sibling checkout of `dnsid-ts`:

```sh
cd ../dnsid-ts && npm ci && npm run build && cd -
npm run link-sdk
npm test
```

## Use

```ts
query({
  prompt,
  options: { plugins: [{ type: 'local', path: '/path/to/agent-sdk-plugin' }] },
});
```

The agent's identity is `config.json` and `private.jwk` in `DNSID_CONFIG_DIR`
(default `~/.dnsid`), as written by the `dnsid` CLI. Set `DNSID_AWS_KMS_KEY_ID`
to sign with an AWS KMS key instead of `private.jwk`.

## 1. Verify peers (`src/verify/`)

A `PreToolUse` hook runs on `WebFetch` and every `mcp__*` tool.

| Tool                             | Peer verified                                        |
| -------------------------------- | ---------------------------------------------------- |
| `WebFetch`                       | hostname of `url`                                    |
| `mcp__plugin_dnsid_dnsid__fetch` | hostname of `url`                                    |
| `mcp__<server>__*`               | `DNSID_MCP_SERVER_DOMAINS[server]`, if you mapped it |
| anything else, including `Bash`  | not verified                                         |

`ACTIVE` allows, and your own permission rules still run. Anything else denies
with a reason starting `DNSid:`, even in `bypassPermissions` mode. "Cannot
verify" (an untrusted log, `fl=mtls`) denies by default or asks, never allows. A
hook that crashes denies. Verdicts are cached in a file until they expire;
failures for 30 seconds.

## 2. Be verifiable (`src/sign/`)

`.mcp.json` starts a stdio MCP server with one tool,
`fetch(url, method, headers, body, tag)`. It signs the request with the agent's
operational key in the DNSid HTTP Message Signatures profile (RFC 9421, `keyid`
= `<domain>#<kid>`), sends it, and returns status, headers, and body. The
signature covers method, authority, target URI, the body digest, and every
header passed. Redirects are returned, not followed. Only `https:` URLs.

`WebFetch` stays available and unsigned; pass `disallowedTools: ['WebFetch']`
host-side to force the signed path.

A peer verifies with the same verifier the hook uses:
`import { createVerifier } from '@identity-digital/dnsid-agent-sdk-plugin/verify'`.
`examples/bob.ts` does.

## 3. Bring itself online (`src/online/`)

A `SessionStart` hook reads the agent's registration:

| Registration                 | Action                                                             |
| ---------------------------- | ------------------------------------------------------------------ |
| `READY`                      | nothing; tells the model the identity is online                    |
| `VERIFIED`, registry-managed | countersigns the prepared ISSUANCE, submits it                     |
| anything else                | nothing; tells the model what the accountable entity must still do |

Requests carry a five-minute JWT signed by the agent's own key. No organization
credential is present at runtime. The operation is durable in `issuance.json`
next to the key. A `SessionStart` hook cannot block a session; failures become
context for the model.

## Configuration

Everything the plugin reads is an environment variable starting with `DNSID_`. A
bad value fails the hook, and the hook denies.

| Variable                                                          | Default                                           | Meaning                                                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `DNSID_CONFIG_DIR`                                                | `~/.dnsid`                                        | The agent's identity: `config.json` and `private.jwk`.                                                         |
| `DNSID_AGENT_AUTH_AUDIENCE`                                       | `DNSID_REGISTRY_URL`, then `https://api.dnsid.ai` | The registry the bring-online hook authenticates to.                                                           |
| `DNSID_MODE`                                                      | `enforce`                                         | `observe` logs each verdict to stderr and denies nothing.                                                      |
| `DNSID_ON_UNVERIFIABLE`                                           | `deny`                                            | `ask` turns a `Cannot verify` result into a permission prompt.                                                 |
| `DNSID_MCP_SERVER_DOMAINS`                                        | `{}`                                              | JSON, MCP server name to agent domain. Every tool of a mapped server is verified against that domain.          |
| `DNSID_CACHE_FILE`                                                | `$TMPDIR/dnsid-verdicts.json`                     | The verdict cache, shared between hook runs.                                                                   |
| `DNSID_DNS_SERVER`                                                | the system resolver                               | DNS server for `_dnsid` lookups and the `fetch` tool.                                                          |
| `DNSID_CA_BUNDLE`                                                 | the system store                                  | Extra CA certificates for HTTPS to peers and the registry.                                                     |
| `DNSID_ALLOW_PRIVATE_HOSTS`                                       | none                                              | Comma-separated hosts that may resolve to private addresses. Testnets only.                                    |
| `DNSID_LOG_POLICY_URL`                                            | DNSid's managed catalog                           | HTTPS URL of an operator policy: which transparency logs to trust.                                             |
| `DNSID_LOG_POLICY_FILE`                                           | none                                              | The same policy from a file. Set one of the two, not both.                                                     |
| `DNSID_LOG_CHECKPOINT_MAX_AGE`                                    | from the policy                                   | Seconds a log checkpoint may be old. Needs an operator policy.                                                 |
| `DNSID_DNSSEC_MODE`                                               | `auto`                                            | Only `auto` works today.                                                                                       |
| `DNSID_AWS_KMS_KEY_ID`                                            | none                                              | Sign with this AWS KMS key instead of `private.jwk`.                                                           |
| `DNSID_AWS_KMS_ALGORITHM`                                         | `ED25519_SHA_512`                                 | Or `ECDSA_SHA_256`.                                                                                            |
| `DNSID_AWS_KMS_RETAINED_KEY_IDS`, `DNSID_AWS_KMS_PENDING_KEY_IDS` | none                                              | Comma-separated, for key rotation. Retained keys still verify old signatures. Pending keys are not yet active. |

## Layout

```
hooks/hooks.json     PreToolUse → src/verify/hook.ts, SessionStart → src/online/hook.ts
.mcp.json            dnsid → src/sign/server.ts
skills/dnsid/        what a `DNSid:` message means, for the model
src/verify/          the hook, host extraction, the SDK verifier, verdicts, the cache
src/sign/            the MCP server and the signed fetch
src/online/          the hook, the agent JWT, the issuance file
src/shared/          identity and key selection, used by sign and online
tests/               mirrors src/; needs no model and no network
examples/            alice.ts, the guide's agent; bob.ts, the peer it calls
```

## License

Apache-2.0
