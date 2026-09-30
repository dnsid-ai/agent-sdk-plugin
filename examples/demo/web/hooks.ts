/**
 * React hooks for the page. useConversation sends a prompt to Alice and adds
 * her streamed reply to the current turn. useIdentity loads her identity.
 */
import { useEffect, useState } from 'react';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type { Turn } from './turn.ts';

export interface Identity {
  domain: string;
  kid?: string;
  record: Record<string, string> | null;
}

// Yields each line of a streamed response body.
async function* lines(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const complete = buffer.split('\n');
    buffer = complete.pop()!;
    yield* complete.filter(Boolean);
  }
}

export function useConversation() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const updateLast = (change: (turn: Turn) => Partial<Turn>) =>
    setTurns((all) => [...all.slice(0, -1), { ...all.at(-1)!, ...change(all.at(-1)!) }]);

  async function send(prompt: string) {
    setTurns((all) => [...all, { prompt, messages: [], done: false }]);
    try {
      const res = await fetch('/alice/prompt', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      });
      for await (const line of lines(res.body!)) {
        const message = JSON.parse(line) as SDKMessage | { type: 'error'; error: string };
        if (message.type === 'error') updateLast(() => ({ error: message.error }));
        else updateLast((turn) => ({ messages: [...turn.messages, message] }));
      }
    } catch (error) {
      updateLast(() => ({ error: String(error) }));
    }
    updateLast(() => ({ done: true }));
  }

  return {
    turns,
    busy: turns.at(-1)?.done === false,
    send,
    clear: () => setTurns([]),
  };
}

export function useIdentity(url: string) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  useEffect(() => {
    const load = () =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then(setIdentity, () => setIdentity(null));
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [url]);
  return identity;
}
