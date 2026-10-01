/**
 * The process wrapper, run the way the harness runs it: the PreToolUse command
 * from hooks/hooks.json, through a shell, with the tool call on stdin. Offline:
 * these cases never reach a verifier.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const command = JSON.parse(readFileSync('hooks/hooks.json', 'utf8')).hooks.PreToolUse[0]
  .hooks[0].command as string;

async function hook(input: unknown, env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
    const child = execFile(
      'sh',
      ['-c', command],
      { env: { ...process.env, CLAUDE_PLUGIN_ROOT: process.cwd(), ...env } },
      (error, stdout) => {
        if (error && error.code === undefined) reject(error);
        else resolve({ code: child.exitCode, stdout });
      },
    );
    child.stdin!.end(JSON.stringify(input));
  });
}

const call = (tool_name: string, tool_input: unknown) => ({
  hook_event_name: 'PreToolUse',
  session_id: 's',
  transcript_path: '/t',
  cwd: '/',
  tool_name,
  tool_input,
  tool_use_id: 'tu1',
});

describe('the PreToolUse hook command', () => {
  it('prints nothing for a call that is not a peer call', async () => {
    const { code, stdout } = await hook(call('Bash', { command: 'ls' }));
    expect(code).toBe(0);
    expect(stdout).toBe('');
  });

  it('fails closed: a broken environment becomes a deny, not a crash', async () => {
    const { code, stdout } = await hook(
      call('WebFetch', { url: 'https://peer.example/' }),
      {
        DNSID_DNSSEC_MODE: 'required',
      },
    );
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringMatching(
          /^DNSid: verification did not complete/,
        ),
      },
    });
  });

  it('blocks the call when the hook cannot start at all', async () => {
    const { code } = await hook(call('WebFetch', { url: 'https://peer.example/' }), {
      CLAUDE_PLUGIN_ROOT: tmpdir(),
    });
    expect(code).toBe(2);
  });
});
