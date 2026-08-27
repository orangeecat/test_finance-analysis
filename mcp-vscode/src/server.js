import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(serverDir, "..", "..");
const workspaceRoot = path.resolve(process.env.VSCODE_MCP_WORKSPACE || defaultRoot);
const MAX_READ_BYTES = 512_000;
const IGNORED_DIRS = new Set([".git", ".venv", "node_modules", "__pycache__"]);
const server = new McpServer({ name: "workspace-vscode", version: "0.1.0" });

function insideWorkspace(relativePath = ".") {
  const resolved = path.resolve(workspaceRoot, relativePath);
  const rel = path.relative(workspaceRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path must remain inside the configured workspace.");
  }
  return resolved;
}

function textResult(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

async function walk(directory, prefix = "", output = [], limit = 500) {
  if (output.length >= limit) return output;
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (output.length >= limit) break;
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const relative = path.join(prefix, entry.name);
    output.push({ path: relative.replaceAll("\\", "/"), type: entry.isDirectory() ? "directory" : "file" });
    if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative, output, limit);
  }
  return output;
}

server.registerTool("workspace_info", {
  description: "Return the configured VS Code workspace root and basic runtime information.",
  inputSchema: {}
}, async () => textResult({ workspaceRoot, platform: process.platform, node: process.version }));

server.registerTool("list_workspace", {
  description: "List files and directories within the configured workspace.",
  inputSchema: { relativePath: z.string().default("."), limit: z.number().int().min(1).max(2000).default(500) }
}, async ({ relativePath, limit }) => {
  const target = insideWorkspace(relativePath);
  const metadata = await stat(target);
  if (!metadata.isDirectory()) throw new Error("relativePath must identify a directory.");
  return textResult(await walk(target, relativePath === "." ? "" : relativePath, [], limit));
});

server.registerTool("read_workspace_file", {
  description: "Read a UTF-8 text file inside the configured workspace (maximum 512 KB).",
  inputSchema: { relativePath: z.string().min(1) }
}, async ({ relativePath }) => {
  const target = insideWorkspace(relativePath);
  const metadata = await stat(target);
  if (!metadata.isFile()) throw new Error("relativePath must identify a file.");
  if (metadata.size > MAX_READ_BYTES) throw new Error(`File exceeds ${MAX_READ_BYTES} bytes.`);
  return textResult(await readFile(target, "utf8"));
});

server.registerTool("search_workspace", {
  description: "Search text files in the workspace with ripgrep. Returns matching lines without modifying files.",
  inputSchema: {
    query: z.string().min(1),
    glob: z.string().optional(),
    maxResults: z.number().int().min(1).max(500).default(100)
  }
}, async ({ query, glob, maxResults }) => {
  const args = ["--line-number", "--color", "never", "--max-count", String(maxResults)];
  if (glob) args.push("--glob", glob);
  args.push("--", query, workspaceRoot);
  const output = await run("rg", args, workspaceRoot, true);
  return textResult(output || "No matches.");
});

server.registerTool("open_in_vscode", {
  description: "Open a workspace file in the existing VS Code window at an optional line and column.",
  inputSchema: {
    relativePath: z.string().min(1),
    line: z.number().int().min(1).default(1),
    column: z.number().int().min(1).default(1)
  }
}, async ({ relativePath, line, column }) => {
  const target = insideWorkspace(relativePath);
  await stat(target);
  await run("code", ["--reuse-window", "--goto", `${target}:${line}:${column}`], workspaceRoot);
  return textResult(`Opened ${relativePath}:${line}:${column} in VS Code.`);
});

function run(command, args, cwd, allowNonZero = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0 || (allowNonZero && code === 1)) resolve(stdout.trim());
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

await server.connect(new StdioServerTransport());
