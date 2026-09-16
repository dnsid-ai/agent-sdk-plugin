/**
 * Alice: the Agent SDK with the DNSid plugin loaded, driven from the browser.
 * Every message the SDK yields becomes a trace event, so the page shows the
 * verify hook's decision, the model's tool call, and the tool's result as
 * they happen. Nothing here is simulated.
 *
 *   dnsid testnet run alice --port 3001 -- node server/alice.ts
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { createNodeIdentityManagerFromDnsid } from '@dnsid-ai/sdk/node';

import { Trace, dnsidRecord, json, testnetEnv } from './trace.ts';

const pluginRoot = fileURLToPath(
  new URL('.', import.meta.resolve('@dnsid-ai/agent-sdk-plugin/package.json')),
);
const trace = new Trace('alice');
let running: AbortController | undefined;
// One Claude session for the whole chat: each prompt resumes the last, so
// Alice remembers earlier turns and the bring-online hook runs once.
let sessionId: string | undefined;
let lastPeer: string | undefined;

// The SDK reports SessionStart hooks but not PreToolUse ones, so the verify
// hook's decision is read from where the hook itself records it: its cache.
function verdictFor(host: string) {
  const file = process.env.DNSID_CACHE_FILE ?? join(tmpdir(), 'dnsid-verdicts.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8'))[host]?.verdict as
      | { ok: true; state: string; expiresAt: string }
      | { ok: false; code: string; message: string; cannotVerify: boolean }
      | undefined;
  } catch {
    return undefined;
  }
}

function record(message: SDKMessage) {
  // Hooks from the user's own settings fire too. Only the plugin's speak JSON
  // with hookSpecificOutput, so anything else stays out of the trace.
  if (message.type === 'system' && message.subtype === 'hook_response') {
    let parsed:
      | {
          permissionDecision?: string;
          permissionDecisionReason?: string;
          additionalContext?: string;
        }
      | undefined;
    try {
      parsed = JSON.parse(message.stdout).hookSpecificOutput;
    } catch {
      // Empty stdout from the PreToolUse hook is an allow.
      if (message.hook_event === 'PreToolUse' && message.stdout.trim() === '') {
        trace.emit('hook', 'Verify hook: no objection', { hook: message.hook_name });
      }
      return;
    }
    if (!parsed) return;
    const data = { hook: message.hook_name, ...parsed };
    if (parsed.permissionDecision)
      return trace.emit('deny', parsed.permissionDecisionReason ?? 'denied', data);
    if (parsed.additionalContext)
      return trace.emit('hook', parsed.additionalContext, data);
    trace.emit('hook', `${message.hook_event} hook: no objection`, data);
    return;
  }
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') trace.emit('text', block.text);
      if (block.type === 'tool_use') {
        trace.emit(
          'tool-call',
          block.name === 'ToolSearch'
            ? 'Alice looks up a dnsid tool (ToolSearch)'
            : `Alice calls ${block.name}`,
          block.input,
        );
        const url = (block.input as { url?: string }).url;
        if (block.name.endsWith('__fetch') && url) lastPeer = URL.parse(url)?.hostname;
      }
    }
    return;
  }
  if (message.type === 'user' && message.tool_use_result !== undefined) {
    // An MCP tool result carries the tool's JSON as structuredContent. A
    // denied call arrives as a string starting "Error: DNSid:".
    const result = message.tool_use_result as
      { structuredContent?: { status?: number } } | string;
    const status =
      typeof result === 'object' ? result.structuredContent?.status : undefined;
    // The verify tool's result is a verdict: ok with a state, or a failure code.
    const verdict =
      typeof result === 'object'
        ? (result.structuredContent as
            { ok?: boolean; state?: string; domain?: string; code?: string } | undefined)
        : undefined;
    if (verdict?.ok !== undefined) {
      trace.emit(
        verdict.ok ? 'hook' : 'deny',
        verdict.ok
          ? `Verdict: ${verdict.domain} is ${verdict.state}`
          : `Verdict: ${verdict.code}`,
        verdict,
      );
      return;
    }
    const denied = typeof result === 'string' && result.includes('DNSid:');
    if (lastPeer) {
      // Success verdicts expire with the DNS TTL, which DNSid Local keeps
      // short, so an allow is often gone from the cache by now. A tool result
      // with an HTTP status is proof enough: the hook allows only ACTIVE.
      const verdict = verdictFor(lastPeer);
      if (verdict && !verdict.ok) {
        trace.emit('deny', `Verify hook denied ${lastPeer}: ${verdict.code}`, verdict);
      } else if (denied) {
        trace.emit('deny', result.replace(/^Error: /, ''));
      } else if (status !== undefined) {
        trace.emit('hook', `Verify hook: ${lastPeer} is ACTIVE, call allowed`, verdict);
      }
      lastPeer = undefined;
    }
    if (denied) return;
    trace.emit(
      'tool-result',
      status === undefined ? 'Tool result' : `Tool result: HTTP ${status}`,
      typeof result === 'object' ? (result.structuredContent ?? result) : result,
    );
    return;
  }
  if (message.type === 'result') {
    sessionId = message.session_id;
    trace.emit(
      'done',
      message.subtype === 'success' ? 'Turn complete' : `Turn ended: ${message.subtype}`,
      {
        duration_ms: message.duration_ms,
        session_id: message.session_id,
        num_turns: message.num_turns,
      },
    );
  }
}

async function run(prompt: string) {
  running?.abort();
  const controller = new AbortController();
  running = controller;
  trace.emit('prompt', prompt);
  try {
    for await (const message of query({
      prompt,
      options: {
        plugins: [{ type: 'local', path: pluginRoot }],
        // No built-in tools: Alice can only act through the plugin's two.
        tools: [],
        allowedTools: [
          'mcp__plugin_dnsid_dnsid__fetch',
          'mcp__plugin_dnsid_dnsid__verify',
        ],
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: [
            'You are Alice, an agent with a DNSid identity, talking to a person watching a demo.',
            'Bob is another agent at https://bob.dev.dnsid.test/ (POST JSON to /). Carol is at https://carol.dev.dnsid.test/.',
            'Use the dnsid verify tool to check who an agent is, and the dnsid fetch tool to call one.',
            'Answer in one or two plain sentences. Never mention files, permissions, or tools you lack.',
          ].join(' '),
        },
        maxTurns: 6,
        abortController: controller,
        resume: sessionId,
      },
    })) {
      record(message);
    }
  } catch (error) {
    if (!controller.signal.aborted) trace.emit('error', String(error));
  }
}

testnetEnv(['bob', 'carol']);
const idm = await createNodeIdentityManagerFromDnsid();
const domain = idm.config.identity!.domain;
const kid = (await idm.getKeyProvider().signingKey()).kid;

createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path === '/events') return trace.subscribe(req, res);
  if (path === '/identity')
    return json(res, 200, { domain, kid, record: await dnsidRecord(domain) });
  if (path.startsWith('/record/'))
    return json(res, 200, await dnsidRecord(path.slice('/record/'.length)));
  if (path === '/prompt' && req.method === 'POST') {
    const { prompt } = JSON.parse(await text(req));
    void run(prompt);
    return json(res, 202, { ok: true });
  }
  json(res, 404, { error: 'not found' });
}).listen(4001, () => console.log(`${domain}: alice api on 4001`));
