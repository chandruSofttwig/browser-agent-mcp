# Andro Agent (`browser-agent-mcp`)

Local coding tools over **Streamable HTTP MCP**, reachable from **browser ChatGPT / Claude.ai** through **Tailscale Funnel**.

The browser AI is the brain. This server is the hands (local files + shell). No model API key required.

CLI binary: **`andro-agent`** (alias: `browser-agent-mcp`).

## Quick install

```bash
# From a clone of this repo
cd browser-agent-mcp
npm install
npm --prefix ui install
npm run build
npm install -g .

# First-time setup
andro-agent init
andro-agent funnel on
andro-agent start
```

Daily use after that: **`andro-agent start`** only.

| Command | Purpose |
|---------|---------|
| `andro-agent init` | Create `~/.config/browser-agent-mcp/token` + `env` (detects MagicDNS) |
| `andro-agent start` | Run MCP on `127.0.0.1:8787` (foreground) |
| `andro-agent status` | Health + config summary |
| `andro-agent funnel on` | Funnel `/agent` + `/.well-known` → `:8787` |
| `andro-agent funnel off` | Turn Funnel HTTPS off |
| `andro-agent funnel status` | Show Funnel routes |

Connect ChatGPT with **OAuth** (or Claude with **Bearer**) to the URL printed by `init` / `funnel on`, usually:

```text
https://<your-magicdns>/agent/mcp
```

Paste the token from `~/.config/browser-agent-mcp/token` on the OAuth consent page (ChatGPT) or as the Bearer key (Claude).

Activity UI: `http://127.0.0.1:8787/activity` (same token).

### Optional: pack without a global link

```bash
npm run build
npm pack
npm install -g ./browser-agent-mcp-1.0.0.tgz
```

The tarball includes compiled server + activity UI under `dist/` (including `dist/ui`).

### Optional: systemd (user unit)

Point `ExecStart` at `andro-agent start` (or `node …/dist/cli.js start`) and set:

```ini
EnvironmentFile=%h/.config/browser-agent-mcp/env
```

The CLI also loads that env file itself on `start`.

---

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

---

## Tailscale prerequisites

```bash
tailscale version
tailscale status
tailscale funnel status
```

Enable Funnel in the admin console if needed: [Tailscale Funnel docs](https://tailscale.com/kb/1223/funnel).

Find your MagicDNS name:

```bash
tailscale status --json | python3 -c 'import sys,json; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))'
```

`andro-agent init` fills `ALLOWED_HOSTS` and `PUBLIC_*` from this when Tailscale is available.

### Funnel paths (MCP only)

| Public path | Proxies to | Purpose |
|-------------|------------|---------|
| `/agent` | `http://127.0.0.1:8787` | MCP + OAuth + activity UI |
| `/.well-known` | `http://127.0.0.1:8787` | OAuth discovery for ChatGPT |

(`andro-agent funnel on` sets both. Omni on `/` → `:20128` is optional and separate.)

Equivalent manual commands:

```bash
tailscale funnel --bg --yes --set-path /agent http://127.0.0.1:8787
tailscale funnel --bg --yes --set-path /.well-known http://127.0.0.1:8787
tailscale funnel status
# off:
tailscale funnel --https=443 off
```

---

## Connect ChatGPT (OAuth)

1. ChatGPT → Settings → Apps & connectors (Developer Mode if required).
2. Add custom connector / MCP server.
3. **URL:** `https://<magicdns>/agent/mcp`
4. **Auth:** OAuth.
5. On authorize, paste `cat ~/.config/browser-agent-mcp/token`.
6. New chat → `@` connector → try a Glob/Read.

## Connect Claude.ai (Bearer)

1. Claude.ai → Connectors → Add custom connector.
2. URL: `https://<magicdns>/agent/mcp`
3. Auth: Bearer → same token file.
4. Save and use tools in a chat.

---

## Auth summary

| Client | How to authenticate |
|--------|---------------------|
| ChatGPT | OAuth → paste MCP token on consent page |
| Claude.ai | Bearer header = MCP token |
| Activity UI | Paste MCP token once (sessionStorage) |
| curl | `Authorization: Bearer $(cat ~/.config/browser-agent-mcp/token)` |

| File | Role |
|------|------|
| `~/.config/browser-agent-mcp/token` | Canonical token |
| `~/.config/browser-agent-mcp/env` | Loaded by CLI + systemd |
| `~/.config/browser-agent-mcp/oauth-store.json` | OAuth clients/tokens (auto) |

---

## Local smoke test

```bash
andro-agent status
curl -s http://127.0.0.1:8787/healthz

TOKEN=$(tr -d '\n' < ~/.config/browser-agent-mcp/token)
curl -s http://127.0.0.1:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'
```

---

## Config

| Variable | Default | Meaning |
|----------|---------|---------|
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8787` | Local port |
| `WORKSPACE_ROOT` | `~/Documents/GitHub` | Path jail root |
| `MCP_AUTH_TOKEN` | from `token` file | Bearer + OAuth consent password |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:8787/agent` until `init` | OAuth issuer prefix |
| `PUBLIC_MCP_URL` | `…/mcp` | MCP resource URL |
| `ALLOWED_HOSTS` | `127.0.0.1,localhost` (+ MagicDNS after `init`) | Host header allowlist |
| `BASH_TIMEOUT_MS` | `30000` | Bash tool timeout |

### Speed defaults (built-in)

- Glob max **100** paths; skips `node_modules`, `.git`, `dist`, caches, etc.
- Grep default **30** hits (max 100)
- Read default **250** lines (max 800) unless you pass `limit`
- Bash stdout/stderr truncated; default timeout **30s**

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Funnel missing `/.well-known` or `/agent` | `andro-agent funnel on` |
| ChatGPT connector create fails | Funnel public + well-known `curl` 200; use **OAuth** |
| Tools listed but disabled | ChatGPT Developer Mode + new chat; watch activity UI |
| `401` on MCP | Wrong token; re-check `token` / `env`, restart |
| Activity UI 503 | Rebuild package (`npm run build`) so `ui/dist` ships |
| MagicDNS wrong after rename | Re-run `andro-agent init` or edit `PUBLIC_*` + `ALLOWED_HOSTS` |

---

## Security notes

- Bound to localhost; Tailscale Funnel is the only public edge.
- Anyone with the Funnel URL **and** token can read/write your workspace.
- Rotate: `andro-agent init` keeps an existing token; replace `token` + `MCP_AUTH_TOKEN` in `env` to rotate, then reconnect clients.
- Do not commit `token`, `env`, or `oauth-store.json` to Git.
