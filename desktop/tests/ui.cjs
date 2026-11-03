const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'); const path = require('node:path'); const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const home = path.join(require('node:os').tmpdir(), 'superdesign-personal-qa-' + Date.now());
(async () => {
  const evidence = path.join(root, 'evidence'); await fs.mkdir(evidence, { recursive: true });
  const packaged = process.env.SUPERDESIGN_PACKAGED === '1';
  const executablePath = process.env.SUPERDESIGN_EXECUTABLE || root + (packaged ? '/release/Superdesign-Personal-win32-x64/Superdesign-Personal.exe' : '/node_modules/electron/dist/electron.exe');
  const launchOptions = { executablePath, args: packaged ? [] : [root], env: { ...process.env, SUPERDESIGN_HEADLESS: '1', SUPERDESIGN_TEST_HOME: home }, timeout: 60000 };
  const app = await electron.launch(launchOptions);
  try {
    const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.design-card'); await page.waitForTimeout(700); assert.equal(await page.locator('.design-card').count(), 2);
    await page.screenshot({ path: evidence + '/canvas-desktop.png' });
    await page.locator('[data-viewport="mobile"]').click(); await page.waitForTimeout(300); assert.equal(await page.locator('.mobile-frame').count(), 2);
    await page.screenshot({ path: evidence + '/canvas-mobile-previews.png' });
    await page.locator('[data-viewport="desktop"]').click();
    await page.locator('#search').fill('no-such-design'); assert.equal(await page.locator('.design-card').count(), 0); await page.locator('#search').fill('');
    await page.locator('.design-card').first().dblclick(); await page.waitForSelector('#editor-dialog[open]');
    const original = await page.locator('#code-editor').inputValue(); await page.locator('#code-editor').fill(original.replace('your creative space', 'a saved local direction'));
    await page.locator('#save-code').click(); await page.waitForFunction(() => document.querySelector('#editor-status').textContent.startsWith('Saved locally'));
    await page.screenshot({ path: evidence + '/source-editor.png' }); await page.locator('#close-editor').click();
    await page.locator('.design-card').first().hover(); await page.locator('.design-card [data-action="duplicate"]').first().click(); await page.waitForFunction(() => document.querySelectorAll('.design-card').length === 3);
    await page.locator('#brief').fill('Try an editorial red and cream direction.'); await page.locator('#brief-button').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.startsWith('Brief saved'));
    const prompt = await app.evaluate(({ clipboard }) => clipboard.readText()); assert.match(prompt, /editorial red and cream/);
    await page.waitForFunction(() => document.querySelector('#assistant option[value="gemini"]').textContent === 'Gemini');
    assert.equal(await page.locator('#assistant option').count(), 5);
    // Exercise the IPC and saved briefs without launching the user's assistants during QA.
    await app.evaluate(({ app }) => {
      const { Assistants } = process.mainModule.require(app.getAppPath() + '/assistants.cjs');
      global.assistantLaunches = [];
      Assistants.prototype.open = async function(id, root, file) {
        global.assistantLaunches.push({ id, root, file });
        return { name: this.clients.find(c => c.id === id).name, kind: ['codex', 'claude'].includes(id) ? 'terminal' : 'desktop' };
      };
    });
    for (const id of ['codex', 'chatgpt', 'claude', 'gemini']) {
      await page.locator('#assistant').selectOption(id);
      await page.locator('#brief').fill(`QA design for ${id}`);
      await page.locator('#brief-button').click();
      await page.waitForFunction(() => document.querySelector('#brief').value === '' && !document.querySelector('#brief-button').disabled);
      const launch = await app.evaluate(() => global.assistantLaunches.at(-1));
      assert.equal(launch.id, id); assert.ok(launch.root.includes('fieldnotes'));
      assert.match(await fs.readFile(launch.file, 'utf8'), new RegExp(`QA design for ${id}`));
      assert.match(await app.evaluate(({ clipboard }) => clipboard.readText()), new RegExp(`QA design for ${id}`));
    }
    await page.screenshot({ path: evidence + '/assistant-connections.png' });
    await page.locator('#assistant').selectOption('copy');

    await page.locator('#new-project').click(); await page.locator('#dialog-name').fill('QA local project'); await page.locator('#dialog-submit').click(); await page.waitForFunction(() => document.querySelector('#project-name').textContent.includes('QA local project'));
    await page.locator('#new-draft').click(); await page.locator('#dialog-name').fill('My starter'); await page.locator('#draft-kind').selectOption('website'); await page.locator('#dialog-submit').click(); await page.waitForSelector('.design-card');
    const projectRoot = path.join(home, 'Superdesign Personal', 'qa-local-project');
    await fs.writeFile(path.join(projectRoot, '.superdesign/design_iterations', 'from-codex.html'), '<!doctype html><title>External update</title><h1>Appeared from Codex</h1>');
    await page.waitForFunction(() => document.querySelectorAll('.design-card').length === 2);
    const input = path.join(home, 'imported.svg'); await fs.writeFile(input, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#b74837"/></svg>');
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, input);
    await page.locator('#import-button').click(); await page.waitForFunction(() => document.querySelectorAll('.design-card').length === 3);
    const exported = path.join(home, 'exported.html'); await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, exported);
    await page.locator('.design-card').first().hover(); await page.locator('.design-card [data-action="export"]').first().click(); await page.waitForFunction(() => document.querySelector('#toast').textContent === 'Design exported.'); assert.ok((await fs.readFile(exported, 'utf8')).length > 10);
    const blocked = await page.evaluate(() => fetch('https://example.com').then(() => false, () => true)); assert.equal(blocked, true);
    const nodeHidden = await page.evaluate(() => typeof window.require === 'undefined' && typeof window.process === 'undefined'); assert.equal(nodeHidden, true);
    const initialProject = await page.locator('.project-item').first(); await initialProject.click(); await page.waitForFunction(() => document.querySelector('#project-name').textContent.startsWith('Fieldnotes'));
    await page.locator('#library-button').click(); await page.waitForSelector('.example-card'); assert.equal(await page.locator('.example-card').count(), 10);
    await page.waitForTimeout(5600); await page.screenshot({ path: evidence + '/example-library.png' });
    await page.locator('[data-category="Commerce"]').click(); assert.equal(await page.locator('.example-card').count(), 1);
    await page.locator('.example-preview').click(); await page.waitForSelector('#viewer-dialog[open]');
    await page.locator('[data-view-viewport="mobile"]').click(); await page.waitForTimeout(150);
    assert.equal(await page.locator('#viewer-content iframe').evaluate(el => el.style.width), '390px');
    await page.screenshot({ path: evidence + '/example-focused-mobile.png' });
    await page.locator('#viewer-use').click(); await page.waitForSelector('.design-card'); assert.equal(await page.locator('.design-card').count(), 4);
    await page.locator('[data-viewport="desktop"]').click();
    await page.locator('.favorite-button').first().click(); await page.waitForFunction(() => document.querySelector('#favorite-count').textContent === '1');
    await page.locator('#favorites-button').click(); assert.equal(await page.locator('.design-card').count(), 1);
    await page.locator('#all-projects').click(); assert.equal(await page.locator('.design-card').count(), 4);
    await page.locator('.compare-pick').nth(0).click(); await page.locator('.compare-pick').nth(1).click(); await page.locator('#compare-button').click();
    await page.waitForSelector('#viewer-dialog[open]'); assert.equal(await page.locator('#viewer-content iframe').count(), 2);
    await page.screenshot({ path: evidence + '/design-comparison.png' }); await page.locator('#close-viewer').click();
    await page.locator('#list-tab').click(); assert.equal(await page.locator('.canvas-world.is-list').count(), 1);
    await page.locator('#sort-designs').selectOption('recent'); await page.screenshot({ path: evidence + '/design-list.png' });
    await page.locator('#rename-project').click(); await page.locator('#dialog-name').fill('Fieldnotes Studio'); await page.locator('#dialog-submit').click();
    await page.waitForFunction(() => document.querySelector('#project-name').textContent.startsWith('Fieldnotes Studio'));
    await page.locator('#canvas-tab').click(); await page.locator('[data-viewport="tablet"]').click();
    await page.locator('#zoom-in').click(); await page.waitForTimeout(200);
    const prefs = JSON.parse(await fs.readFile(path.join(home, 'preferences.json'), 'utf8')); assert.equal(prefs.viewport, 'tablet'); assert.equal(prefs.sort, 'recent'); assert.ok(prefs.zoom > 1);
    await page.locator('[data-viewport="desktop"]').click(); await page.locator('#zoom-label').click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1050, 760)); await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: evidence + '/compact-window.png' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 940)); await page.waitForTimeout(200);
    await page.screenshot({ path: evidence + '/canvas-final.png' }); assert.deepEqual(errors, []);
    await page.locator('.project-item').nth(1).click(); await page.waitForFunction(() => document.querySelector('#project-name').textContent.startsWith('QA local project'));
    await page.locator('#list-tab').click(); await page.locator('[data-viewport="mobile"]').click(); await page.waitForTimeout(200);
    await page.locator('.design-card').first().dblclick(); await page.waitForSelector('#editor-dialog[open]');
    await page.locator('#code-editor').fill((await page.locator('#code-editor').inputValue()) + '\n<!-- unsaved test -->');
    await app.evaluate(({ dialog, BrowserWindow }) => { dialog.showMessageBoxSync = () => 0; BrowserWindow.getAllWindows()[0].close(); });
    await page.waitForTimeout(400); assert.equal(await page.locator('#editor-dialog').getAttribute('open'), '');
    await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    await fs.writeFile(evidence + '/ui-verification.json', JSON.stringify({ packaged, executablePath, home, checks: ['seeded projects','desktop and mobile previews','search','source edit/save','duplicate','brief clipboard and disk', 'four assistant choices and saved handoff routes (launch recorder)','create project','starter draft','external file watcher','SVG import with native dialog stub','HTML export with native dialog stub','ten-example library','category filtering','focused mobile preview','example insertion','favorite and starred filter','side-by-side comparison','list view','recent sorting','project rename','saved preferences','compact window without body overflow','network blocked','Node hidden','unsaved-close protection','no page errors'], errors }, null, 2));
    console.log('PASS: native Electron UI, ten-example library, comparison, favorites, saved preferences, file workflows and offline boundaries');
  } finally { await app.close(); }
  const reopened = await electron.launch(launchOptions);
  try {
    const page = await reopened.firstWindow(); await page.waitForSelector('.design-card');
    assert.match(await page.locator('#project-name').textContent(), /QA local project/);
    assert.equal(await page.locator('.canvas-world.is-list').count(), 1);
    assert.match(await page.locator('[data-viewport="mobile"]').getAttribute('class'), /active/);
    assert.equal(await page.locator('#sort-designs').inputValue(), 'recent');
    const report = JSON.parse(await fs.readFile(evidence + '/ui-verification.json', 'utf8')); report.checks.push('selected project, list view, mobile viewport and sorting restored after native app restart');
    await fs.writeFile(evidence + '/ui-verification.json', JSON.stringify(report, null, 2));
    console.log('PASS: workspace restored after a native application restart');
  } finally { await reopened.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
