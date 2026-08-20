import { spawn } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod/v4'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { trackToolCall } from '../activity-bus.js'
import {
  GREP_DEFAULT_MAX,
  GREP_HARD_MAX,
  GREP_MAX_FILE_BYTES,
  STDERR_CAP,
  STDOUT_CAP,
  rgExcludeGlobs,
  shouldSkipDirName,
  truncateOutput,
} from '../limits.js'
import { getWorkspaceRoot, resolveInWorkspace, toWorkspaceRelative } from '../paths.js'

function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; missing: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: process.env.LANG ?? 'C.UTF-8',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let missing = false
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < STDOUT_CAP) stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < STDERR_CAP) stderr += chunk.toString('utf8')
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, missing })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      missing = (err as NodeJS.ErrnoException).code === 'ENOENT'
      resolve({ code: 1, stdout, stderr: err.message, missing })
    })
  })
}

async function nodeSearch(options: {
  root: string
  pattern: string
  caseInsensitive?: boolean
  globFilter?: string
  limit: number
}): Promise<string> {
  const flags = options.caseInsensitive ? 'i' : undefined
  let regex: RegExp
  try {
    regex = new RegExp(options.pattern, flags)
  } catch {
    regex = new RegExp(options.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  }

  const matches: string[] = []

  async function walk(dir: string): Promise<void> {
    if (matches.length >= options.limit) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (matches.length >= options.limit) return
      if (shouldSkipDirName(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (options.globFilter) {
        const gf = options.globFilter
        if (gf.startsWith('*.') && !entry.name.endsWith(gf.slice(1))) continue
      }
      let text: string
      try {
        const st = await stat(full)
        if (st.size > GREP_MAX_FILE_BYTES) continue
        text = await readFile(full, 'utf8')
      } catch {
        continue
      }
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= options.limit) break
        if (regex.test(lines[i]!)) {
          matches.push(`${toWorkspaceRelative(full)}:${i + 1}:${lines[i]}`)
        }
      }
    }
  }

  await walk(options.root)
  return matches.length ? matches.join('\n') : 'No matches.'
}

export function registerGrepTool(server: McpServer): void {
  server.registerTool(
    'Grep',
    {
      description:
        'Search file contents under the workspace. Prefer a subdirectory via path and a file glob. Prefer this over Bash. Results are capped for speed.',
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      inputSchema: {
        pattern: z.string().describe('Regex/search pattern'),
        path: z
          .string()
          .optional()
          .describe('File or directory to search (prefer a subdirectory)'),
        glob: z
          .string()
          .optional()
          .describe('Optional glob filter, e.g. *.ts'),
        case_insensitive: z.boolean().optional().describe('Case-insensitive search'),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(GREP_HARD_MAX)
          .optional()
          .describe(`Max matching lines (default ${GREP_DEFAULT_MAX}, max ${GREP_HARD_MAX})`),
      },
    },
    async ({ pattern, path, glob, case_insensitive, max_results }) =>
      trackToolCall(
        'Grep',
        {
          argsSummary: path ? `${pattern} in ${path}` : pattern,
          paths: path ? [path] : [],
          args: { pattern, path, glob, case_insensitive, max_results },
        },
        async () => {
          try {
            const cwd = getWorkspaceRoot()
            const target = path
              ? resolveInWorkspace(path, { mustExist: true })
              : cwd
            const limit = Math.min(max_results ?? GREP_DEFAULT_MAX, GREP_HARD_MAX)
            const args = [
              '-n',
              '--no-heading',
              '--color',
              'never',
              '-m',
              String(limit),
              '--hidden',
            ]
            for (const g of rgExcludeGlobs()) {
              args.push('--glob', g)
            }
            if (case_insensitive) args.push('-i')
            if (glob) args.push('--glob', glob)
            args.push('--', pattern, target)

            const result = await run('rg', args, cwd, 20_000)
            if (
              result.missing ||
              result.code === 127 ||
              /ENOENT|not found/i.test(result.stderr)
            ) {
              const text = await nodeSearch({
                root: target,
                pattern,
                caseInsensitive: case_insensitive,
                globFilter: glob,
                limit,
              })
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: truncateOutput(text, STDOUT_CAP, 'grep'),
                  },
                ],
              }
            }
            const text =
              result.stdout.trim() ||
              (result.code === 1 ? 'No matches.' : result.stderr.trim() || 'No output.')
            return {
              content: [
                {
                  type: 'text' as const,
                  text: truncateOutput(text, STDOUT_CAP, 'grep'),
                },
              ],
            }
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Grep failed: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            }
          }
        },
      ),
  )
}
