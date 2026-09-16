import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The guide shows alice.ts and bob.ts in full. They must be the tested files.
describe('guide', () => {
  const blocks = [
    ...readFileSync('docs/guide.md', 'utf8').matchAll(/```ts\n([\s\S]*?)```/g),
  ].map((m) => m[1]);
  it.each(['alice.ts', 'bob.ts'])('shows examples/%s verbatim', (file) => {
    expect(blocks).toContain(readFileSync(`examples/${file}`, 'utf8'));
  });
});
