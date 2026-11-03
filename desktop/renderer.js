const $ = selector => document.querySelector(selector);
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11H3Z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3c-1 0-1 1-1 2m0 3h.01"/>',
  import: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/>',
  plus: '<path d="M12 4v16M4 12h16"/>', search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8Zm-10 10 10 5 10-5M2 18l10 5 10-5"/>',
  star: '<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4-5.7-3-5.7 3 1.1-6.4L2.8 9.7l6.4-.9Z"/>',
  list: '<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/>',
  tablet: '<rect x="3" y="2" width="18" height="20" rx="2"/><path d="M11 19h2"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="m5 12 4 4L19 6"/>', compare: '<rect x="2" y="4" width="8" height="16" rx="1"/><rect x="14" y="4" width="8" height="16" rx="1"/>',
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
let library = [], mode = 'canvas', view = 'grid', sort = 'name', favoriteOnly = false, category = 'All', initialized = false, viewerItems = [], viewerExample = false;
const selection = new Set();
const previewWidth = () => viewport === 'mobile' ? 390 : viewport === 'tablet' ? 768 : 1100;
const fitFrames = entries => {
  for (const { target } of entries) {
    const frame = target.querySelector('iframe'); if (!frame) continue;
    const width = Number(target.dataset.width) || previewWidth();
    frame.style.width = width + 'px'; frame.style.transform = `scale(${target.clientWidth / width})`;
    frame.style.height = Math.max(850, target.clientHeight / (target.clientWidth / width)) + 'px';
  }
};
const resize = new ResizeObserver(fitFrames);
const viewerResize = new ResizeObserver(fitFrames);
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 5500); }
async function action(callback) { try { return await callback(); } catch (error) { toast(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); return null; } }
function documentForPreview(html) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
  if (/^\s*(<\?xml[^>]*>\s*)?<svg/i.test(html)) return `<!doctype html><html><head>${policy}<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#faf7ef}svg{max-width:100%;max-height:100vh}</style></head><body>${html}</body></html>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, match => match + policy);
  return `<!doctype html><html><head>${policy}</head><body>${html}</body></html>`;
}
function project() { return state?.projects.find(p => p.id === state.current); }
function persist(patch) { action(() => window.studio.preferences(patch)); }
function accept(data) {
  if (!data) return;
  if (state && state.current !== data.current) selection.clear();
  state = data;
  if (!initialized) { ({ viewport = 'desktop', zoom = 1, view = 'grid', sort = 'name' } = data.preferences || {}); initialized = true; $('#sort-designs').value = sort; }
  for (const name of selection) if (!state.drafts.some(d => d.name === name)) selection.delete(name);
  render();
}
function render() {
  const p = project(); if (!p) return;
  $('#project-list').innerHTML = state.projects.map(p => `<button class="project-item ${p.id === state.current ? 'active' : ''}" data-project="${escape(p.id)}"><span class="project-letter">${escape(p.name.charAt(0).toUpperCase())}</span><span>${escape(p.name)}</span></button>`).join('');
  $('#project-list').querySelectorAll('button').forEach(button => button.onclick = () => action(async () => { mode = 'canvas'; accept(await window.studio.select(button.dataset.project)); $('#search').value = ''; renderCanvas(); }));
  $('#breadcrumb-name').textContent = p.name;
  $('#project-name').innerHTML = (mode === 'library' ? 'Find your next direction' : escape(p.name)) + '<span class="project-dot">.</span>';
  $('#project-description').textContent = mode === 'library' ? 'A collection of starting points. Make one completely your own.' : favoriteOnly ? 'The directions you want to come back to.' : p.sample ? 'A sample project. A fresh perspective is a good place to start.' : 'A little space to explore what comes next.';
  $('#favorite-count').textContent = state.drafts.filter(d => d.favorite).length;
  $('#all-projects').classList.toggle('selected', mode === 'canvas' && !favoriteOnly);
  $('#library-button').classList.toggle('selected', mode === 'library');
  $('#favorites-button').classList.toggle('selected', mode === 'canvas' && favoriteOnly);
  $('#footer-location').textContent = 'Watching your local design folder'; renderCanvas();
}
function renderCanvas() {
  if (!state) return;
  const isLibrary = mode === 'library';
  $('#example-library').hidden = !isLibrary; $('#canvas-world').hidden = isLibrary; $('#canvas').classList.toggle('library-mode', isLibrary);
  $('#compare-button').hidden = isLibrary; $('#sort-control').hidden = isLibrary;
  $('#canvas-tab').classList.toggle('active', !isLibrary && view === 'grid'); $('#list-tab').classList.toggle('active', !isLibrary && view === 'list');
  $('#search').placeholder = isLibrary ? 'Find an example' : 'Find a design';
  document.querySelectorAll('[data-viewport]').forEach(button => button.classList.toggle('active', button.dataset.viewport === viewport));
  $('#zoom-label').textContent = Math.round(zoom * 100) + '%';
  $('#selection-count').textContent = selection.size + '/2'; $('#compare-button').disabled = selection.size !== 2;
  resize.disconnect();
  if (isLibrary) { renderLibrary(); return; }
  const query = $('#search').value.toLowerCase();
  const drafts = state.drafts.filter(d => (!favoriteOnly || d.favorite) && (d.title + ' ' + d.name).toLowerCase().includes(query));
  drafts.sort(sort === 'recent' ? (a, b) => (b.updated || '').localeCompare(a.updated || '') : (a, b) => a.title.localeCompare(b.title));
  $('#draft-count').textContent = `${state.drafts.length} ${state.drafts.length === 1 ? 'design' : 'designs'}`;
  $('#empty').hidden = drafts.length > 0;
  $('#empty h2').textContent = query ? 'No designs match that search.' : favoriteOnly ? 'Keep a little inspiration close.' : 'Every good idea starts somewhere.';
  $('#empty p').textContent = favoriteOnly ? 'Star a design on your canvas to keep it here.' : 'Import a design, create a starter, or let Codex and Claude write the next direction into this project.';
  $('#empty p').hidden = Boolean(query); $('#empty-draft').hidden = Boolean(query) || favoriteOnly; $('#empty-library').hidden = Boolean(query) || favoriteOnly;
  $('#canvas-world').classList.toggle('is-list', view === 'list');
  $('#canvas-world').innerHTML = drafts.map((d, i) => `<article class="design-card ${selection.has(d.name) ? 'is-selected' : ''}" tabindex="0" data-name="${escape(d.name)}" aria-label="Open ${escape(d.title)}"><div class="card-heading"><b><span class="card-number">${String(i + 1).padStart(2, '0')}</span>${escape(d.title)}</b><div class="card-menu"><button data-action="preview" title="Focused preview" aria-label="Preview ${escape(d.title)}">${icon('eye')}</button><button data-action="edit" title="Edit design" aria-label="Edit ${escape(d.title)}">${icon('edit')}</button><button data-action="duplicate" title="Duplicate design" aria-label="Duplicate ${escape(d.title)}">${icon('duplicate')}</button><button data-action="export" title="Export design" aria-label="Export ${escape(d.title)}">${icon('export')}</button></div><button data-action="favorite" class="favorite-button ${d.favorite ? 'is-starred' : ''}" aria-pressed="${Boolean(d.favorite)}" title="${d.favorite ? 'Unstar' : 'Star'} design" aria-label="${d.favorite ? 'Unstar' : 'Star'} ${escape(d.title)}">${icon('star')}</button></div><div class="frame-wrap ${viewport === 'mobile' ? 'mobile-frame' : ''}">${d.error ? `<div class="card-error">${escape(d.error)}</div>` : '<iframe sandbox="" scrolling="no" tabindex="-1" aria-hidden="true"></iframe><div class="frame-cover" title="Double-click to edit"></div>'}<button class="compare-pick" data-action="select" aria-pressed="${selection.has(d.name)}" title="Select for comparison" aria-label="Select ${escape(d.title)} for comparison">${selection.has(d.name) ? icon('check') : ''}</button></div><div class="card-bottom"><span><i></i>${escape(d.name)}</span><span>${previewWidth()} px · ${d.name.endsWith('.svg') ? 'SVG' : 'HTML'}</span></div></article>`).join('');
  $('#canvas-world').querySelectorAll('.design-card').forEach((card, index) => {
    const draft = drafts[index]; const frame = card.querySelector('iframe');
    if (frame) frame.srcdoc = documentForPreview(draft.html);
    resize.observe(card.querySelector('.frame-wrap'));
    card.ondblclick = () => openEditor(draft);
    card.onkeydown = event => { if (event.key === 'Enter' && event.target === card) openEditor(draft); if (event.code === 'Space' && event.target === card) { event.preventDefault(); toggleSelection(draft.name); } };
    card.querySelectorAll('[data-action]').forEach(button => button.onclick = event => {
      event.stopPropagation();
      if (button.dataset.action === 'select') toggleSelection(draft.name);
      if (button.dataset.action === 'favorite') action(async () => accept(await window.studio.favorite(state.current, draft.name, !draft.favorite)));
      if (button.dataset.action === 'preview') openViewer([draft]);
      if (button.dataset.action === 'edit') openEditor(draft);
      if (button.dataset.action === 'duplicate') action(async () => { accept(await window.studio.duplicate(state.current, draft.name)); toast('A new variation is ready.'); });
      if (button.dataset.action === 'export') action(async () => { if (await window.studio.exportDraft(state.current, draft.name)) toast('Design exported.'); });
    });
  });
  $('#canvas-world').style.zoom = view === 'list' ? 1 : zoom;
}
function toggleSelection(name) { if (selection.has(name)) selection.delete(name); else if (selection.size < 2) selection.add(name); else { toast('Two directions at a time. Deselect one to choose another.'); return; } renderCanvas(); }
function showLibrary() { mode = 'library'; $('#search').value = ''; render(); $('#canvas').scrollTop = 0; }
function showCanvas(nextView = view, starred = false) { mode = 'canvas'; view = nextView; favoriteOnly = starred; $('#search').value = ''; persist({ view }); render(); $('#canvas').scrollTop = 0; }
function renderLibrary() {
  $('#empty').hidden = true; $('#draft-count').textContent = library.length + ' examples';
  const categories = ['All', ...new Set(library.map(e => e.category))];
  $('#library-filters').innerHTML = categories.map(c => `<button class="${category === c ? 'active' : ''}" data-category="${escape(c)}">${escape(c)}</button>`).join('');
  $('#library-filters').querySelectorAll('button').forEach(button => button.onclick = () => { category = button.dataset.category; renderCanvas(); });
  const query = $('#search').value.toLowerCase(); const visible = library.filter(e => (category === 'All' || category === e.category) && (e.title + ' ' + e.summary).toLowerCase().includes(query));
  $('#library-grid').innerHTML = visible.map(e => `<article class="example-card"><button class="example-preview" data-example="${escape(e.id)}" aria-label="Preview ${escape(e.title)}"><div class="frame-wrap" data-width="${previewWidth()}"><iframe sandbox="" scrolling="no" tabindex="-1" aria-hidden="true"></iframe><div class="example-curtain">${icon('eye')} A closer look</div></div></button><div class="example-detail"><span class="example-category"><i style="background:${e.tone}"></i>${escape(e.category)}</span><h3>${escape(e.title)}</h3><p>${escape(e.summary)}</p><button class="button example-use" data-use="${escape(e.id)}">${icon('plus')} Add to project</button></div></article>`).join('') || '<div class="library-no-results">No examples match. Try another search or category.</div>';
  $('#library-grid').querySelectorAll('.example-card').forEach((card, i) => { card.querySelector('iframe').srcdoc = documentForPreview(visible[i].html); resize.observe(card.querySelector('.frame-wrap')); });
  $('#library-grid').querySelectorAll('[data-example]').forEach(button => button.onclick = () => openViewer([library.find(e => e.id === button.dataset.example)], true));
  $('#library-grid').querySelectorAll('[data-use]').forEach(button => button.onclick = () => useExample(button.dataset.use));
}
function useExample(id) { action(async () => { const next = await window.studio.useExample(state.current, id); $('#viewer-dialog').close(); mode = 'canvas'; favoriteOnly = false; $('#search').value = ''; accept(next); $('#canvas').scrollTop = 0; toast('A fresh copy is on your canvas. Make it your own.'); }); }
function openViewer(items, isExample = false) {
  if (!items.length || items.some(item => !item || item.error)) { toast('That file cannot be previewed. Check its folder and try again.'); return; }
  viewerItems = items; viewerExample = isExample; renderViewer(); if (!$('#viewer-dialog').open) $('#viewer-dialog').showModal();
}
function renderViewer() {
  viewerResize.disconnect();
  $('#viewer-kind').textContent = viewerExample ? 'FROM THE EXAMPLE LIBRARY' : viewerItems.length > 1 ? 'SIDE BY SIDE' : 'DESIGN FOCUS';
  $('#viewer-title').textContent = viewerItems.length > 1 ? 'Two directions. A clearer decision.' : viewerItems[0]?.title || 'A closer look.';
  $('#viewer-edit').hidden = viewerExample || viewerItems.length !== 1;
  $('#viewer-use').hidden = !viewerExample; $('#viewer-hint').hidden = viewerExample;
  $('#viewer-content').innerHTML = viewerItems.map(item => `<section class="viewer-item"><div class="viewer-label">${escape(item.title)}<span>${previewWidth()} px</span></div><div class="viewer-frame" style="max-width:${previewWidth()}px"><iframe sandbox="" title="${escape(item.title)} preview"></iframe></div></section>`).join('');
  $('#viewer-content').querySelectorAll('.viewer-frame').forEach((frame, i) => { frame.querySelector('iframe').srcdoc = documentForPreview(viewerItems[i].html); viewerResize.observe(frame); });
  document.querySelectorAll('[data-view-viewport]').forEach(button => button.classList.toggle('active', button.dataset.viewViewport === viewport));
}
$('#compare-button').onclick = () => openViewer([...selection].map(name => state.drafts.find(d => d.name === name)));
$('#close-viewer').onclick = () => $('#viewer-dialog').close();
$('#viewer-edit').onclick = () => { const draft = viewerItems[0]; $('#viewer-dialog').close(); openEditor(draft); };
$('#viewer-use').onclick = () => useExample(viewerItems[0].id);
document.querySelectorAll('[data-view-viewport]').forEach(button => button.onclick = () => { viewport = button.dataset.viewViewport; persist({ viewport }); renderViewer(); renderCanvas(); });
function showForm(mode) {
  formMode = mode; $('#dialog-form').reset(); $('#kind-label').hidden = mode !== 'draft';
  $('#dialog-title').textContent = mode === 'rename' ? 'A name that fits.' : mode === 'project' ? 'A new project.' : 'Start a new direction.';
  $('#dialog-description').textContent = mode === 'rename' ? 'Change the name here. Your folder and files stay in place.' : mode === 'project' ? 'A home for your next good idea.' : 'A local starter you can make your own. No AI generation.';
  $('#name-label').firstChild.textContent = mode === 'draft' ? 'Draft name' : 'Project name';
  $('#dialog-submit').textContent = mode === 'rename' ? 'Save name ↗' : mode === 'project' ? 'Create project ↗' : 'Create draft ↗';
  if (mode === 'rename') $('#dialog-name').value = project().name;
  $('#form-dialog').showModal(); $('#dialog-name').focus();
}
$('#dialog-form').onsubmit = event => {
  event.preventDefault(); if (event.submitter?.value === 'cancel') { $('#form-dialog').close(); return; }
  action(async () => {
    const name = $('#dialog-name').value.trim(); if (!name) return;
    $('#dialog-submit').disabled = true;
    try { const next = formMode === 'rename' ? await window.studio.renameProject(state.current, name) : formMode === 'project' ? await window.studio.createProject(name) : await window.studio.createDraft(state.current, name, $('#draft-kind').value); $('#form-dialog').close(); if (formMode !== 'rename') { mode = 'canvas'; favoriteOnly = false; } accept(next); toast(formMode === 'rename' ? 'Project name updated.' : formMode === 'project' ? 'Your project is ready.' : 'Draft created. Make it yours.'); }
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
$('#all-projects').onclick = () => { showCanvas(view); $('#canvas').scrollTo({ left: 0, top: 0, behavior: 'smooth' }); };
$('#canvas-tab').onclick = () => showCanvas('grid', favoriteOnly); $('#list-tab').onclick = () => showCanvas('list', favoriteOnly);
$('#library-button').onclick = $('#empty-library').onclick = showLibrary;
$('#favorites-button').onclick = () => showCanvas(view, true);
$('#rename-project').onclick = () => showForm('rename');
$('#sort-designs').onchange = () => { sort = $('#sort-designs').value; persist({ sort }); renderCanvas(); };
$('#folder-button').onclick = () => action(() => window.studio.openFolder(state.current));
$('#import-button').onclick = () => action(async () => { const next = await window.studio.importDraft(state.current); if (next) { accept(next); toast('Designs imported as new local copies.'); } });
$('#search').oninput = renderCanvas;
$('#refresh-button').onclick = () => action(async () => { accept(await window.studio.load()); toast('Your canvas is up to date.'); });
document.querySelectorAll('[data-viewport]').forEach(button => button.onclick = () => { viewport = button.dataset.viewport; persist({ viewport }); renderCanvas(); });
function setZoom(value) { zoom = Math.max(.5, Math.min(1.5, value)); $('#zoom-label').textContent = Math.round(zoom * 100) + '%'; $('#canvas-world').style.zoom = view === 'list' ? 1 : zoom; persist({ zoom }); }
$('#zoom-in').onclick = () => setZoom(zoom + .1); $('#zoom-out').onclick = () => setZoom(zoom - .1); $('#zoom-label').onclick = () => setZoom(1);
$('#help-button').onclick = () => $('#help-dialog').showModal(); $('#close-help').onclick = () => $('#help-dialog').close();
let assistants = [];
function assistantStatus() {
  const id = $('#assistant').value, client = assistants.find(c => c.id === id);
  $('#assistant-status').textContent = client ? `${client.status}. ${client.detail}` : 'Save a brief, then paste it into your coding assistant.';
  $('#brief-button').title = $('#brief-button').ariaLabel = client ? `Save brief and open ${client.name}` : 'Save and copy design brief';
}
async function refreshAssistants() {
  $('#refresh-assistants').disabled = true;
  try {
    assistants = await window.studio.assistants();
    for (const client of assistants) $('#assistant').querySelector(`[value="${client.id}"]`).textContent = `${client.name}${client.available ? '' : ' (unavailable)'}`;
    assistantStatus();
  } finally { $('#refresh-assistants').disabled = false; }
}
$('#assistant').onchange = assistantStatus;
$('#refresh-assistants').onclick = () => action(refreshAssistants);
$('#brief-button').onclick = () => action(async () => {
  const text = $('#brief').value.trim();
  if (!text) { $('#brief').focus(); toast('Write a little about the direction you want to explore.'); return; }
  const button = $('#brief-button'); button.disabled = true;
  try {
    if ($('#assistant').value === 'copy') { await window.studio.brief(state.current, text); toast('Brief saved and copied. Paste it into your assistant.'); }
    else {
      const result = await window.studio.openAssistant(state.current, $('#assistant').value, text);
      toast(result.kind === 'terminal' ? `Brief saved. ${result.name} project terminal requested.` : `Brief saved and copied. Paste it in ${result.name}, then import the design.`);
    }
    $('#brief').value = '';
  } finally { button.disabled = false; }
});
document.querySelectorAll('[data-window]').forEach(button => button.onclick = () => window.studio.window(button.dataset.window));
document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key === 's' && $('#editor-dialog').open) { event.preventDefault(); $('#save-code').click(); }
  if (document.querySelector('dialog[open]')) return;
  if (event.key.toLowerCase() === 'n') { event.preventDefault(); showForm(event.shiftKey ? 'project' : 'draft'); }
  if (event.key.toLowerCase() === 'f') { event.preventDefault(); $('#search').focus(); $('#search').select(); }
});
window.studio.onChanged(() => { if (!refreshPending) { refreshPending = true; action(async () => { try { accept(await window.studio.load()); } finally { refreshPending = false; } }); } });
window.addEventListener('beforeunload', event => { if (editor && $('#code-editor').value !== editor.savedHtml) { event.preventDefault(); event.returnValue = ''; } });
$('.main').insertBefore($('.brief-box'), $('.canvas-footer'));
action(async () => { library = await window.studio.library(); accept(await window.studio.load()); await refreshAssistants(); });
