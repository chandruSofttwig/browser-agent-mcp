import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerReadTool } from './read.js'
import { registerWriteTool } from './write.js'
import { registerEditTool } from './edit.js'
import { registerGlobTool } from './glob.js'
import { registerGrepTool } from './grep.js'
import { registerBashTool } from './bash.js'
import { registerAndroTools } from './andro.js'

export function registerAllTools(server: McpServer): void {
  // Local filesystem + shell. Destructive tools are sandboxed and
  // approval-gated.
  registerReadTool(server)
  registerWriteTool(server)
  registerEditTool(server)
  registerGlobTool(server)
  registerGrepTool(server)
  registerBashTool(server)

  // Indexed team context from the user's local Andromedia core (read-only).
  // Gives one client both the code and the reasons behind it.
  registerAndroTools(server)
}
