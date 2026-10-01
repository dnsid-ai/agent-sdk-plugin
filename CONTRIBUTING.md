# Contributing to agent-sdk-plugin

This is the DNSid plugin for the Claude Agent SDK.

## Development

```bash
npm ci
npm test
npm run typecheck
npx prettier --check .
```

`npm ci` builds `dist/`, the compiled code the plugin's hooks and MCP server
run. `npm test` builds it again before it tests. `npm run smoke:pack` installs
the packed package the way a user does and starts its verify hook.

## Pull requests

- Branch off `main`; open a PR against `main`.
- All PRs require **1 approving review** from a code owner and all conversations
  resolved before merge.
- Commits must be signed.
- Keep changes focused; add tests for behavior changes.

## Publishing to npm

Releases are published to [npmjs.com](https://www.npmjs.com/org/dnsid-ai) by
`.github/workflows/release.yml` using
[trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) with
`--provenance`. No npm token is stored in this repository.

To release:

1. In a pull request, bump the version and describe the release:
   `npm version patch --no-git-tag-version` (or `minor`) updates `package.json`,
   the lockfile, and `.claude-plugin/plugin.json`. Add the version's section to
   `CHANGELOG.md`; the release notes come from it.
2. After the PR is merged, run the **Release** workflow from the Actions tab, on
   `main`. It tests, tags `v<version>`, creates the GitHub Release, and
   **stages** the package (`npm stage publish`). Nothing goes live until a
   maintainer approves it with 2FA:

```sh
npm stage list @dnsid-ai/agent-sdk-plugin   # the stage-id for this version
npm stage approve <stage-id>                # prompts for 2FA
```

To discard a staged version: `npm stage reject <stage-id>`.

One-time setup, because npm cannot create a package via OIDC:

1. As a member of the `@dnsid-ai` npm org, from a clean checkout of `main` at
   version `0.0.1`: `npm ci && npm publish --access public`. Then tag it:
   `git tag -a v0.0.1 -m "Release v0.0.1" && git push origin v0.0.1`.
2. On npmjs.com → package → Settings → Trusted Publisher: add GitHub Actions
   with organization `dnsid-ai`, repository `agent-sdk-plugin`, workflow
   `release.yml`. Leave **npm publish** disallowed — only stage publish (the
   default).
3. Release later versions with the steps above.

## Reporting security issues

See [SECURITY.md](SECURITY.md) — do not file public issues for vulnerabilities.
