## [0.0.2] - 2026-11-02

### Fixes

- Update DNSid SDK dependencies to 0.34.0.
- Allow bring-online issuance before the agent's identity is published in DNS,
  and defer signed-fetch identity initialization until the tool is called.
- Update the MCP server dependency to address three high-severity advisories.

### Maintenance

- Add shared security scanning and enable scanning of GitHub Actions workflows.

## [0.0.1] - 2026-10-01

### Features

- First alpha: the verify hook, the signed `fetch` and `verify` tools, and
  bring-online at session start, on DNSid Local.
