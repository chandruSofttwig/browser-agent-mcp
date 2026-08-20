import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function env(name: string, fallback?: string): string | undefined {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  return value
}

function loadToken(): string {
  const fromEnv = env('MCP_AUTH_TOKEN')
  if (fromEnv) return fromEnv.trim()

  const tokenPath = join(homedir(), '.config', 'browser-agent-mcp', 'token')
  if (existsSync(tokenPath)) {
    return readFileSync(tokenPath, 'utf8').trim()
  }

  throw new Error(
    'MCP_AUTH_TOKEN is not set and ~/.config/browser-agent-mcp/token is missing',
  )
}

function loadAllowedHosts(): string[] {
  const raw = env(
    'ALLOWED_HOSTS',
    '127.0.0.1,localhost,chan-hp-laptop-15s-eq2xxx.tail6b030d.ts.net',
  )!
  return raw
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean)
}

const defaultPublicBase =
  'https://chan-hp-laptop-15s-eq2xxx.tail6b030d.ts.net/agent'

export const config = {
  host: env('HOST', '127.0.0.1')!,
  port: Number.parseInt(env('PORT', '8787')!, 10),
  workspaceRoot: env('WORKSPACE_ROOT', join(homedir(), 'Documents', 'GitHub'))!,
  authToken: loadToken(),
  allowedHosts: loadAllowedHosts(),
  bashTimeoutMs: Number.parseInt(env('BASH_TIMEOUT_MS', '60000')!, 10),
  /** Public HTTPS origin+path for OAuth AS endpoints (must be under Funnel /agent). */
  publicBaseUrl: env('PUBLIC_BASE_URL', defaultPublicBase)!,
  /** Public MCP resource URL ChatGPT/Claude connect to. */
  publicMcpUrl: env(
    'PUBLIC_MCP_URL',
    `${defaultPublicBase}/mcp`,
  )!,
}
