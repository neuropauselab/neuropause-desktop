#!/usr/bin/env node
'use strict';
/**
 * Clock MCP Server — a minimal, real Model Context Protocol server speaking
 * JSON-RPC 2.0 over stdio with Content-Length framing (the MCP stdio transport).
 * It implements initialize, tools/list, and tools/call for a "current_time"
 * tool. Run standalone: `node server.cjs`, then send framed JSON-RPC requests.
 *
 * Host-side MCP client wiring (so NeuroPause can talk to mcp_server plugins)
 * arrives with the Connector Framework (Phase 4); this server is the real,
 * testable server half.
 */
const SERVER = { name: 'clock-mcp-server', version: '0.1.0' };

function write(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`);
}

function result(id, res) {
  write({ jsonrpc: '2.0', id, result: res });
}
function error(id, code, message) {
  write({ jsonrpc: '2.0', id, error: { code, message } });
}

function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: SERVER,
      });
    case 'notifications/initialized':
      return; // notification, no response
    case 'tools/list':
      return result(id, {
        tools: [
          {
            name: 'current_time',
            description: 'Returns the current date and time in ISO-8601.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          },
        ],
      });
    case 'tools/call': {
      const name = params && params.name;
      if (name === 'current_time') {
        return result(id, { content: [{ type: 'text', text: new Date().toISOString() }] });
      }
      return error(id, -32602, `Unknown tool: ${name}`);
    }
    case 'ping':
      return result(id, {});
    default:
      if (id !== undefined) error(id, -32601, `Method not found: ${method}`);
  }
}

// Content-Length framed reader.
let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString('utf8');
    const m = header.match(/Content-Length:\s*(\d+)/i);
    if (!m) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const len = parseInt(m[1], 10);
    const start = headerEnd + 4;
    if (buffer.length < start + len) return; // wait for the full body
    const body = buffer.slice(start, start + len).toString('utf8');
    buffer = buffer.slice(start + len);
    try {
      handle(JSON.parse(body));
    } catch {
      error(null, -32700, 'Parse error');
    }
  }
});

process.stderr.write(`${SERVER.name} ${SERVER.version} ready on stdio\n`);
