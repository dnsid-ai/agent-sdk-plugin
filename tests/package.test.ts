/**
 * The published package runs from node_modules, where Node does not strip
 * TypeScript. Every file the plugin's hooks and MCP server start must be
 * compiled JavaScript, and must be in the package.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packed = (): string[] => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    encoding: 'utf8',
  });
  return JSON.parse(out)[0].files.map((f: { path: string }) => f.path);
};

// Every `${CLAUDE_PLUGIN_ROOT}/...` path in a config file.
const started = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\\\s]+)/g)].map(
    (m) => m[1]!,
  );

describe('the npm package', () => {
  it('starts the MCP server before the identity is published', () => {
    const output = execFileSync(process.execPath, ['dist/mcp.js'], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, DNSID_CONFIG_DIR: '/nonexistent/dnsid-unpublished' },
      input:
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'test', version: '1' },
          },
        }) + '\n',
    });
    expect(JSON.parse(output)).toMatchObject({
      id: 1,
      result: { serverInfo: { name: 'dnsid' } },
    });
  });

  it('contains every compiled file the hooks and MCP server start', () => {
    const files = packed();
    const paths = [...started('hooks/hooks.json'), ...started('.mcp.json')];

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path).toMatch(/\.js$/);
      expect(files).toContain(path);
    }
  });
});
