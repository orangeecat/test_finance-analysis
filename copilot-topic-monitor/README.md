# Copilot Topic Monitor

A native VS Code command interface for discussing project topics with GitHub Copilot while monitoring streamed responses.

## Features

- Multi-turn topic discussion with recent history
- Live streamed response display
- Model, elapsed-time, character-count, completion, error, and cancellation status
- User-controlled cancellation and history clearing
- Defensive handling when Copilot is unavailable or access is denied

## Run in development

1. Open this folder in VS Code.
2. Press `F5` to launch an Extension Development Host.
3. In the new window, run **Copilot Topic Monitor: Open Discussion Panel** from the Command Palette.
4. Select **Send to Copilot**. VS Code may ask for one-time consent.

## Package

```powershell
npm install
npm run package
```

Install the resulting `.vsix` through VS Code's **Extensions: Install from VSIX...** command.

