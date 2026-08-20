import { glob } from 'node:fs/promises'
import { z } from 'zod/v4'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { trackToolCall } from '../activity-bus.js'
import { getWorkspaceRoot, resolveInWorkspace, toWorkspaceRelative } from '../paths.js'

export function registerGlobTool(server: McpServer): void {
  server.registerTool(
    'Glob',
    {
      description:
        'Find files under the workspace matching a glob pattern (e.g. **/*.ts). Returns paths relative to workspace root.',
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      inputSchema: {
        pattern: z.string().describe('Glob pattern'),
        path: z
          .string()
          .optional()
          .describe('Subdirectory to search from (relative to workspace)'),
      },
    },
    async ({ pattern, path }) =>
      trackToolCall(
        'Glob',
        {
          argsSummary: path ? `${pattern} in ${path}` : pattern,
          paths: path ? [path] : [],
          args: { pattern, path },
        },
        async () => {
          try {
            const root = path
              ? resolveInWorkspace(path, { mustExist: true })
              : getWorkspaceRoot()
            const matches: string[] = []
            for await (const entry of glob(pattern, {
              cwd: root,
              exclude: (name) =>
                name === 'node_modules' || name === '.git' || name === 'dist',
            })) {
              if (typeof entry !== 'string') continue
              if (entry.endsWith('/')) continue
              const abs = resolveInWorkspace(
                path ? `${path.replace(/\/$/, '')}/${entry}` : entry,
                { mustExist: false },
              )
              matches.push(toWorkspaceRelative(abs))
              if (matches.length >= 500) break
            }
            matches.sort()
            return {
              content: [
                {
                  type: 'text' as const,
                  text:
                    matches.length === 0
                      ? 'No files matched.'
                      : matches.join('\n') +
                        (matches.length >= 500 ? '\n…truncated at 500 matches' : ''),
                },
              ],
            }
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Glob failed: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            }
          }
        },
      ),
  )
}
