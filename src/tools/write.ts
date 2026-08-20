import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod/v4'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { trackToolCall } from '../activity-bus.js'
import { resolveInWorkspace, toWorkspaceRelative } from '../paths.js'

export function registerWriteTool(server: McpServer): void {
  server.registerTool(
    'Write',
    {
      description:
        'Create or overwrite a file under the allowlisted workspace. Creates parent directories as needed.',
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
      inputSchema: {
        path: z.string().describe('File path relative to workspace root'),
        content: z.string().describe('Full file contents to write'),
      },
    },
    async ({ path, content }) =>
      trackToolCall(
        'Write',
        {
          argsSummary: `${path} (${content.length} bytes)`,
          paths: [path],
          args: { path, contentLength: content.length },
        },
        async () => {
          try {
            const abs = resolveInWorkspace(path, { mustExist: false })
            await mkdir(dirname(abs), { recursive: true })
            await writeFile(abs, content, 'utf8')
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Wrote ${content.length} bytes to ${toWorkspaceRelative(abs)}`,
                },
              ],
            }
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Write failed: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            }
          }
        },
      ),
  )
}
