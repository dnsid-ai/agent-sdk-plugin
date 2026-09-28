# Minimal example

Two agents on DNSid Local in two files. Alice runs the plugin. Bob is the peer
she calls. [`docs/guide.md`](../../docs/guide.md) walks through both, one step
at a time; [`../demo`](../demo/) is the same pair with a browser in front.

| Path           | What it is                                                                      |
| -------------- | ------------------------------------------------------------------------------- |
| `alice.ts`     | An Agent SDK `query()` program with the plugin loaded. The prompt is `argv[2]`. |
| `bob.ts`       | A plain HTTP server behind the proxy. Answers `GET`; verifies signed `POST`.    |
| `.env.example` | Model credentials. Copy to `.env`.                                              |

The guide shows `alice.ts` and `bob.ts` in full; `tests/examples/guide.test.ts`
keeps them identical. Inside this repo they import the plugin by package name,
which Node resolves to the repo itself.

## Quickstart

Prerequisites: Docker, Node 22.18 or later, and the `dnsid` CLI on your PATH.

```sh
# 1. Model credentials. Or export ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN.
cp examples/minimal/.env.example examples/minimal/.env && $EDITOR examples/minimal/.env

# 2. DNSid Local, with two agents. Until dnsid PR #2371 is in the published
#    image, build it from that branch; the guide's section 1 has the command.
dnsid local up
dnsid local agent add alice --upstream http://localhost:3001
dnsid local agent add bob   --upstream http://localhost:3002

# 3. Bob: bring him online and start his server, in its own terminal.
dnsid local run bob --port 3002 -- dnsid log issue --domain bob.dev.dnsid.test
dnsid local run bob --port 3002 -- node examples/minimal/bob.ts

# 4. Alice. The plugin brings her online at session start.
dnsid local run alice --port 3001 -- node --env-file-if-exists=examples/minimal/.env examples/minimal/alice.ts \
  'Use the dnsid fetch tool to POST {"hello":"bob"} to https://bob.dev.dnsid.test/ as application/json. Quote the response and stop.'
```

Bob's terminal prints:

```
verified signed POST / from alice.dev.dnsid.test
```

`dnsid local run <agent>` supplies that agent's identity and DNSid Local's
network settings. Nothing else is configured.
