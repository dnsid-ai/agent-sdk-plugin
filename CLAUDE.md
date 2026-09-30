# @dnsid-ai/agent-sdk-plugin

A standard Agent SDK plugin, all TypeScript on `dnsid-ts`, run by Node. Rules
that hold: enforcement is a hook, signing and on-request verification are tools,
onboarding is a `SessionStart` hook, and the model can decline none of them.
Only `src/sign/`, `src/online/`, and `src/mcp.ts` touch key material;
`src/verify/` holds no identity. "Cannot verify" never maps to allow.
Configuration is environment variables only.

## Setup and checks

`npm install`, then done means `npm test`, `npm run typecheck`, and
`npx prettier --check .` pass.

## Code

Main at the bottom, helpers above. Happy path as the straight-line body, early
returns for edge cases. Comments say why, never what; cut any that restate the
code. Group statements by idea with blank lines between groups. Each function
has one test that calls it directly; the hook's process wrapper is tested once,
the way the harness runs it.

## The guide

`docs/guide.md` is one program, `examples/minimal/alice.ts`, run with a
different prompt per section. Every command and every output in it comes from a
real run on DNSid Local; a claim not yet run carries a `**TODO (for us).**` note
that says what to run. The guide shows `examples/minimal/alice.ts` and
`examples/minimal/bob.ts` verbatim; `tests/examples/guide.test.ts` enforces it.

Writing rules: Simplified Technical English, zero hard violations from the
`asd-ste100` lint. Command, then what it did. Introduce a thing before its short
name. "Verify" is the one verb for verifying identities. No rhetorical
questions, no idioms, no threat framing. Bold a DNSid term only on first
definition. Where production differs, one **In production** note at the end of
the section.

## Process

Commit only when asked. Stage by file name, never by directory. One change per
commit. Messages are Conventional Commits, one line, no trailers or co-authors:
`<type>(<scope>): <what changed>`, with types `feat`, `fix`, `refactor`, `test`,
`docs`, `chore` and the scope a slice or area (`verify`, `sign`, `online`,
`demo`, `guide`, `skill`). `main` is protected: pull requests only, signed
commits; work on a branch. Never push unless asked. When asked "do we need X",
answer honestly even if it undoes work.

## The demo

`examples/demo` is standalone: `npm run dev` there starts Alice and Bob under
`dnsid local run` and a Vite page. The chat is Alice's view: her server streams
each turn's Agent SDK messages to the page, and Bob's reply says whom he
verified. Bob and Carol are props that pass or fail her checks. The SDK reports
SessionStart hooks but not PreToolUse ones, so the page reads the verify hook's
decision from the tool result: the hook's reason on a denial, an HTTP status on
an allow.

## DNSid Local

The CLI exports the zone as `DNSID_TESTNET_ZONE`. In a log reference,
`c2sp-tlog:testnet:` is the spec's scope for non-production logs, not a name.
`DNSID_MODE=observe` logs every verdict and denies nothing, for debugging the
verify hook.
