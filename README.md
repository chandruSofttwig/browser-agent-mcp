# browser-agent-mcp

OpenClaude-like coding tools over **Streamable HTTP MCP**, reachable from **browser Claude.ai / ChatGPT** through **Tailscale Funnel**.

The browser AI is the brain. This server is the hands (local files + shell). No model API key required.

## Tools

| Tool | Purpose |
|------|---------|
| `Read` | Read a file under the workspace |
| `Write` | Create/overwrite a file |
| `Edit` | Exact string replace in a file |
| `Glob` | Find files by glob pattern |
| `Grep` | Search contents with ripgrep |
| `Bash` | Run a shell command jailed to the workspace |

Default workspace root: `~/Documents/GitHub` (`WORKSPACE_ROOT`).

## Public URL (this machine)

```
https://chan-hp-laptop-15s-eq2xxx.tail6b030d.ts.net/agent/mcp
```

Funnel routes:

- `/` → Omni (`127.0.0.1:20128`)
- `/agent` → this MCP (`127.0.0.1:8787`)
- `/.well-known` → this MCP (OAuth discovery for ChatGPT)

## Auth

Two modes:

1. **OAuth 2.1** (required by ChatGPT custom connectors) — Dynamic Client Registration + PKCE. On the consent page, paste your MCP token.
2. **Static Bearer token** (Claude.ai / curl / Inspector) — `Authorization: Bearer <token>`.

```bash
# View token (keep secret — also the OAuth consent password)
cat ~/.config/browser-agent-mcp/token
```

Env file used by systemd: `~/.config/browser-agent-mcp/env`

## Live activity UI

Linear-style feed of tool calls as they happen on this machine:

```
http://127.0.0.1:8787/activity
```

1. Open that URL in a browser on this laptop.
2. Paste the MCP token from `~/.config/browser-agent-mcp/token`.
3. When ChatGPT/Claude calls `Read` / `Glob` / etc., rows appear live (tool, path, status, duration).

Empty feed = the connector is not actually executing tools (ChatGPT may show them as disabled).

Funnel (token required): `https://chan-hp-laptop-15s-eq2xxx.tail6b030d.ts.net/agent/activity`

## Connect ChatGPT (OAuth)

ChatGPT’s connector UI only offers **OAuth / no auth / mixed** — pick **OAuth**.

1. Open ChatGPT → **Settings** → **Apps & connectors** / **Connected apps** (wording varies).
2. **Create** a custom connector / MCP server.
3. MCP URL:
   `https://chan-hp-laptop-15s-eq2xxx.tail6b030d.ts.net/agent/mcp`
4. Authentication: **OAuth** (not “no auth”).
5. When the browser opens the authorize page, paste the token from `~/.config/browser-agent-mcp/token` and click **Authorize**.
6. Finish the ChatGPT flow, then ask it to `Glob` or `Read` a file under your GitHub folder.

If creation fails with a generic error, confirm Funnel still has `/.well-known` → `:8787`:

```bash
tailscale funnel status
# should show /, /agent, and /.well-known
```

Re-add if missing:

```bash
tailscale funnel --bg --yes --set-path /.well-known http://127.0.0.1:8787
```

## Connect Claude.ai

1. Open [claude.ai](https://claude.ai) → **Settings** → **Connectors**.
2. **Add custom connector**.
3. URL: `https://chan-hp-laptop-15s-eq2xxx.tail6b030d.ts.net/agent/mcp`
4. Auth: Bearer / API key — paste the token from `~/.config/browser-agent-mcp/token`.
5. Save, then start a chat and use the tools.

Claude can also complete the same OAuth flow if it prompts for it.

## Local smoke test

```bash
# Health
curl -s http://127.0.0.1:8787/healthz

# OAuth discovery (public)
curl -s https://chan-hp-laptop-15s-eq2xxx.tail6b030d.ts.net/.well-known/oauth-protected-resource/agent/mcp

# Initialize with static bearer
TOKEN=$(tr -d '\n' < ~/.config/browser-agent-mcp/token)
curl -s http://127.0.0.1:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'
```

## Service management

```bash
systemctl --user status browser-agent-mcp
systemctl --user restart browser-agent-mcp
journalctl --user -u browser-agent-mcp -f
```

Rebuild after code changes:

```bash
cd ~/Documents/GitHub/browser-agent-mcp
npm run build          # builds ui/ + server
systemctl --user restart browser-agent-mcp
```

UI-only rebuild:

```bash
npm run build:ui
systemctl --user restart browser-agent-mcp
```

## Config

| Variable | Default | Meaning |
|----------|---------|---------|
| `HOST` | `127.0.0.1` | Bind address (localhost only) |
| `PORT` | `8787` | Local port |
| `WORKSPACE_ROOT` | `~/Documents/GitHub` | Path jail root |
| `MCP_AUTH_TOKEN` | from `~/.config/browser-agent-mcp/token` | Bearer + OAuth consent password |
| `PUBLIC_BASE_URL` | `https://…ts.net/agent` | OAuth issuer / endpoint prefix |
| `PUBLIC_MCP_URL` | `https://…ts.net/agent/mcp` | MCP resource URL |
| `ALLOWED_HOSTS` | localhost + Tailscale MagicDNS name | Host header allowlist |
| `BASH_TIMEOUT_MS` | `60000` | Bash tool timeout |

## Security notes

- Bound to localhost; Tailscale Funnel is the only public edge.
- OAuth consent requires the MCP token; issued access tokens are stored in `~/.config/browser-agent-mcp/oauth-store.json`.
- Static bearer still works for Claude/curl.
- All file/shell paths must stay under `WORKSPACE_ROOT`.
- Anyone with the Funnel URL **and** token can read/write your workspace — treat the token like a password.
