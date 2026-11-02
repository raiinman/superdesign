const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';
const id = () => crypto.randomUUID();
const exists = async p => fs.access(p).then(() => true, () => false);
async function atomic(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + id() + '.tmp';
  await fs.writeFile(temp, text, { flag: 'wx' });
  try { await fs.rename(temp, file); } catch (error) { await fs.unlink(temp).catch(() => {}); throw error; }
}
function validText(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`);
  return value.trim();
}
function safeFile(name) {
  if (typeof name !== 'string' || name !== path.basename(name) || /[<>:"/\\|?*\x00-\x1f]/.test(name) || !/\.(html?|svg)$/i.test(name)) throw new Error('Invalid draft filename');
  return name;
}
class Store {
  constructor(home, projectsHome) { this.home = home; this.projectsHome = projectsHome; this.projects = []; this.metadataQueue = Promise.resolve(); this.preferenceQueue = Promise.resolve(); }
  async init() {
    await fs.mkdir(this.home, { recursive: true });
    const registry = path.join(this.home, 'projects.json');
    if (await exists(registry)) {
      const data = JSON.parse(await fs.readFile(registry, 'utf8'));
      if (!Array.isArray(data) || data.some(p => typeof p.id !== 'string' || typeof p.root !== 'string' || typeof p.name !== 'string')) throw new Error('Project registry is damaged. Your draft files have not been changed.');
      this.projects = data;
    }
    return this;
  }
  async persist() { await atomic(path.join(this.home, 'projects.json'), JSON.stringify(this.projects, null, 2)); }
  project(projectId) { const p = this.projects.find(p => p.id === projectId); if (!p) throw new Error('Project not found'); return p; }
  folder(p) { return path.join(p.root, '.superdesign', 'design_iterations'); }
  async preferences() {
    const file = path.join(this.home, 'preferences.json');
    const defaults = { viewport: 'desktop', zoom: 1, view: 'grid', sort: 'name', currentProject: this.projects[0]?.id || null };
    if (!await exists(file)) return defaults;
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    this.validatePreferences(value);
    return { ...defaults, ...value };
  }
  validatePreferences(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid preferences');
    const validators = {
      viewport: v => ['desktop', 'tablet', 'mobile'].includes(v),
      zoom: v => Number.isFinite(v) && v >= .5 && v <= 1.5,
      view: v => ['grid', 'list'].includes(v), sort: v => ['name', 'recent'].includes(v),
      currentProject: v => v === null || this.projects.some(p => p.id === v)
    };
    for (const [key, entry] of Object.entries(value)) if (!Object.hasOwn(validators, key) || !validators[key](entry)) throw new Error('Invalid preference: ' + key);
  }
  savePreferences(patch) {
    const update = this.preferenceQueue.then(async () => { this.validatePreferences(patch); const next = { ...await this.preferences(), ...patch }; await atomic(path.join(this.home, 'preferences.json'), JSON.stringify(next, null, 2)); return next; });
    this.preferenceQueue = update.catch(() => {}); return update;
  }
  async renameProject(projectId, name) { const p = this.project(projectId); p.name = validText(name, 100, 'project name'); await this.persist(); return p; }
  async metadata(projectId) {
    const file = path.join(this.project(projectId).root, '.superdesign', 'personal.json');
    if (!await exists(file)) return { favorites: {} };
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!data || typeof data.favorites !== 'object' || !data.favorites || Array.isArray(data.favorites)) throw new Error('Project favorites data is damaged. Draft files are unchanged.');
    return data;
  }
  setFavorite(projectId, name, favorite) {
    const update = this.metadataQueue.then(async () => {
      if (typeof favorite !== 'boolean') throw new Error('Invalid favorite');
      await this.read(projectId, name);
      const data = await this.metadata(projectId);
      if (favorite) data.favorites[name] = true; else delete data.favorites[name];
      await atomic(path.join(this.project(projectId).root, '.superdesign', 'personal.json'), JSON.stringify(data, null, 2));
    });
    this.metadataQueue = update.catch(() => {}); return update;
  }
  async add(root, name, sample = false) {
    root = await fs.realpath(root);
    const old = this.projects.find(p => p.root.toLowerCase() === root.toLowerCase()); if (old) return old;
    const p = { id: id(), name: validText(name, 100, 'project name'), root, sample, created: new Date().toISOString() };
    await fs.mkdir(this.folder(p), { recursive: true }); this.projects.push(p); await this.persist(); return p;
  }
  async create(name) {
    name = validText(name, 100, 'project name'); await fs.mkdir(this.projectsHome, { recursive: true });
    let root = path.join(this.projectsHome, slug(name)); let n = 2;
    while (await exists(root)) root = path.join(this.projectsHome, slug(name) + '-' + n++);
    await fs.mkdir(root); return this.add(root, name);
  }
  async draftPath(p, name) {
    safeFile(name); const folder = await fs.realpath(this.folder(p)); const file = path.join(folder, name);
    if (await exists(file)) {
      const real = await fs.realpath(file); const relative = path.relative(folder, real);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Draft points outside its project');
    }
    return file;
  }
  async list(projectId) {
    const p = this.project(projectId); let names;
    try { names = await fs.readdir(this.folder(p)); } catch { throw new Error('Project folder is unavailable. Reconnect the folder to continue.'); }
    const results = []; const metadata = await this.metadata(projectId);
    for (const name of names.filter(n => /\.(html?|svg)$/i.test(n)).sort().slice(0, 200)) {
      try {
        const file = await this.draftPath(p, name); const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > 8 * 1024 * 1024) continue;
        const html = await fs.readFile(file, 'utf8');
        const title = /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1] || name.replace(/\.(html?|svg)$/i, '').replace(/[-_]/g, ' ');
        results.push({ name, title, html, revision: hash(html), updated: stat.mtime.toISOString(), bytes: stat.size, favorite: metadata.favorites[name] === true });
      } catch (error) { results.push({ name, title: name, error: error.message }); }
    }
    return results;
  }
  async read(projectId, name) {
    const file = await this.draftPath(this.project(projectId), name); const stat = await fs.stat(file);
    if (stat.size > 8 * 1024 * 1024) throw new Error('Draft is larger than 8 MB');
    const html = await fs.readFile(file, 'utf8'); return { name, html, revision: hash(html) };
  }
  async save(projectId, name, html, revision) {
    if (typeof html !== 'string' || Buffer.byteLength(html) > 8 * 1024 * 1024) throw new Error('Draft must be text smaller than 8 MB');
    const p = this.project(projectId); const file = await this.draftPath(p, name);
    const old = await this.read(projectId, name);
    if (old.revision !== revision) throw new Error('This draft changed on disk. Reopen it before saving so the newer version is preserved.');
    const history = path.join(p.root, '.superdesign', 'history', `${path.parse(name).name}-${Date.now()}-${id()}.${path.parse(name).ext.slice(1)}`);
    await fs.mkdir(path.dirname(history), { recursive: true }); await fs.writeFile(history, old.html, { flag: 'wx' });
    await atomic(file, html); return { name, html, revision: hash(html) };
  }
  async createDraft(projectId, title, html, extension = '.html') {
    title = validText(title, 100, 'draft title');
    if (!['.html', '.svg'].includes(extension) || typeof html !== 'string' || Buffer.byteLength(html) > 8 * 1024 * 1024) throw new Error('Invalid draft');
    const p = this.project(projectId); let n = 1;
    for (;;) {
      const name = `${slug(title)}_${n++}${extension}`; const file = await this.draftPath(p, name);
      try { await fs.writeFile(file, html, { flag: 'wx' }); return { name }; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
  }
  async brief(projectId, text) {
    text = validText(text, 20000, 'brief'); const p = this.project(projectId);
    const file = path.join(p.root, '.superdesign', 'briefs', `${Date.now()}-${id()}.md`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const prompt = `Use the local $superdesign skill.\n\nProject: ${p.root}\nSave self-contained HTML or SVG variants in: ${this.folder(p)}\nNo Superdesign service, cloud canvas, external assets or paid generation.\n\n${text}\n`;
    await fs.writeFile(file, prompt, { flag: 'wx' }); return { file, prompt };
  }
}
module.exports = { Store, atomic, hash, safeFile, slug };
