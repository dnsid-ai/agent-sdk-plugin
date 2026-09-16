/**
 * The extractor table is the attack surface of the verify hook. Every row
 * gets a test, and so does every deliberate gap.
 */
import { describe, expect, it } from 'vitest';

import { extractHost, mcpServerName } from '../../src/verify/extract-host.ts';

const config = { serverDomains: { bob: 'Bob.dev.dnsid.test' } };

describe('mcpServerName', () => {
  it('reads the server segment', () => {
    expect(mcpServerName('mcp__bob__send')).toBe('bob');
    expect(mcpServerName('mcp__my-server__do_thing')).toBe('my-server');
  });
  it('is undefined for built-ins', () => {
    expect(mcpServerName('WebFetch')).toBeUndefined();
  });
});

describe('extractHost', () => {
  it('WebFetch → hostname of tool_input.url, lowercased', () => {
    expect(
      extractHost('WebFetch', { url: 'https://Agent.Example.com/x?y' }, config),
    ).toBe('agent.example.com');
  });
  it('WebFetch with a malformed or missing url → undefined', () => {
    expect(extractHost('WebFetch', { url: 'not a url' }, config)).toBeUndefined();
    expect(extractHost('WebFetch', { url: 42 }, config)).toBeUndefined();
    expect(extractHost('WebFetch', null, config)).toBeUndefined();
  });
  it('our fetch tool, plugin-namespaced or bare → hostname of tool_input.url', () => {
    for (const name of ['mcp__plugin_dnsid_dnsid__fetch', 'mcp__dnsid__fetch']) {
      expect(extractHost(name, { url: 'https://bob.dev.dnsid.test/a2a' }, config)).toBe(
        'bob.dev.dnsid.test',
      );
    }
  });
  it('mcp__<server>__* with server in serverDomains → the mapped domain, lowercased', () => {
    expect(extractHost('mcp__bob__send_message', { text: 'hi' }, config)).toBe(
      'bob.dev.dnsid.test',
    );
  });
  it('mcp__<server>__* with server not in serverDomains → undefined', () => {
    expect(extractHost('mcp__carol__send_message', {}, config)).toBeUndefined();
  });
  it('Bash → undefined, always (documented gap)', () => {
    expect(
      extractHost('Bash', { command: 'curl https://evil.example' }, config),
    ).toBeUndefined();
  });
  it('WebSearch → undefined', () => {
    expect(
      extractHost('WebSearch', { query: 'agent.example.com' }, config),
    ).toBeUndefined();
  });
});
