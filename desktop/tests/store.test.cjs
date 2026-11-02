const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'); const os = require('node:os'); const path = require('node:path');
const { Store, safeFile } = require('../store.cjs');
async function fixture(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sd-store-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return new Store(path.join(root, 'app'), path.join(root, 'projects')).init(); }
test('projects and design iterations survive a restart and never overwrite originals', async t => {
  const s = await fixture(t); const p = await s.create('My Space');
  const a = await s.createDraft(p.id, 'A direction', '<title>First</title>');
  const b = await s.createDraft(p.id, 'A direction', '<title>Second</title>'); assert.notEqual(a.name, b.name);
  const reopened = await new Store(s.home, s.projectsHome).init(); assert.equal(reopened.projects[0].id, p.id);
  assert.equal((await reopened.list(p.id)).length, 2);
});
test('saving preserves history and refuses stale edits', async t => {
  const s = await fixture(t); const p = await s.create('History'); const d = await s.createDraft(p.id, 'Page', 'original');
  const first = await s.read(p.id, d.name); await s.save(p.id, d.name, 'new', first.revision);
  await assert.rejects(s.save(p.id, d.name, 'stale', first.revision), /changed on disk/);
  assert.equal((await s.read(p.id, d.name)).html, 'new');
  const history = path.join(p.root, '.superdesign/history'); const files = await fs.readdir(history); assert.equal(files.length, 1); assert.equal(await fs.readFile(path.join(history, files[0]), 'utf8'), 'original');
});
test('paths, oversized drafts and invalid identifiers are rejected', async t => {
  const s = await fixture(t); const p = await s.create('Boundaries');
  for (const name of ['../x.html', 'a/b.html', 'bad.txt', 'a\\b.html']) assert.throws(() => safeFile(name));
  await assert.rejects(s.createDraft(p.id, 'Huge', 'x'.repeat(8 * 1024 * 1024 + 1)), /Invalid draft/);
  await assert.rejects(s.read('not-a-project', 'a.html'), /Project not found/);
});
test('external drafts are discovered and briefs are saved locally', async t => {
  const s = await fixture(t); const p = await s.create('External');
  await fs.writeFile(path.join(s.folder(p), 'from-codex.html'), '<title>From Codex</title>');
  assert.equal((await s.list(p.id))[0].title, 'From Codex');
  const brief = await s.brief(p.id, 'Try a red editorial layout.');
  assert.match(await fs.readFile(brief.file, 'utf8'), /Try a red editorial layout/); assert.match(brief.prompt, /No Superdesign service/);
});
