# Two agents, one signed request

Alice is an Agent SDK program with the DNSid plugin loaded. Bob is the peer she
calls. You talk to Alice in a chat; each step she takes renders as a card in the
conversation: her verdict on a peer, the signed request as Bob receives it,
Bob's verdict on her, and his answer. Then she replies in a sentence. Every card
is real: Alice's side is the SDK's own message stream, Bob's side is his server.
Nothing is simulated.

## Run it

Prerequisites: Docker, Node 22.18 or later, the `dnsid` CLI, and model
credentials for the Agent SDK: `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`,
in your shell or in `.env` here (copy `.env.example`). DNSid Local with three
agents, one of them never issued:

```sh
dnsid testnet up
dnsid testnet agent add alice --upstream http://localhost:3001
dnsid testnet agent add bob   --upstream http://localhost:3002
dnsid testnet agent add carol --upstream http://localhost:3004
dnsid testnet run bob --port 3002 -- dnsid log issue --domain bob.dev.dnsid.test
```

> **TODO (for us, remove before publishing).** `package.json` installs the
> plugin from this checkout (a `file:` path) until it is on npm. The published
> registry image also needs dnsid PR #2371; the guide's section 1 has the local
> build command.

Then, from this directory:

```sh
npm install
npm run dev
```

That starts Alice (Agent SDK + plugin, API on 4001), Bob (HTTP server on 3002,
API on 4002), and the page at <http://localhost:5173>. If the page shows a
**First boot** card, one of the two is unreachable; it lists the setup commands
and reconnects on its own. The servers reload on edit. To run them separately:
`npm run alice`, `npm run bob`, `npm run web`, the first two under
`dnsid testnet run <agent>`.

The chat is one Claude session: each prompt resumes the last, so Alice remembers
earlier turns. She brings herself online when the session starts; the first
prompt takes a few seconds longer while the plugin submits her ISSUANCE.

To start over, `dnsid testnet reset --hard`, then the setup commands above
again.

## What to click

- **Who is Bob?** Alice calls the plugin's `verify` tool. A verdict card shows
  the four checks passing; Bob's side stays quiet, he was not called.
- **Say hello to Bob.** The verify hook checks Bob, the model calls `fetch`, and
  three cards follow: the request on the wire with what the signature covers,
  Bob verifying the caller from `keyid`, and his HTTP 200.
- **Call Carol.** Carol is registered but never issued, so she has no `_dnsid`
  record. The verdict card fails at step one, and the request never leaves.
- **Anything else.** Type a question. Alice has two tools, so the only way she
  can reach a peer is signed and verified.

The sidebar shows both identities, their `_dnsid` records on click, and a tally
of the session.

## How it is wired

```
web/          Vite + React: the chat, the cards, the sidebar. Proxies /alice and /bob to the two APIs.
server/alice.ts   query() with the plugin; every SDK message becomes a trace event.
server/bob.ts     examples/minimal/bob.ts plus a trace of each request and verdict.
server/trace.ts   the event type, server-sent events, the _dnsid lookup.
```

Brand tokens are from `dnsid-presentation/src/brand.json`, in `web/styles.css`.
