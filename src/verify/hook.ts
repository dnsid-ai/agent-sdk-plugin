/**
 * PreToolUse hook entry point. The harness runs this once per matched tool
 * call with the call as JSON on stdin.
 */
import { text } from 'node:stream/consumers';

try {
  // Imported inside the try, so a failed import is a deny, not a crash.
  const [{ runVerifyHook }, stdin] = await Promise.all([
    import('./verify-hook.ts'),
    text(process.stdin),
  ]);

  const output = await runVerifyHook({ stdin });
  if (output) process.stdout.write(JSON.stringify(output));
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `DNSid: verification did not complete: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    }),
  );
}
