/**
 * SessionStart hook entry point. Reads the session event from stdin, writes
 * context for the model to stdout. A SessionStart hook cannot block, so a
 * failure here is reported on stderr, never as an exit code.
 */
import { text } from 'node:stream/consumers';

try {
  // Imported inside the try, so a failed import is reported, not a crash.
  const [{ runBringOnlineHook }, stdin] = await Promise.all([
    import('./bring-online.ts'),
    text(process.stdin),
  ]);
  const output = await runBringOnlineHook({ stdin });
  if (output) process.stdout.write(JSON.stringify(output));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`DNSid: bring-online failed: ${message}`);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `DNSid: this agent could not bring its identity online: ${message}. Peers may fail to verify it until an operator looks.`,
      },
    }),
  );
}
