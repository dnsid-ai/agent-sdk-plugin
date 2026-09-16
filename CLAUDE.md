# dnsid-agent-sdk-plugin

A standard Agent SDK plugin, all TypeScript on `dnsid-ts`, run by Node. Rules
that hold: enforcement is a hook, signing is a tool, onboarding is a
`SessionStart` hook, and the model can decline none of them. Only `src/sign/`
and `src/online/` touch key material. "Cannot verify" never maps to allow.
Configuration is environment variables only.

## Setup and checks

The `dnsid-ts` packages are not on npm, so plain `npm install` fails. Build the
sibling checkout, then link it: `cd ../dnsid-ts && npm ci && npm run build`,
then `npm run link-sdk` here. Done means `npm test`, `npm run typecheck`, and
`npx prettier --check .` pass.

## Code

Main at the bottom, helpers above. Happy path as the straight-line body, early
returns for edge cases. Comments say why, never what; cut any that restate the
code. Group statements by idea with blank lines between groups. Each function
has one test that calls it directly; the hook's process wrapper is tested once,
the way the harness runs it.

## The guide

`docs/guide.md` is one program, `examples/alice.ts`, run with a different prompt
per section. Every command and every output in it comes from a real run on DNSid
Local; a claim not yet run carries a `**TODO (for us).**` note that says what to
run. Running `alice.ts` needs model credentials the agent session does not have,
so ask the user to run it. The guide shows `examples/alice.ts` and
`examples/bob.ts` verbatim; `tests/examples/guide.test.ts` enforces it.

Writing rules: Simplified Technical English, zero hard violations from the
`asd-ste100` lint. Command, then what it did. Introduce a thing before its short
name. "Verify" is the one verb for verifying identities. No rhetorical
questions, no idioms, no threat framing. Bold a DNSid term only on first
definition. Where production differs, one **In production** note at the end of
the section.

## Process

Commit only when asked. Stage by file name, never by directory. One change per
commit, one-line message in the form `<area>: <what changed>`, no trailers or
co-authors. When asked "do we need X", answer honestly even if it undoes work.

## DNSid Local

The local testnet is `dnsid testnet` in the CLI; upstream is renaming it
`dnsid local`. `DNSID_MODE=observe` logs every verdict and denies nothing, for
debugging the verify hook.
