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

---

## Step-by-step setup (this machine)

Replace the MagicDNS name below with yours if different:

```text
chan-hp-laptop-15s-eq2xxx.tail6b030d.ts.net
```

Find yours anytime with:

```bash
tailscale status --json | python3 -c 'import sys,json; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))'
```

---

### 1. Install / update Tailscale

```bash
# Check current version
tailscale version

# Update on Ubuntu/Debian (recommended)
curl -fsSL https://tailscale.com/install.sh | sh

# Or via apt if already installed from Tailscale’s repo
sudo apt update && sudo apt install --only-upgrade tailscale

# Restart daemon after upgrade
sudo systemctl restart tailscaled
tailscale up
```

Confirm you are logged in and Funnel is available on your plan/account:

```bash
tailscale status
tailscale funnel status
```

Enable Funnel in the admin console if needed: [Tailscale Funnel docs](https://tailscale.com/kb/1223/funnel) → your tailnet must allow Funnel for this node.

---

### 2. Create or get the MCP token

The token is a long random secret. It is used for:

- Claude.ai **Bearer** auth
- ChatGPT **OAuth consent** password (paste on the authorize page)
- Activity UI unlock
- Local `curl` / Inspector tests

**View the existing token** (already created on this laptop):

```bash
cat ~/.config/browser-agent-mcp/token
```

Copy the whole line (no spaces). Treat it like a password.

**Create a new token** (if the file is missing or you want to rotate):

```bash
mkdir -p ~/.config/browser-agent-mcp
openssl rand -hex 32 | tee ~/.config/browser-agent-mcp/token
chmod 600 ~/.config/browser-agent-mcp/token
```

**Put the same value in the systemd env file** so the service loads it:

```bash
# Edit ~/.config/browser-agent-mcp/env — set MCP_AUTH_TOKEN to the same string
nano ~/.config/browser-agent-mcp/env
```

Example `~/.config/browser-agent-mcp/env`:

```bash
HOST=127.0.0.1
PORT=8787
WORKSPACE_ROOT=/home/chan/Documents/GitHub
MCP_AUTH_TOKEN=PASTE_THE_TOKEN_HERE
ALLOWED_HOSTS=127.0.0.1,localhost,chan-hp-laptop-15s-eq2xxx.tail6b030d.ts.net
BASH_TIMEOUT_MS=60000
```

After changing the token or env:

```bash
systemctl --user restart browser-agent-mcp
```

**Never commit the token** to Git. It lives only under `~/.config/browser-agent-mcp/`.

---

### 3. Build and start the MCP service

```bash
cd ~/Documents/GitHub/browser-agent-mcp
npm install
npm --prefix ui install
npm run build
systemctl --user daemon-reload
systemctl --user enable --now browser-agent-mcp
systemctl --user status browser-agent-mcp
```

Local health check (must return `"ok":true`):

```bash
curl -s http://127.0.0.1:8787/healthz
```

Watch logs:

```bash
journalctl --user -u browser-agent-mcp -f
```

---

### 4. Deploy / open Tailscale Funnel

Funnel publishes HTTPS on the public internet to your MagicDNS name. This machine uses **three paths**:

| Public path | Proxies to | Purpose |
|-------------|------------|---------|
| `/` | `http://127.0.0.1:20128` | OmniRoute (optional; keep if you use Omni) |
| `/agent` | `http://127.0.0.1:8787` | MCP + OAuth + activity UI |
| `/.well-known` | `http://127.0.0.1:8787` | OAuth discovery for ChatGPT |

**Start / refresh Funnel** (run all three; order matters less, `--bg --yes` keeps them persistent):

```bash
# Omni on root (skip if you do not use Omni)
tailscale funnel --bg --yes http://127.0.0.1:20128

# MCP under /agent  (ChatGPT/Claude MCP URL uses this)
tailscale funnel --bg --yes --set-path /agent http://127.0.0.1:8787

# OAuth well-known metadata (required for ChatGPT OAuth)
tailscale funnel --bg --yes --set-path /.well-known http://127.0.0.1:8787
```

**Verify Funnel is on:**

```bash
tailscale funnel status
```

You should see something like:

```text
https://chan-hp-laptop-15s-eq2xxx.tail6b030d.ts.net (Funnel on)
|-- /            proxy http://127.0.0.1:20128
|-- /agent       proxy http://127.0.0.1:8787
|-- /.well-known proxy http://127.0.0.1:8787
```

**Public smoke tests:**

```bash
# OAuth protected-resource metadata (must be HTTP 200 JSON)
curl -sS -o /dev/null -w "%{http_code}\n" \
  https://chan-hp-laptop-15s-eq2xxx.tail6b030d.ts.net/.well-known/oauth-protected-resource/agent/mcp

# MCP without token should be 401 (proves Funnel → MCP is live)
curl -sS -o /dev/null -w "%{http_code}\n" -X POST \
  https://chan-hp-laptop-15s-eq2xxx.tail6b030d.ts.net/agent/mcp \
  -H 'Content-Type: application/json' -d '{}'
```

**If Funnel fell back to “tailnet only”** (not public), re-run the three `tailscale funnel --bg --yes …` commands above. Avoid running plain `tailscale serve …` afterward without Funnel, or it can drop public Funnel.

**Turn Funnel off** (when you want the laptop offline from the public internet):

```bash
tailscale funnel --https=443 off
```

---

### 5. Public URLs (bookmark these)

| Use | URL |
|-----|-----|
| **MCP (ChatGPT / Claude)** | `https://chan-hp-laptop-15s-eq2xxx.tail6b030d.ts.net/agent/mcp` |
| **Activity UI (via Funnel)** | `https://chan-hp-laptop-15s-eq2xxx.tail6b030d.ts.net/agent/activity` |
| **Activity UI (local only)** | `http://127.0.0.1:8787/activity` |
| **OAuth authorize** | `https://chan-hp-laptop-15s-eq2xxx.tail6b030d.ts.net/agent/authorize` |

---

### 6. Connect ChatGPT (OAuth)

ChatGPT custom connectors only offer **OAuth / no auth / mixed** — choose **OAuth**.

1. Enable **Developer Mode** if required: ChatGPT → Settings → Apps & connectors → Advanced.
2. Create a custom connector / MCP server.
3. **MCP server URL:**  
   `https://chan-hp-laptop-15s-eq2xxx.tail6b030d.ts.net/agent/mcp`
4. **Authentication:** OAuth.
5. Browser opens authorize → paste token from:
   ```bash
   cat ~/.config/browser-agent-mcp/token
   ```
6. Click **Authorize**, finish the ChatGPT flow.
7. New chat → `@` your connector → try: *Glob `**/mybuzui/**` under `mybuzcrm`*.

If tools appear but stay “disabled” at runtime, that is usually a ChatGPT-side block (Developer Mode / new chat / reconnect). Confirm the activity UI shows rows when a call actually reaches the laptop.

---

### 7. Connect Claude.ai (Bearer token)

1. Claude.ai → Settings → Connectors → Add custom connector.
2. URL: `https://chan-hp-laptop-15s-eq2xxx.tail6b030d.ts.net/agent/mcp`
3. Auth: Bearer / API key → paste:
   ```bash
   cat ~/.config/browser-agent-mcp/token
   ```
4. Save and use tools in a chat.

---

### 8. Live activity UI

See tool calls in real time (paths, status, duration):

1. Open `http://127.0.0.1:8787/activity` (or the Funnel activity URL above).
2. Paste the same MCP token.
3. Empty feed = ChatGPT/Claude is **not** invoking tools on this machine.

---

## Auth summary

| Client | How to authenticate |
|--------|---------------------|
| ChatGPT | OAuth → paste MCP token on consent page |
| Claude.ai | Bearer header = MCP token |
| Activity UI | Paste MCP token once (sessionStorage) |
| curl | `Authorization: Bearer $(cat ~/.config/browser-agent-mcp/token)` |

Token locations:

| File | Role |
|------|------|
| `~/.config/browser-agent-mcp/token` | Canonical token file |
| `~/.config/browser-agent-mcp/env` | Loaded by systemd (`MCP_AUTH_TOKEN=…`) |
| `~/.config/browser-agent-mcp/oauth-store.json` | Issued OAuth access tokens (auto-created) |

---

## Local smoke test

```bash
curl -s http://127.0.0.1:8787/healthz

TOKEN=$(tr -d '\n' < ~/.config/browser-agent-mcp/token)
curl -s http://127.0.0.1:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'
```

---

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

UI-only:

```bash
npm run build:ui
systemctl --user restart browser-agent-mcp
```

---

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

Update `ALLOWED_HOSTS` and `PUBLIC_*` URLs if your Tailscale MagicDNS name changes, then restart the service.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Funnel missing `/.well-known` or `/agent` | Re-run the three `tailscale funnel --bg --yes …` commands in step 4 |
| ChatGPT connector create fails | Confirm Funnel public + `curl` well-known returns 200; use **OAuth** not “no auth” |
| Tools listed but disabled | ChatGPT Developer Mode + new chat; watch activity UI — empty = not calling laptop |
| `401` on MCP | Wrong/missing token; `cat ~/.config/browser-agent-mcp/token` and restart service after env change |
| Activity UI 503 | `npm run build:ui && systemctl --user restart browser-agent-mcp` |

---

## Security notes

- Bound to localhost; Tailscale Funnel is the only public edge.
- Anyone with the Funnel URL **and** token can read/write your workspace.
- Rotate the token with `openssl rand -hex 32` if it leaks; update `token` + `env`, restart service, reconnect ChatGPT/Claude.
- Do not commit `token`, `env`, or `oauth-store.json` to Git.
