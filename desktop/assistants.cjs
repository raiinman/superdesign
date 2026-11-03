const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const quote = value => "'" + value.replaceAll("'", "''") + "'";

function definitions(env = process.env) {
  const local = env.LOCALAPPDATA || '', profile = env.USERPROFILE || '';
  return [
    { id: 'codex', name: 'Codex', kind: 'terminal', executable: path.join(local, 'Programs/OpenAI/Codex/bin/codex.exe'), detail: 'Project terminal. Uses your Codex sign-in and local skills.' },
    { id: 'chatgpt', name: 'ChatGPT', kind: 'desktop', appId: 'OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0!ChatGPT', detail: 'Desktop handoff. Paste the brief, then import the returned HTML or SVG.' },
    { id: 'claude', name: 'Claude', kind: 'terminal', executable: path.join(profile, '.local/bin/claude.exe'), detail: 'Project terminal. Claude handles its own sign-in and permissions.' },
    { id: 'gemini', name: 'Gemini', kind: 'desktop', appId: 'com.google.gemini.windows', detail: 'Desktop handoff. Paste the brief, then import the returned HTML or SVG.' }
  ];
}

function terminalCommand(client, root, file) {
  if (!['codex', 'claude'].includes(client.id)) throw new Error('Unknown terminal assistant');
  const prompt = `Read the saved design brief at ${file} and carry out the requested design work in this project. Preserve existing files and use a new iteration.`;
  return `Set-Location -LiteralPath ${quote(root)}\n& ${quote(client.executable)} ${quote(prompt)}`;
}

function launchProcess(executable, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { ...options, detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

class Assistants {
  constructor({ env = process.env, run = exec, launch = launchProcess, access = fs.access } = {}) {
    this.clients = definitions(env); this.run = run; this.launch = launch; this.access = access;
    this.windows = env.SystemRoot || 'C:\\Windows';
  }
  async list() {
    let apps = [], detectionError = '';
    try {
      const { stdout } = await this.run(path.join(this.windows, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', 'Get-StartApps | Select-Object -ExpandProperty AppID | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
      const result = JSON.parse(stdout.replace(/^\uFEFF/, '')); apps = Array.isArray(result) ? result : [result];
    } catch { detectionError = 'Could not check Windows app registration. Refresh to retry.'; }
    return Promise.all(this.clients.map(async c => {
      let available = apps.includes(c.appId);
      if (c.kind === 'terminal') { try { await this.access(c.executable); available = true; } catch { available = false; } }
      return { id: c.id, name: c.name, kind: c.kind, available, detail: c.detail, status: available ? (c.kind === 'terminal' ? 'CLI installed' : 'App registered') : (c.kind === 'desktop' && detectionError ? detectionError : 'Not installed') };
    }));
  }
  async open(id, root, file) {
    const client = this.clients.find(c => c.id === id);
    if (!client) throw new Error('Unknown assistant');
    const status = (await this.list()).find(c => c.id === id);
    if (!status.available) throw new Error(`${client.name}: ${status.status}. Your brief is saved and copied.`);
    if (client.kind === 'terminal') {
      const command = Buffer.from(terminalCommand(client, root, file), 'utf16le').toString('base64');
      const powershell = path.join(this.windows, 'System32/WindowsPowerShell/v1.0/powershell.exe');
      // Start-Process gives interactive CLIs console input instead of inherited Electron pipes.
      const broker = `Start-Process -FilePath ${quote(powershell)} -ArgumentList @('-NoProfile', '-NoExit', '-EncodedCommand', '${command}') -WorkingDirectory ${quote(root)} -WindowStyle Normal -ErrorAction Stop`;
      await this.run(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(broker, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
    } else {
      await this.launch(path.join(this.windows, 'explorer.exe'), [`shell:AppsFolder\\${client.appId}`], { windowsHide: true });
    }
    return { kind: client.kind, name: client.name };
  }
}
module.exports = { Assistants, terminalCommand };
