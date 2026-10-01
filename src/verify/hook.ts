/**
 * PreToolUse hook entry point. The harness runs this once per matched tool
 * call with the call as JSON on stdin.
 */
import { text } from 'node:stream/consumers';

// Exit once the answer is written, so verification work still running (a
// socket held open by a slow peer) cannot keep the hook alive past its timeout.
// Exit from the write callback: on macOS a write to a pipe completes later.
function answer(output?: object): void {
  if (!output) process.exit(0);
  process.stdout.write(JSON.stringify(output), () => process.exit(0));
}

try {
  // Imported inside the try, so a failed import is a deny, not a crash.
  const [{ runVerifyHook }, stdin] = await Promise.all([
    import('./verify-hook.ts'),
    text(process.stdin),
  ]);

  answer(await runVerifyHook({ stdin }));
} catch (error) {
  answer({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `DNSid: verification did not complete: ${
        error instanceof Error ? error.message : String(error)
      }`,
    },
  });
}
