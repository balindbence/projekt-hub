'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('api', {
  store: {
    load: () => call('store:load'),
    save: (data) => call('store:save', data),
    path: () => call('store:path'),
    export: () => call('store:export'),
    import: () => call('store:import')
  },
  detect: {
    all: () => call('detect:all')
  },
  dialog: {
    pickFolder: (title) => call('dialog:pickFolder', title),
    pickFile: (opts) => call('dialog:pickFile', opts)
  },
  fs: {
    tree: (root) => call('fs:tree', root),
    read: (file) => call('fs:read', file),
    write: (file, content) => call('fs:write', { file, content }),
    newFile: (dir, name) => call('fs:newFile', { dir, name }),
    exists: (p) => call('fs:exists', p)
  },
  open: {
    vscodium: (exe, target) => call('open:vscodium', { exe, target }),
    explorer: (p) => call('open:explorer', p),
    external: (url) => call('open:external', url),
    terminal: (dir) => call('open:terminal', dir)
  },
  xampp: {
    status: () => call('xampp:status'),
    control: (xamppPath, service, action) => call('xampp:control', { xamppPath, service, action }),
    panel: (xamppPath) => call('xampp:panel', xamppPath)
  },
  drive: {
    upload: (payload) => call('drive:upload', payload),
    openFolder: (p) => call('drive:openFolder', p)
  },
  platform: process.platform,
  sep: process.platform === 'win32' ? '\\' : '/'
});
