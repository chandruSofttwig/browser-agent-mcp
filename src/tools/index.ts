import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerReadTool } from './read.js'
import { registerWriteTool } from './write.js'
import { registerEditTool } from './edit.js'
import { registerGlobTool } from './glob.js'
import { registerGrepTool } from './grep.js'
import { registerBashTool } from './bash.js'

export function registerAllTools(server: McpServer): void {
  registerReadTool(server)
  registerWriteTool(server)
  registerEditTool(server)
  registerGlobTool(server)
  registerGrepTool(server)
  registerBashTool(server)
}
