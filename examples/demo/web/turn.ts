/** One chat turn: the Agent SDK messages Alice streamed back, read into cards. */
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

/** One question to Alice, and the messages it produced so far. */
export interface Turn {
  prompt: string;
  messages: SDKMessage[];
  error?: string;
  done: boolean;
}

export interface Verdict {
  ok: boolean;
  state?: string;
  code?: string;
  message?: string;
  cannotVerify?: boolean;
}

export interface Call {
  id: string;
  tool: 'verify' | 'fetch';
  host: string;
  /** What Alice asked the fetch tool to send. */
  request?: { method: string; path: string; body?: string };
  verdict?: Verdict;
  response?: { status: number; headers: Record<string, string>; body: string };
}

export type Step =
  | { type: 'online'; text: string }
  | { type: 'call'; call: Call }
  | { type: 'reply'; text: string };

/** What Bob said about Alice's request: who he verified, or why he refused. */
export interface BobSaid {
  from?: string;
  signature?: string;
  refused?: { code: string; message: string };
}

// The bring-online hook's line, minus its "DNSid: this agent is <domain>." lead.
function bringOnlineText(stdout: string) {
  try {
    const context = JSON.parse(stdout).hookSpecificOutput?.additionalContext;
    if (typeof context !== 'string' || !context.startsWith('DNSid:')) return;
    return context.replace(/^DNSid: this agent is \S+\.\s*/, '');
  } catch {
    return;
  }
}

// When the verify hook refuses a call, the model gets the hook's reason as the
// tool's error: "...DNSid: <host>: <code>: <message>". For a peer that exists
// but is not ACTIVE, the reason is "state <STATE>" instead of a code.
function refusal(error: string): Verdict | undefined {
  const at = error.indexOf('DNSid: ');
  if (at < 0) return;

  const [, code, ...message] = error.slice(at + 'DNSid: '.length).split(': ');
  if (message.length === 0) return { ok: false, code: 'StatusNotActive', message: code };
  return { ok: false, code, message: message.join(': ') };
}

// Only the plugin's two tools become calls. Others, such as ToolSearch, are not shown.
function start(id: string, name: string, input: unknown): Call | undefined {
  const { url, domain, method, body } = input as Record<string, string | undefined>;
  if (name.endsWith('__verify') && domain) return { id, tool: 'verify', host: domain };
  if (name.endsWith('__fetch') && url) {
    const { hostname, pathname } = new URL(url);
    const request = { method: method ?? 'GET', path: pathname, body };
    return { id, tool: 'fetch', host: hostname, request };
  }
}

function finish(call: Call, result: unknown) {
  if (typeof result === 'string') {
    call.verdict = refusal(result);
    return;
  }

  const data = (result as { structuredContent?: Record<string, any> })?.structuredContent;
  if (!data) return;

  if (call.tool === 'verify') {
    const { ok, state, code, message, cannotVerify } = data;
    call.verdict = { ok: ok === true, state, code, message, cannotVerify };
    return;
  }

  // The fetch ran, so the verify hook allowed it. It allows only ACTIVE peers.
  call.verdict = { ok: true, state: 'ACTIVE' };
  call.response = {
    status: data.status,
    headers: data.headers ?? {},
    body: String(data.body ?? ''),
  };
}

export function stepsOf(turn: Turn): Step[] {
  const steps: Step[] = [];
  const calls = new Map<string, Call>();

  for (const m of turn.messages) {
    if (m.type === 'system' && m.subtype === 'hook_response') {
      const text = bringOnlineText(m.stdout);
      if (text) steps.push({ type: 'online', text });
    }

    if (m.type === 'assistant') {
      for (const block of m.message.content) {
        if (block.type === 'text') steps.push({ type: 'reply', text: block.text });
        if (block.type !== 'tool_use') continue;
        const call = start(block.id, block.name, block.input);
        if (!call) continue;
        calls.set(call.id, call);
        steps.push({ type: 'call', call });
      }
    }

    if (m.type === 'user' && Array.isArray(m.message.content)) {
      for (const block of m.message.content) {
        const call = block.type === 'tool_result' && calls.get(block.tool_use_id);
        if (call) finish(call, m.tool_use_result);
      }
    }
  }
  return steps;
}

/**
 * Bob's reply to a fetch: a JSON body naming the sender, with the signature he
 * verified in a header, or a 401 with a reason.
 */
export function bobSaid(response: Call['response']): BobSaid | undefined {
  if (!response) return;
  if (response.status === 401) {
    const [, code, ...message] = response.body.trim().split(': ');
    return { refused: { code, message: message.join(': ') } };
  }
  try {
    const { from } = JSON.parse(response.body);
    return { from, signature: response.headers['verified-signature-input'] };
  } catch {
    return;
  }
}

export const secondsOf = (turn: Turn) => {
  const result = turn.messages.find((m) => m.type === 'result');
  return result && result.duration_ms / 1000;
};
