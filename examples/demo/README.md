# Two agents, one signed request

Alice is an Agent SDK program with the DNSid plugin loaded. Bob is the peer she
calls. The page shows them side by side: Alice's identity and what the model
decides, the request as it crosses the wire with its signature headers, and Bob
verifying who sent it. Every event on the page is real: the SDK's own message
stream on Alice's side, and Bob's server on his. Nothing is simulated.

## Run it

Prerequisites: Docker, Node 22.18 or later, the `dnsid` CLI, and model
credentials for the Agent SDK (`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`)
in your shell. DNSid Local with three agents, one of them never issued:

```sh
dnsid testnet up
dnsid testnet agent add alice --upstream http://localhost:3001
dnsid testnet agent add bob   --upstream http://localhost:3002
dnsid testnet agent add carol --upstream http://localhost:3004
dnsid testnet run bob --port 3002 -- dnsid log issue --domain bob.dev.dnsid.test
```

> **TODO (for us, remove before publishing).** `package.json` installs the
> plugin and `dnsid-ts` from sibling checkouts (`file:` paths) until both are on
> npm. `dnsid-ts` must be built first. The published registry image also needs
> dnsid PR #2371; the guide's section 1 has the local build command.

Then, from this directory:

```sh
npm install
npm run dev
```

That starts Alice (Agent SDK + plugin, API on 4001), Bob (HTTP server on 3002,
API on 4002), and the page at <http://localhost:5173>. The servers reload on
edit. To run them separately: `npm run alice`, `npm run bob`, `npm run web`, the
first two under `dnsid testnet run <agent>`.

Alice brings herself online at session start; the first prompt takes a few
seconds longer while the plugin submits her ISSUANCE.

## What to click

- **Who is Bob?** Alice calls the plugin's `verify` tool. The timeline shows the
  verdict, ACTIVE, and Bob's side shows nothing: he was not called.
- **GET Bob.** The verify hook checks Bob's identity, the model calls the
  `fetch` tool, Bob answers. The wire shows an unsigned GET.
- **POST Bob.** Same, and the wire shows `content-digest`, `signature-input`,
  and `signature`, with the list of what the signature covers. Bob's card turns
  green with `sent by alice.dev.dnsid.test`.
- **Call Carol.** Carol is registered but never issued, so she has no `_dnsid`
  record. The hook refuses before any request leaves; the timeline shows the
  denial and the model's reply.
- **Anything else.** Type a prompt. Alice has one tool, so the only way she can
  reach a peer is signed and verified.

## How it is wired

```
web/          Vite + React. Proxies /alice and /bob to the two APIs.
server/alice.ts   query() with the plugin; every SDK message becomes a trace event.
server/bob.ts     examples/minimal/bob.ts plus a trace of each request and verdict.
server/trace.ts   the event type, server-sent events, the _dnsid lookup.
```

Brand tokens are from `dnsid-presentation/src/brand.json`, in `web/styles.css`.
