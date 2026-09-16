---
name: dnsid
description:
  How to read and act on DNSid identity messages in this session. Use whenever a
  tool call is denied with a reason starting "DNSid:", whenever a line starting
  "DNSid:" appears at session start about this agent's own identity, whenever
  you are about to call another agent or service by URL (use the dnsid `fetch`
  tool, not WebFetch), and whenever the user asks whether another agent's
  identity is verified or can be trusted (use the dnsid `verify` tool).
---

# DNSid in this session

A DNSid identity is a `_dnsid` DNS record for an agent's domain, signed by the
organization accountable for it, naming the key the agent holds. Anyone can
verify it with DNS and HTTPS. This session verifies every peer before you call
it, and signs what you send so peers can verify you.

## When a tool call is denied

A reason starting `DNSid:` means the verify hook refused the call. You cannot
override it, and retrying or reaching the same host through another tool will be
refused again, so do neither. Explain the denial to the user in one or two
sentences and stop. The shapes:

- `DNSid: <host>: state REVOKED` (or `RETIRED`, `PENDING`): the identity exists
  but is not live. The peer is not to be contacted.
- `DNSid: <host>: <Code>: <detail>`: the identity did not verify. `Code` names
  the failed step: `DNSResolution` (no record), `RecordInvalid`,
  `SignatureInvalid`, `TLSError`, `StatusUnavailable`, `StatusNotActive`,
  `LogError`. If the user expected a valid identity, the host may be wrong, or
  the peer has not published yet.
- A detail containing `Cannot verify` or `Out of scope`: this verifier could not
  check the identity at all, for example the record names a transparency log it
  does not trust. This says nothing about the peer. Say that plainly, and do not
  describe the peer as bad. Sometimes this arrives as a permission prompt
  instead of a denial; the user decides.
- `DNSid: verification did not complete: <detail>`: the hook itself failed. It
  denies because letting the call through unverified would be worse. Tell the
  user; it is an operator problem, not a peer problem.

## Asking about an agent without calling it

The `dnsid` server's `verify` tool returns the verdict on a domain, the same one
the hook applies, without sending the peer anything. Use it when the user asks
whether an agent is who it says, or before a call you want to explain. Read it
like this:

- `ok: true`: the identity verified. Only `state: ACTIVE` means it may be
  called; `REVOKED` or `RETIRED` means it exists but is not live. `expiresAt`
  says how long the verdict holds.
- `ok: false`: a complete answer, not an error. Branch on `code`, never on
  `message`. `cannotVerify: true` means this verifier could not check at all;
  say so, and do not describe the peer as bad. `transient: true` means the check
  did not complete and may be tried again later.

## Calling another agent

Use the `fetch` tool from the `dnsid` server, not `WebFetch`, to call another
agent. It signs the request with this agent's identity, so the peer can verify
who is calling; `WebFetch` sends nothing a peer can verify. Both are checked by
the same hook first. Pass the headers and `tag` the peer requires; DNSid A2A
peers require the tag `a2a-dnsid-http-sig-v1`. A redirect comes back as a 3xx
response, not followed, because the new location is a new peer and must be
verified on its own.

## Your own identity

At session start a line starting `DNSid: this agent is <domain>.` reports this
agent's own identity:

- `is online (READY)`: peers can verify you.
- `ISSUANCE accepted into the transparency log` or
  `the registry is publishing its DNS record`: you are coming online; a peer may
  fail to verify you for a short time.
- `is <STATUS>, not VERIFIED. The accountable entity has to finish registration`:
  the organization that owns your domain has a step to do. You cannot do it.
- `could not bring its identity online: <detail>`: an operator problem.

Mention your identity state only when it matters, for example when a peer
refuses your signed request. You cannot fix it yourself.

## What is not verified

`Bash` is not gated: a `curl` in a shell command reaches its host unverified. Do
not use it to get around a denial. An allowed call means DNSid has no objection,
not that the call is approved; the user's own permission rules still run.
