#!/bin/sh
# Installs the packed plugin the way a user does, into node_modules, and starts
# its verify hook from there. Node does not strip TypeScript under
# node_modules, so this fails if the hooks run anything but compiled files.
set -eu

dir=$(mktemp -d)
npm pack --pack-destination "$dir" >/dev/null
cd "$dir"
npm init -y >/dev/null
npm install ./*.tgz >/dev/null

root="$dir/node_modules/@dnsid-ai/agent-sdk-plugin"
command=$(node -p "require('$root/hooks/hooks.json').hooks.PreToolUse[0].hooks[0].command")
call='{"hook_event_name":"PreToolUse","session_id":"s","transcript_path":"/t","cwd":"/","tool_name":"Bash","tool_input":{"command":"ls"},"tool_use_id":"t"}'

# Not a peer call: a working hook answers with nothing and exits 0.
out=$(printf '%s' "$call" | CLAUDE_PLUGIN_ROOT="$root" sh -c "$command")
test -z "$out"
echo "verify hook starts from node_modules"
