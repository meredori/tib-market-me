# Agent UI Inspection

Use this workflow when an AI coding agent needs to see the Vue UI while changing CSS, component layout, table density, modals, or screen ordering.

## Local App Targets

Primary development target:

```bash
npm run dev:inspect
```

Open:

- Frontend: `http://127.0.0.1:5173`
- Backend API: `http://127.0.0.1:8787`

Production-style frontend preview after a build:

```bash
npm --prefix ui-app run build
npm run preview:inspect
```

Open `http://127.0.0.1:4173`.

On Windows PowerShell, use `npm.cmd` in place of `npm` if execution policy blocks `npm.ps1`.

## Playwright MCP

For Codex, add the Playwright MCP server to the user-level Codex config:

```toml
[mcp_servers.playwright]
command = "npx"
args = ["@playwright/mcp@latest", "--allowed-hosts", "127.0.0.1,localhost"]
```

Equivalent generic MCP JSON:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@latest",
        "--allowed-hosts",
        "127.0.0.1,localhost"
      ]
    }
  }
}
```

This keeps browser automation scoped to local development hosts. The MCP server is launched by the agent host, not by the app itself.

## Agent Checklist

Before visual work:

1. Start `npm run dev:inspect`.
2. Confirm the app loads at `http://127.0.0.1:5173`.
3. Use Playwright MCP, the Codex Browser plugin, or another available browser tool to inspect the changed screen.

During visual work:

1. Check desktop and a narrow mobile viewport.
2. Confirm first-viewport priority matches `docs/UI_STYLE_GUIDE.md`.
3. Check that text, tables, drawers, modals, and icon buttons do not overlap or resize unexpectedly.
4. Capture a screenshot or note the exact screen and viewport inspected in the final summary.

If Playwright MCP is unavailable in the current agent session, still run the build gate and state that visual inspection was blocked by missing browser tooling.

## Usual Verification

For UI-only changes:

```bash
npm --prefix ui-app run build
git diff --check
```

Add server build, server tests, or migrations only when backend files or shared contracts changed.
