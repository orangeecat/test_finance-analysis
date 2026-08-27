const vscode = require('vscode');

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  let panel;
  let cancellation;
  const history = [];

  const open = vscode.commands.registerCommand('copilotTopicMonitor.open', () => {
    if (panel) {
      panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    panel = vscode.window.createWebviewPanel(
      'copilotTopicMonitor',
      'Copilot Topic Monitor',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.webview.html = renderHtml(panel.webview);

    panel.webview.onDidReceiveMessage(async message => {
      if (message.type === 'cancel') {
        cancellation?.cancel();
        return;
      }
      if (message.type === 'clear') {
        history.length = 0;
        panel.webview.postMessage({ type: 'cleared' });
        return;
      }
      if (message.type !== 'ask') return;

      const prompt = String(message.prompt || '').trim();
      if (!prompt) return;

      cancellation?.dispose();
      cancellation = new vscode.CancellationTokenSource();
      const startedAt = Date.now();

      try {
        panel.webview.postMessage({ type: 'status', status: 'Selecting Copilot model…' });
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        if (!models.length) {
          throw new Error('No GitHub Copilot language model is available. Check Copilot sign-in and access.');
        }

        const model = models[0];
        const workspace = vscode.workspace.workspaceFolders?.[0]?.name || 'No workspace';
        const messages = [
          vscode.LanguageModelChatMessage.User(
            `You are a senior data-analysis collaborator working in the VS Code workspace "${workspace}". ` +
            'Help refine the topic before proposing implementation. Separate assumptions, analytical questions, methods, outputs, risks, and next actions. ' +
            'Be concrete and challenge weak ideas. Do not claim files were changed unless you actually have tool evidence.'
          ),
          ...history.slice(-12),
          vscode.LanguageModelChatMessage.User(prompt)
        ];

        panel.webview.postMessage({
          type: 'start',
          model: `${model.vendor}/${model.family || model.id}`,
          prompt,
          startedAt
        });

        const response = await model.sendRequest(
          messages,
          { justification: 'Discuss project topics and stream the response in the monitoring panel.' },
          cancellation.token
        );

        let fullResponse = '';
        for await (const fragment of response.text) {
          fullResponse += fragment;
          panel.webview.postMessage({
            type: 'chunk',
            chunk: fragment,
            characters: fullResponse.length,
            elapsedMs: Date.now() - startedAt
          });
        }

        history.push(
          vscode.LanguageModelChatMessage.User(prompt),
          vscode.LanguageModelChatMessage.Assistant(fullResponse)
        );
        panel.webview.postMessage({
          type: 'done',
          characters: fullResponse.length,
          elapsedMs: Date.now() - startedAt
        });
      } catch (error) {
        const cancelled = cancellation?.token.isCancellationRequested;
        panel.webview.postMessage({
          type: cancelled ? 'cancelled' : 'error',
          message: cancelled ? 'Request cancelled.' : formatError(error),
          elapsedMs: Date.now() - startedAt
        });
      }
    }, undefined, context.subscriptions);

    panel.onDidDispose(() => {
      cancellation?.cancel();
      cancellation?.dispose();
      cancellation = undefined;
      panel = undefined;
    }, undefined, context.subscriptions);
  });

  context.subscriptions.push(open);
}

function formatError(error) {
  if (error instanceof vscode.LanguageModelError) {
    return `${error.message} (${error.code})`;
  }
  return error instanceof Error ? error.message : String(error);
}

function renderHtml(webview) {
  const nonce = Math.random().toString(36).slice(2);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Copilot Topic Monitor</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
    textarea { width: 100%; min-height: 120px; box-sizing: border-box; resize: vertical; padding: 10px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }
    .actions { display: flex; gap: 8px; margin: 10px 0; }
    button { padding: 7px 12px; border: 0; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    button:disabled { opacity: .55; cursor: default; }
    #status { padding: 8px; margin: 10px 0; border-left: 3px solid var(--vscode-progressBar-background); background: var(--vscode-textBlockQuote-background); }
    .turn { border-top: 1px solid var(--vscode-panel-border); padding-top: 12px; margin-top: 12px; }
    .prompt { white-space: pre-wrap; font-weight: 600; }
    .response { white-space: pre-wrap; line-height: 1.45; margin-top: 10px; }
    .meta { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 8px; }
  </style>
</head>
<body>
  <h2>Copilot Topic Monitor</h2>
  <p>Discuss an analysis topic, refine the approach, and watch Copilot's response stream in real time.</p>
  <textarea id="prompt" placeholder="Example: Design an advanced descriptive-analysis pipeline for Big 4 audit risk. Challenge the KPI definitions and propose validation checks."></textarea>
  <div class="actions">
    <button id="send">Send to Copilot</button>
    <button id="cancel" class="secondary" disabled>Cancel</button>
    <button id="clear" class="secondary">Clear history</button>
  </div>
  <div id="status">Idle</div>
  <div id="turns"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const prompt = document.getElementById('prompt');
    const send = document.getElementById('send');
    const cancel = document.getElementById('cancel');
    const clear = document.getElementById('clear');
    const status = document.getElementById('status');
    const turns = document.getElementById('turns');
    let activeResponse;
    let activeMeta;

    send.addEventListener('click', () => {
      const value = prompt.value.trim();
      if (!value) return;
      send.disabled = true;
      cancel.disabled = false;
      vscode.postMessage({ type: 'ask', prompt: value });
    });
    cancel.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
    clear.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
    prompt.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) send.click();
    });

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'status') status.textContent = message.status;
      if (message.type === 'start') {
        const turn = document.createElement('section');
        turn.className = 'turn';
        const question = document.createElement('div');
        question.className = 'prompt';
        question.textContent = 'You: ' + message.prompt;
        activeResponse = document.createElement('div');
        activeResponse.className = 'response';
        activeMeta = document.createElement('div');
        activeMeta.className = 'meta';
        turn.append(question, activeResponse, activeMeta);
        turns.prepend(turn);
        status.textContent = 'Streaming from ' + message.model;
      }
      if (message.type === 'chunk') {
        activeResponse.textContent += message.chunk;
        activeMeta.textContent = message.characters + ' characters · ' + (message.elapsedMs / 1000).toFixed(1) + 's';
      }
      if (message.type === 'done') finish('Complete', message);
      if (message.type === 'cancelled') finish(message.message, message);
      if (message.type === 'error') finish('Error: ' + message.message, message);
      if (message.type === 'cleared') {
        turns.replaceChildren();
        status.textContent = 'History cleared';
      }
    });

    function finish(label, message) {
      status.textContent = label;
      if (activeMeta) activeMeta.textContent = (message.characters || 0) + ' characters · ' + ((message.elapsedMs || 0) / 1000).toFixed(1) + 's · ' + label;
      send.disabled = false;
      cancel.disabled = true;
    }
  </script>
</body>
</html>`;
}

function deactivate() {}

module.exports = { activate, deactivate };

