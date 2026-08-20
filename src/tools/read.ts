import { readFile } from 'node:fs/promises'
import { z } from 'zod/v4'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { trackToolCall } from '../activity-bus.js'
import { READ_DEFAULT_LIMIT, READ_HARD_MAX } from '../limits.js'
import { resolveInWorkspace, toWorkspaceRelative } from '../paths.js'

export function registerReadTool(server: McpServer): void {
  server.registerTool(
    'Read',
    {
      description:
        'Read a file from the allowlisted workspace. Prefer offset/limit for large files. Default window is capped for speed/context size.',
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      inputSchema: {
        path: z.string().describe('File path relative to workspace root'),
        offset: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based start line (optional)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(READ_HARD_MAX)
          .optional()
          .describe(`Max lines to return (default ${READ_DEFAULT_LIMIT}, max ${READ_HARD_MAX})`),
      },
    },
    async ({ path, offset, limit }) =>
      trackToolCall(
        'Read',
        {
          argsSummary: path,
          paths: [path],
          args: { path, offset, limit },
        },
        async () => {
          try {
            const abs = resolveInWorkspace(path, { mustExist: true })
            const raw = await readFile(abs, 'utf8')
            const lines = raw.split('\n')
            const start = offset ? Math.max(0, offset - 1) : 0
            const window = Math.min(limit ?? READ_DEFAULT_LIMIT, READ_HARD_MAX)
            const end = Math.min(start + window, lines.length)
            const slice = lines.slice(start, end)
            const numbered = slice
              .map((line, i) => `${String(start + i + 1).padStart(6)}\t${line}`)
              .join('\n')
            const truncated = end < lines.length
            return {
              content: [
                {
                  type: 'text' as const,
                  text:
                    `File: ${toWorkspaceRelative(abs)} (lines ${start + 1}-${end} of ${lines.length})\n\n` +
                    numbered +
                    (truncated
                      ? `\n\n…truncated — pass offset=${end + 1} and limit to continue`
                      : ''),
                },
              ],
            }
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Read failed: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            }
          }
        },
      ),
  )
}
