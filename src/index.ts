#!/usr/bin/env node
/**
 * Backwards-compatible entry: start the MCP server directly
 * (systemd / `node dist/index.js` / `npm start`).
 */
import { startServer } from './server.js'

startServer()
