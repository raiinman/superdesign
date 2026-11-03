const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Assistants, terminalCommand } = require('../assistants.cjs');

test('only registered desktop apps and existing CLI files are reported available', async () => {
  const a = new Assistants({ run: async () => ({ stdout: JSON.stringify(['com.google.gemini.windows']) }), access: async file => { if (file.includes('claude')) throw Error('missing'); } });
  const list = await a.list();
  assert.deepEqual(list.map(c => [c.id, c.available]), [['codex', true], ['chatgpt', false], ['claude', false], ['gemini', true]]);
  assert.ok(list.every(c => !('executable' in c)));
});

test('launch uses fixed app IDs and encoded terminal arguments, rejects unknown or absent clients', async () => {
  const calls = [];
  const runs = [];
  const a = new Assistants({ run: async (...args) => { if (args[1].includes('-EncodedCommand')) { runs.push(args); return { stdout: '' }; } return { stdout: '"com.google.gemini.windows"' }; }, access: async () => {}, launch: async (...args) => calls.push(args) });
  await a.open('gemini', 'C:/project', 'C:/brief.md');
  assert.deepEqual(calls[0][1], ['shell:AppsFolder\\com.google.gemini.windows']);
  await a.open('codex', "C:/project's $() folder", "C:/project's $() folder/brief.md");
  const broker = Buffer.from(runs[0][1].at(-1), 'base64').toString('utf16le');
  assert.match(broker, /-WorkingDirectory 'C:\/project''s \$\(\) folder'/);
  assert.match(broker, /-WindowStyle Normal/);
  const script = Buffer.from(broker.match(/'-EncodedCommand', '([^']+)'/)[1], 'base64').toString('utf16le');
  assert.match(script, /Set-Location -LiteralPath 'C:\/project''s \$\(\) folder'/);
  assert.doesNotMatch(script, /bypass|dangerously|full-access/i);
  await assert.rejects(a.open('chatgpt', '', ''), /not installed/i);
  await assert.rejects(a.open('evil', '', ''), /Unknown assistant/);
  assert.equal(calls.length, 1); assert.equal(runs.length, 1);
});

test('registration failures are visible, launch errors propagate', async () => {
  const a = new Assistants({ run: async () => { throw Error('timeout'); }, access: async () => {}, launch: async () => { throw Error('launch failed'); } });
  assert.match((await a.list()).find(c => c.id === 'gemini').status, /Could not check/);
  await assert.rejects(a.open('gemini', '.', 'brief.md'), /Could not check/);
  const b = new Assistants({ run: async () => { throw Error('launch failed'); }, access: async () => {} });
  await assert.rejects(b.open('claude', '.', 'brief.md'), /launch failed/);
});

test('PowerShell preserves special characters and project cwd without executing path text', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studio's $() "));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const executable = path.join(root, 'capture.ps1');
  await fs.writeFile(executable, '[PSCustomObject]@{ cwd = (Get-Location).Path; prompt = $args[0] } | ConvertTo-Json -Compress');
  const file = path.join(root, "brief's $(Write-Output hacked).md");
  const script = terminalCommand({ id: 'claude', executable }, root, file);
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000 });
  const captured = JSON.parse(stdout);
  assert.equal(captured.cwd, root);
  assert.ok(captured.prompt.includes(file));
});

test('terminal broker creates usable console input without launching a model', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-console-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const executable = path.join(root, 'capture.ps1'), result = path.join(root, 'result.json');
  await fs.writeFile(executable, `[PSCustomObject]@{ cwd = (Get-Location).Path; redirected = [Console]::IsInputRedirected } | ConvertTo-Json -Compress | Set-Content -LiteralPath '${result.replaceAll("'", "''")}'\n[Environment]::Exit(0)`);
  const run = promisify(execFile);
  const a = new Assistants({ run: async (exe, args, options) => {
    if (args.includes('-Command')) return { stdout: '[]' };
    // Keep QA invisible while exercising the real new-console launch mechanism.
    const broker = Buffer.from(args.at(-1), 'base64').toString('utf16le').replace('-WindowStyle Normal', '-WindowStyle Hidden');
    return run(exe, [...args.slice(0, -1), Buffer.from(broker, 'utf16le').toString('base64')], options);
  } });
  a.clients.find(c => c.id === 'codex').executable = executable;
  await a.open('codex', root, path.join(root, 'brief.md'));
  let output;
  for (let i = 0; i < 50; i++) { try { output = JSON.parse((await fs.readFile(result, 'utf8')).replace(/^\uFEFF/, '')); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
  assert.ok(output, 'terminal fixture completed');
  assert.equal(output.cwd, root); assert.equal(output.redirected, false);
});
