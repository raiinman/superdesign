const { contextBridge, ipcRenderer } = require('electron');
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('studio', {
  load: () => invoke('studio:load'), select: id => invoke('studio:select', id),
  createProject: name => invoke('studio:create-project', name), openProject: () => invoke('studio:open-project'),
  openFolder: id => invoke('studio:open-folder', id), importDraft: id => invoke('studio:import', id),
  createDraft: (id, title, kind) => invoke('studio:create-draft', id, title, kind),
  save: (id, name, html, revision) => invoke('studio:save', id, name, html, revision),
  duplicate: (id, name) => invoke('studio:duplicate', id, name), exportDraft: (id, name) => invoke('studio:export', id, name),
  brief: (id, text) => invoke('studio:brief', id, text), copy: text => invoke('studio:copy', text),
  window: action => invoke('studio:window', action),
  onChanged: callback => { const listener = () => callback(); ipcRenderer.on('studio:changed', listener); return () => ipcRenderer.removeListener('studio:changed', listener); }
});
