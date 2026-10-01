#!/bin/sh
# Alice and Bob each need their own `dnsid local run` environment, so they
# are separate processes. Ctrl-C stops all three.
trap 'kill 0' EXIT INT TERM
dnsid local run alice --port 3001 -- node --watch --env-file-if-exists=.env server/alice.ts &
dnsid local run bob   --port 3002 -- node --watch server/bob.ts &
npx vite &
wait
