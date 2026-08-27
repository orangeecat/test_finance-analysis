# Workspace VS Code MCP

This local stdio MCP server gives an MCP client four bounded tools:

- inspect the configured workspace
- list and read workspace files
- search workspace text with `rg`
- open a file at a line/column in the existing VS Code window

It deliberately does not expose arbitrary shell execution or paths outside the workspace.

## Run

```powershell
npm install
npm start
```

Set `VSCODE_MCP_WORKSPACE` to override the default workspace (the repository root).

## Codex configuration

Copy the example in `codex-mcp.example.toml` into your Codex `config.toml`, replacing the absolute path if the project moves. Start a new Codex session after changing MCP configuration.

