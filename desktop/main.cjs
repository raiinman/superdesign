const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, session } = require('electron');
const fs = require('node:fs/promises'); const path = require('node:path'); const watch = require('node:fs').watch;
const { Store } = require('./store.cjs'); const { starter, demos } = require('./templates.cjs');
const { catalogue, example } = require('./gallery.cjs');
let win, store, current, watcher, debounce;
const dataHome = process.env.SUPERDESIGN_TEST_HOME;
if (dataHome) app.setPath('userData', path.join(dataHome, 'app-data'));
if (process.env.SUPERDESIGN_HEADLESS) app.disableHardwareAcceleration();
app.setName('Superdesign Personal');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    try {
      const home = dataHome || app.getPath('userData');
      store = await new Store(home, path.join(dataHome || app.getPath('documents'), 'Superdesign Personal')).init();
      if (!store.projects.length) {
        const p = await store.create('Fieldnotes'); p.sample = true; await store.persist();
        for (const [title, html] of demos()) await store.createDraft(p.id, title, html);
      }
      const preferences = await store.preferences();
      current = store.projects.some(p => p.id === preferences.currentProject) ? preferences.currentProject : store.projects[0].id;
      win = new BrowserWindow({ width: 1480, height: 940, minWidth: 1050, minHeight: 700, frame: false, backgroundColor: '#f7f6f2', show: false,
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false, offscreen: Boolean(process.env.SUPERDESIGN_HEADLESS) } });
      session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', event => event.preventDefault());
      win.webContents.on('will-prevent-unload', event => {
        const choice = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Keep editing', 'Discard edits'], defaultId: 0, cancelId: 0, message: 'This design has unsaved edits.', detail: 'Keep editing, or close without saving these changes. Your saved file is unchanged.' });
        if (choice === 1) event.preventDefault();
      });
      const handle = (name, callback) => ipcMain.handle('studio:' + name, async (event, ...args) => {
        if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted IPC sender');
        return callback(...args);
      });
      const state = async () => ({ projects: store.projects, current, drafts: await store.list(current), preferences: await store.preferences() });
      const notify = () => { clearTimeout(debounce); debounce = setTimeout(() => win?.webContents.send('studio:changed'), 180); };
      const follow = () => { watcher?.close(); try { watcher = watch(store.folder(store.project(current)), notify); watcher.on('error', notify); } catch {} };
      handle('load', state);
      handle('select', async id => { store.project(id); current = id; await store.savePreferences({ currentProject: current }); follow(); return state(); });
      handle('create-project', async name => { const p = await store.create(name); current = p.id; await store.savePreferences({ currentProject: current }); follow(); return state(); });
      handle('open-project', async () => { const d = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Open a design project' }); if (d.canceled) return null; const p = await store.add(d.filePaths[0], path.basename(d.filePaths[0])); current = p.id; await store.savePreferences({ currentProject: current }); follow(); return state(); });
      handle('library', catalogue);
      handle('example', async (id, exampleId) => { const entry = example(exampleId); await store.createDraft(id, entry.title, entry.html); return state(); });
      handle('favorite', async (id, name, value) => { await store.setFavorite(id, name, value); return state(); });
      handle('preferences', patch => store.savePreferences(patch));
      handle('rename-project', async (id, name) => { await store.renameProject(id, name); return state(); });
      handle('open-folder', id => shell.openPath(store.project(id).root));
      handle('create-draft', async (id, title, kind) => { if (!['blank', 'website', 'dashboard'].includes(kind)) throw new Error('Unknown starter'); await store.createDraft(id, title, starter(title, kind)); return state(); });
      handle('save', async (id, name, html, revision) => { const result = await store.save(id, name, html, revision); notify(); return result; });
      handle('duplicate', async (id, name) => { const d = await store.read(id, name); await store.createDraft(id, path.parse(name).name + '-variation', d.html, path.extname(name).toLowerCase() === '.svg' ? '.svg' : '.html'); return state(); });
      handle('import', async id => { const d = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Design files', extensions: ['html', 'htm', 'svg'] }] }); if (d.canceled) return null; for (const file of d.filePaths) { const stat = await fs.stat(file); if (stat.size > 8 * 1024 * 1024) throw new Error('Imported draft is larger than 8 MB'); await store.createDraft(id, path.parse(file).name, await fs.readFile(file, 'utf8'), path.extname(file).toLowerCase() === '.svg' ? '.svg' : '.html'); } return state(); });
      handle('export', async (id, name) => { const d = await store.read(id, name); const choice = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: 'Design file', extensions: [path.extname(name).slice(1)] }] }); if (choice.canceled) return false; await fs.writeFile(choice.filePath, d.html); return true; });
      handle('brief', async (id, text) => { const result = await store.brief(id, text); clipboard.writeText(result.prompt); return { file: result.file }; });
      handle('copy', text => { if (typeof text !== 'string' || text.length > 9 * 1024 * 1024) throw new Error('Invalid clipboard text'); clipboard.writeText(text); });
      handle('window', action => { if (action === 'minimize') win.minimize(); else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize(); else if (action === 'close') win.close(); });
      win.once('ready-to-show', () => { if (!process.env.SUPERDESIGN_HEADLESS) win.show(); });
      await win.loadFile(path.join(__dirname, 'index.html')); follow();
    } catch (error) { dialog.showErrorBox('Superdesign Personal', error.message); app.quit(); }
  });
  app.on('window-all-closed', () => { watcher?.close(); clearTimeout(debounce); app.quit(); });
}
