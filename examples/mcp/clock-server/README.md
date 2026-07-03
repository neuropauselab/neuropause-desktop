# Clock MCP Server (example)

A minimal, real **Model Context Protocol** server over stdio (JSON-RPC 2.0 with
Content-Length framing). Implements `initialize`, `tools/list`, and `tools/call`
for a `current_time` tool.

Run it:

```
node server.cjs
```

Then send a framed request on stdin, e.g. an `initialize` followed by
`tools/call` for `current_time`. Host-side MCP client wiring (so NeuroPause can
call `mcp_server` plugins) lands with the Connector Framework in Phase 4 — this
is the server half, runnable today.
