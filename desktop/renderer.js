const $ = selector => document.querySelector(selector);
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11H3Z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3c-1 0-1 1-1 2m0 3h.01"/>',
  import: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/>',
  plus: '<path d="M12 4v16M4 12h16"/>', search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  desktop: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4m-5 0h10"/>',
  mobile: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 5h4m-3 14h2"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2 7M20 4v7h-7"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', edit: '<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>',
  duplicate: '<rect x="8" y="8" width="12" height="13" rx="1"/><path d="M16 8V3H3v13h5"/>',
  export: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let state, viewport = 'desktop', zoom = 1, editor, formMode, toastTimer, refreshPending = false;
const resize = new ResizeObserver(entries => {
  for (const { target } of entries) {
    const frame = target.querySelector('iframe'); if (!frame) continue;
    const width = viewport === 'mobile' ? 390 : 1100;
    frame.style.width = width + 'px'; frame.style.transform = `scale(${target.clientWidth / width})`;
    frame.style.height = Math.max(850, target.clientHeight / (target.clientWidth / width)) + 'px';
  }
});
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 5500); }
async function action(callback) { try { return await callback(); } catch (error) { toast(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); return null; } }
function documentForPreview(html) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
  if (/^\s*(<\?xml[^>]*>\s*)?<svg/i.test(html)) return `<!doctype html><html><head>${policy}<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#faf7ef}svg{max-width:100%;max-height:100vh}</style></head><body>${html}</body></html>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, match => match + policy);
  return `<!doctype html><html><head>${policy}</head><body>${html}</body></html>`;
}
function project() { return state?.projects.find(p => p.id === state.current); }
function accept(data) { if (!data) return; state = data; render(); }
function render() {
  const p = project(); if (!p) return;
  $('#project-list').innerHTML = state.projects.map(p => `<button class="project-item ${p.id === state.current ? 'active' : ''}" data-project="${escape(p.id)}"><span class="project-letter">${escape(p.name.charAt(0).toUpperCase())}</span><span>${escape(p.name)}</span></button>`).join('');
  $('#project-list').querySelectorAll('button').forEach(button => button.onclick = () => action(async () => { accept(await window.studio.select(button.dataset.project)); $('#search').value = ''; renderCanvas(); }));
  $('#breadcrumb-name').textContent = p.name;
  $('#project-name').innerHTML = escape(p.name) + '<span class="project-dot">.</span>';
  $('#project-description').textContent = p.sample ? 'A sample project. A fresh perspective is a good place to start.' : 'A little space to explore what comes next.';
  $('#footer-location').textContent = 'Watching your local design folder'; renderCanvas();
}
function renderCanvas() {
  if (!state) return;
  const query = $('#search').value.toLowerCase();
  const drafts = state.drafts.filter(d => (d.title + ' ' + d.name).toLowerCase().includes(query));
  $('#draft-count').textContent = `${state.drafts.length} ${state.drafts.length === 1 ? 'design' : 'designs'}`;
  $('#empty').hidden = drafts.length > 0;
  $('#empty h2').textContent = query ? 'No designs match that search.' : 'Every good idea starts somewhere.';
  $('#empty p').hidden = Boolean(query); $('#empty-draft').hidden = Boolean(query);
  resize.disconnect();
  $('#canvas-world').innerHTML = drafts.map((d, i) => `<article class="design-card" tabindex="0" data-name="${escape(d.name)}" aria-label="Open ${escape(d.title)}"><div class="card-heading"><b><span class="card-number">${String(i + 1).padStart(2, '0')}</span>${escape(d.title)}</b><div class="card-menu"><button data-action="edit" title="Edit design" aria-label="Edit ${escape(d.title)}">${icon('edit')}</button><button data-action="duplicate" title="Duplicate design" aria-label="Duplicate ${escape(d.title)}">${icon('duplicate')}</button><button data-action="export" title="Export design" aria-label="Export ${escape(d.title)}">${icon('export')}</button></div></div><div class="frame-wrap ${viewport === 'mobile' ? 'mobile-frame' : ''}">${d.error ? `<div class="card-error">${escape(d.error)}</div>` : '<iframe sandbox="" tabindex="-1" aria-hidden="true"></iframe><div class="frame-cover" title="Double-click to open"></div>'}</div><div class="card-bottom"><span><i></i>${escape(d.name)}</span><span>${viewport === 'mobile' ? '390' : '1100'} px · ${d.name.endsWith('.svg') ? 'SVG' : 'HTML'}</span></div></article>`).join('');
  $('#canvas-world').querySelectorAll('.design-card').forEach((card, index) => {
    const draft = drafts[index]; const frame = card.querySelector('iframe');
    if (frame) frame.srcdoc = documentForPreview(draft.html);
    resize.observe(card.querySelector('.frame-wrap'));
    card.ondblclick = () => openEditor(draft);
    card.onkeydown = event => { if (event.key === 'Enter' && event.target === card) openEditor(draft); };
    card.querySelectorAll('[data-action]').forEach(button => button.onclick = event => {
      event.stopPropagation();
      if (button.dataset.action === 'edit') openEditor(draft);
      if (button.dataset.action === 'duplicate') action(async () => { accept(await window.studio.duplicate(state.current, draft.name)); toast('A new variation is ready.'); });
      if (button.dataset.action === 'export') action(async () => { if (await window.studio.exportDraft(state.current, draft.name)) toast('Design exported.'); });
    });
  });
  $('#canvas-world').style.zoom = zoom;
}
function showForm(mode) {
  formMode = mode; $('#dialog-form').reset(); $('#kind-label').hidden = mode === 'project';
  $('#dialog-title').textContent = mode === 'project' ? 'A new project.' : 'Start a new direction.';
  $('#dialog-description').textContent = mode === 'project' ? 'A home for your next good idea.' : 'A local starter you can make your own. No AI generation.';
  $('#name-label').firstChild.textContent = mode === 'project' ? 'Project name' : 'Draft name';
  $('#dialog-submit').textContent = mode === 'project' ? 'Create project ↗' : 'Create draft ↗';
  $('#form-dialog').showModal(); $('#dialog-name').focus();
}
$('#dialog-form').onsubmit = event => {
  event.preventDefault(); if (event.submitter?.value === 'cancel') { $('#form-dialog').close(); return; }
  action(async () => {
    const name = $('#dialog-name').value.trim(); if (!name) return;
    $('#dialog-submit').disabled = true;
    try { const next = formMode === 'project' ? await window.studio.createProject(name) : await window.studio.createDraft(state.current, name, $('#draft-kind').value); $('#form-dialog').close(); accept(next); toast(formMode === 'project' ? 'Your project is ready.' : 'Draft created. Make it yours.'); }
    finally { $('#dialog-submit').disabled = false; }
  });
};
function openEditor(draft) {
  if (draft.error) { toast(draft.error); return; }
  editor = { ...draft, projectId: state.current, savedHtml: draft.html };
  $('#editor-title').textContent = draft.title; $('#code-editor').value = draft.html; updateEditorPreview();
  $('#editor-status').textContent = 'Changes stay on this computer. Previous saves are kept in history.';
  $('#editor-dialog').showModal();
}
function updateEditorPreview() { $('#editor-preview').srcdoc = documentForPreview($('#code-editor').value); }
let previewTimer;
$('#code-editor').oninput = () => { clearTimeout(previewTimer); previewTimer = setTimeout(updateEditorPreview, 300); $('#editor-status').textContent = 'Unsaved changes'; };
function closeEditor() { if (editor && $('#code-editor').value !== editor.savedHtml && !confirm('Close without saving these edits? Your saved design will stay unchanged.')) return; $('#editor-dialog').close(); editor = null; }
$('#editor-dialog').addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
$('#close-editor').onclick = closeEditor;
$('#save-code').onclick = () => action(async () => {
  if (!editor) return; $('#save-code').disabled = true;
  try { const result = await window.studio.save(editor.projectId, editor.name, $('#code-editor').value, editor.revision); editor.revision = result.revision; editor.savedHtml = result.html; $('#editor-status').textContent = 'Saved locally. The previous version is kept in history.'; toast('Saved. Your previous version is safe.'); accept(await window.studio.load()); }
  finally { $('#save-code').disabled = false; }
});
$('#copy-code').onclick = () => action(async () => { await window.studio.copy($('#code-editor').value); toast('HTML copied.'); });
$('#export-editor').onclick = () => action(async () => { if (editor && await window.studio.exportDraft(editor.projectId, editor.name)) toast('Saved design exported.'); });
$('#new-project').onclick = () => showForm('project'); $('#new-draft').onclick = $('#empty-draft').onclick = () => showForm('draft');
$('#open-project').onclick = () => action(async () => accept(await window.studio.openProject()));
$('#all-projects').onclick = () => { $('#search').value = ''; $('#canvas').scrollTo({ left: 0, top: 0, behavior: 'smooth' }); renderCanvas(); };
$('#folder-button').onclick = () => action(() => window.studio.openFolder(state.current));
$('#import-button').onclick = () => action(async () => { const next = await window.studio.importDraft(state.current); if (next) { accept(next); toast('Designs imported as new local copies.'); } });
$('#search').oninput = renderCanvas;
$('#refresh-button').onclick = () => action(async () => { accept(await window.studio.load()); toast('Your canvas is up to date.'); });
document.querySelectorAll('[data-viewport]').forEach(button => button.onclick = () => { viewport = button.dataset.viewport; document.querySelectorAll('[data-viewport]').forEach(b => b.classList.toggle('active', b === button)); renderCanvas(); });
function setZoom(value) { zoom = Math.max(.5, Math.min(1.5, value)); $('#zoom-label').textContent = Math.round(zoom * 100) + '%'; $('#canvas-world').style.zoom = zoom; }
$('#zoom-in').onclick = () => setZoom(zoom + .1); $('#zoom-out').onclick = () => setZoom(zoom - .1); $('#zoom-label').onclick = () => setZoom(1);
$('#help-button').onclick = () => $('#help-dialog').showModal(); $('#close-help').onclick = () => $('#help-dialog').close();
$('#brief-button').onclick = () => action(async () => { const text = $('#brief').value.trim(); if (!text) { $('#brief').focus(); toast('Write a little about the direction you want to explore.'); return; } await window.studio.brief(state.current, text); $('#brief').value = ''; toast('Brief saved and copied. Paste it into Codex or Claude.'); });
document.querySelectorAll('[data-window]').forEach(button => button.onclick = () => window.studio.window(button.dataset.window));
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 's' && $('#editor-dialog').open) { event.preventDefault(); $('#save-code').click(); } });
window.studio.onChanged(() => { if (!refreshPending) { refreshPending = true; action(async () => { try { accept(await window.studio.load()); } finally { refreshPending = false; } }); } });
window.addEventListener('beforeunload', event => { if (editor && $('#code-editor').value !== editor.savedHtml) { event.preventDefault(); event.returnValue = ''; } });
action(async () => accept(await window.studio.load()));
