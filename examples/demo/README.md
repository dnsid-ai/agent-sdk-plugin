# Two agents, one signed request

Alice is an Agent SDK program with the DNSid plugin loaded. Bob is the peer she
calls. You talk to Alice in a chat; each step she takes renders as a card in the
conversation: her verdict on a peer, the signed request as Bob receives it,
Bob's verdict on her, and his answer. Then she replies in a sentence. Every card
comes from Alice's Agent SDK messages, Bob's replies to her included. Nothing is
simulated.

## Run it

Prerequisites: Docker, Node 22.18 or later, and the `dnsid` CLI
([installation](https://docs.dnsid.ai/cli-installation)). Model credentials are
optional: without `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` in your shell
or in `.env` here (copy `.env.example`), the Agent SDK uses your Claude Code
login. DNSid Local with three agents, one of them never issued:

```sh
dnsid local up
dnsid local agent add alice --upstream http://localhost:3001
dnsid local agent add bob   --upstream http://localhost:3002
dnsid local agent add carol --upstream http://localhost:3004
dnsid local run bob --port 3002 -- dnsid log issue --domain bob.test
```

Then, from this directory:

```sh
npm install
npm run dev
```

That starts Alice (Agent SDK + plugin, API on 4001), Bob (HTTP server on 3002),
and the page at <http://localhost:5173>. If the page shows a **First boot**
card, Alice is unreachable; it lists the setup commands and reconnects on its
own. The servers reload on edit. To run them separately: `npm run alice`,
`npm run bob`, `npm run web`, the first two under `dnsid local run <agent>`.

The chat is one Claude session: each prompt resumes the last, so Alice remembers
earlier turns. She brings herself online when the session starts; the first
prompt takes a few seconds longer while the plugin submits her ISSUANCE.

To start over, `dnsid local reset --hard`, then the setup commands above again.

## What to click

- **Who is Bob?** Alice calls the plugin's `verify` tool. A verdict card shows
  the four checks passing. Bob is not called.
- **Say hello to Bob.** The verify hook checks Bob, the model calls `fetch`, and
  three cards follow: the signed request with what the signature covers, Bob
  verifying the caller from `keyid`, and his HTTP 200.
- **Call Carol.** Carol is registered but never issued, so she has no `_dnsid`
  record. The verdict card fails at step one, and the request never leaves.
- **Anything else.** Type a question. Alice has two tools, so the only way she
  can reach a peer is signed and verified.

The sidebar shows Alice's identity, and her `_dnsid` record on click.

## How it is wired

```
server/alice.ts   query() with the plugin. POST /prompt streams the turn's SDK messages back.
server/bob.ts     examples/minimal/bob.ts; his reply also names the signature he verified.
web/turn.ts       reads a turn's messages into calls and cards. Plain functions, no React.
web/hooks.ts      sends a prompt and reads the streamed reply into the current turn.
web/App.tsx       the chat, the cards, the sidebar.
vite.config.ts    serves web/ and proxies /alice to Alice's API.
```

Brand tokens are from `dnsid-presentation/src/brand.json`, in `web/styles.css`.
