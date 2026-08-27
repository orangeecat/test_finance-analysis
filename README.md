# Big 4 Financial Risk Analysis

Independent VS Code workspace for audit, compliance, fraud-detection, and financial-risk analysis.

## Environment

- Python 3.11
- pandas, JupyterLab, Plotly, scikit-learn
- Source dataset: Kaggle `pinisetty/big-4-financial-risk-and-compliance-analysis`

## Suggested structure

- `data/raw/` — original downloads
- `data/processed/` — cleaned datasets
- `notebooks/` — exploratory analysis
- `src/` — reusable Python modules
- `outputs/` — reports and charts

## Included tools

- `download_big4_data.py` downloads the Kaggle dataset.
- `analyze_big4.py` validates the CSV and writes a reusable profile.
- `advanced_analysis.py` validates the CSV and writes descriptive tables, charts, and a Markdown report under `outputs/advanced_analysis/`.
- `dashboard.py` provides a local Streamlit dashboard with filters, interactive charts, and filtered CSV download.
- `mcp-vscode/` provides workspace-scoped MCP tools for reading, searching, and opening files in VS Code.
- `copilot-topic-monitor/` provides a native discussion panel for streaming and monitoring GitHub Copilot responses.

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-big4.txt
npm --prefix mcp-vscode install
```

## Local dashboard

Generate the descriptive artifacts, then start the interactive visualization:

```powershell
.\.venv\Scripts\python.exe .\advanced_analysis.py
.\.venv\Scripts\python.exe -m streamlit run .\dashboard.py
```

Open `http://localhost:8501`. The dashboard provides firm, year, industry, and AI-use filters, interactive risk charts, relationship views, and filtered CSV download. The generated report and study notes are written to `outputs/advanced_analysis/`.

Connect the local MCP server to Codex:

```powershell
codex mcp add workspaceVscode --env "VSCODE_MCP_WORKSPACE=C:\path\to\test_finance analysis" -- node "C:\path\to\test_finance analysis\mcp-vscode\src\server.js"
```

## MCP workspace server

The local MCP server provides a narrow bridge between an MCP client and this VS Code workspace. It uses stdio transport and keeps all file access inside the configured workspace root.

Available tools:

- `workspace_info` reports the configured root and runtime details.
- `list_workspace` lists files and directories, excluding `.git`, `.venv`, `node_modules`, and Python caches.
- `read_workspace_file` reads UTF-8 text files up to 512 KB.
- `search_workspace` searches workspace text with `rg` without modifying files.
- `open_in_vscode` opens a workspace file at an optional line and column.

The server does not expose arbitrary shell execution, write operations, credentials, or paths outside the configured workspace. Set `VSCODE_MCP_WORKSPACE` when the project location differs from the repository root, then restart the MCP client after changing its configuration.

Install `copilot-topic-monitor/copilot-topic-monitor-0.1.0.vsix` through VS Code's **Extensions: Install from VSIX...** command.

## Dual-agent command prompt

Run `talk.cmd` to open a terminal discussion bridge between Codex and GitHub Copilot.

Before the first discussion, run `copilot` once and use `/login` if GitHub authentication is requested.

- Plain text or `:ask <topic>` asks both agents independently.
- `:debate <topic>` runs a Codex proposal, Copilot critique, and Codex synthesis.
- `:status` checks both CLIs.
- `:history` lists topics from the current session.
- `:quit` exits and prints the saved transcript path.

The bridge uses read-only discussion prompts and stores transcripts under `.agent-bridge/transcripts/`.
