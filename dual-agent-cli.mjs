import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, appendFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const transcriptDir = path.join(projectRoot, '.agent-bridge', 'transcripts');
const transcriptPath = path.join(transcriptDir, `${new Date().toISOString().replaceAll(':', '-')}.jsonl`);
const copilotEntry = process.platform === 'win32'
  ? path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@github', 'copilot', 'npm-loader.js')
  : undefined;
const codexCommand = resolveCodexCommand();
const cli = createInterface({ input: stdin, output: stdout });
const history = [];

await mkdir(transcriptDir, { recursive: true });
printBanner();
cli.setPrompt('\nYou > ');
cli.prompt();

for await (const rawInput of cli) {
  const input = rawInput.trim();
  if (!input) { cli.prompt(); continue; }
  if (input === ':quit' || input === ':exit') break;
  if (input === ':help') { printHelp(); cli.prompt(); continue; }
  if (input === ':status') { await printStatus(); cli.prompt(); continue; }
  if (input === ':history') { printHistory(); cli.prompt(); continue; }
  if (input === ':clear') { history.length = 0; console.log('Conversation memory cleared.'); cli.prompt(); continue; }

  const debate = input.startsWith(':debate ');
  const topic = input.replace(/^:(ask|debate)\s+/, '').trim();
  if (!topic) { cli.prompt(); continue; }

  try {
    if (debate) await runDebate(topic);
    else await runAsk(topic);
  } catch (error) {
    console.error(`\nBridge error: ${error.message}`);
    await record({ type: 'error', message: error.message });
  }
  cli.prompt();
}

cli.close();
console.log(`\nTranscript: ${transcriptPath}`);

async function runAsk(topic) {
  console.log('\n[Bridge] Asking Codex and Copilot in parallel…');
  const context = recentContext();
  const [codexResult, copilotResult] = await Promise.allSettled([
    askCodex(`${discussionRules()}\n${context}\nUser topic:\n${topic}`),
    askCopilot(`${discussionRules()}\n${context}\nUser topic:\n${topic}`)
  ]);
  const codex = resultText(codexResult, 'Codex');
  const copilot = resultText(copilotResult, 'GitHub Copilot');
  show('Codex', codex);
  show('GitHub Copilot', copilot);
  history.push({ topic, codex, copilot });
  await record({ type: 'ask', topic, codex, copilot });
}

async function runDebate(topic) {
  console.log('\n[Bridge] Round 1/3 — Codex proposes…');
  const proposal = await askCodex(`${discussionRules()}\nDevelop a concrete proposal for:\n${topic}`);
  show('Codex proposal', proposal);

  console.log('\n[Bridge] Round 2/3 — Copilot critiques…');
  let critique;
  try {
    critique = await askCopilot(
      `${discussionRules()}\nCritique the proposal below. Identify weak assumptions, missing analysis, implementation risks, and specific improvements.\n\nTopic:\n${topic}\n\nCodex proposal:\n${proposal}`
    );
  } catch (error) {
    critique = agentFailure('GitHub Copilot', error);
  }
  show('GitHub Copilot critique', critique);

  console.log('\n[Bridge] Round 3/3 — Codex synthesizes…');
  const synthesis = await askCodex(
    `${discussionRules()}\nProduce the final synthesis. Preserve good parts, resolve the critique, and end with an ordered action plan and acceptance checks.\n\nTopic:\n${topic}\n\nInitial proposal:\n${proposal}\n\nCopilot critique:\n${critique}`
  );
  show('Codex synthesis', synthesis);
  history.push({ topic, codex: synthesis, copilot: critique });
  await record({ type: 'debate', topic, proposal, critique, synthesis });
}

function askCodex(prompt) {
  return runProcess(
    codexCommand,
    ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '--cd', projectRoot, '-'],
    prompt,
    'Codex'
  );
}

function askCopilot(prompt) {
  return runProcess(
    copilotEntry ? process.execPath : 'copilot',
    [...(copilotEntry ? [copilotEntry] : []), '-sp', prompt, '--no-ask-user', '--no-color'],
    undefined,
    'GitHub Copilot'
  );
}

function runProcess(command, args, inputText, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      windowsHide: true,
      shell: false,
      env: { ...process.env, NO_COLOR: '1' }
    });
    let output = '';
    let errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', error => reject(new Error(`${label} failed to start: ${error.message}`)));
    child.on('close', code => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${label} exited with ${code}: ${(errors || output).trim()}`));
    });
    if (inputText !== undefined) child.stdin.end(inputText);
  });
}

function discussionRules() {
  return [
    'Act as a read-only analytical collaborator.',
    'Do not edit files, execute tools, authenticate, publish, or communicate externally.',
    'Focus on reasoning, concrete recommendations, tradeoffs, and validation criteria.',
    'Clearly label assumptions and uncertainty.'
  ].join('\n');
}

function recentContext() {
  if (!history.length) return 'No previous discussion context.';
  return `Recent discussion context:\n${history.slice(-2).map(item =>
    `Topic: ${item.topic}\nCodex: ${item.codex.slice(0, 1500)}\nCopilot: ${item.copilot.slice(0, 1500)}`
  ).join('\n\n')}`;
}

function show(label, content) {
  console.log(`\n========== ${label} ==========`);
  console.log(content || '(No response)');
}

function resultText(result, label) {
  return result.status === 'fulfilled' ? result.value : agentFailure(label, result.reason);
}

function agentFailure(label, error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/No authentication information found/i.test(message)) {
    return `[${label} unavailable] Authentication is required. Run copilot, enter /login, finish GitHub sign-in, then restart talk.cmd.`;
  }
  return `[${label} unavailable] ${message}`;
}

async function printStatus() {
  const [codex, copilot] = await Promise.all([
    commandVersion(codexCommand, ['--version']),
    commandVersion(copilotEntry ? process.execPath : 'copilot', [...(copilotEntry ? [copilotEntry] : []), '--version'])
  ]);
  console.log(`Codex:   ${codex}`);
  console.log(`Copilot: ${copilot}`);
  console.log(`Project: ${projectRoot}`);
  console.log(`Transcript: ${transcriptPath}`);
}

function commandVersion(command, args) {
  return runProcess(command, args, undefined, command).catch(error => `unavailable — ${error.message}`);
}

function printHistory() {
  if (!history.length) return console.log('No discussion history yet.');
  history.forEach((item, index) => console.log(`${index + 1}. ${item.topic}`));
}

async function record(event) {
  await appendFile(transcriptPath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, 'utf8');
}

function printBanner() {
  console.log('Dual-Agent Discussion Bridge');
  console.log('Codex + GitHub Copilot | read-only discussion mode');
  printHelp();
}

function printHelp() {
  console.log(`
Commands:
  :ask <topic>      Ask both agents independently (default for plain text)
  :debate <topic>   Codex proposal → Copilot critique → Codex synthesis
  :status           Show CLI availability and transcript path
  :history          List topics discussed in this session
  :clear            Clear in-memory conversation context
  :quit             Exit

Press Ctrl+C to stop a running response.`);
}

function resolveCodexCommand() {
  if (process.platform !== 'win32') return 'codex';
  const binRoot = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  if (!existsSync(binRoot)) return 'codex';
  const candidates = readdirSync(binRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(binRoot, entry.name, 'codex.exe'))
    .filter(existsSync);
  return candidates.at(-1) || 'codex';
}
