'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const { spawn, exec } = require('child_process');
const http = require('http');
const netSocket = require('net');
const { pathToFileURL } = require('url');
const megosztas = require('./megosztas');

const APP_ROOT = __dirname;
const IS_WIN = process.platform === 'win32';

// ---------------------------------------------------------------------------
// app:// protokoll  (kell a Monaco worker-eihez: file:// alatt nem indulnak el)
// ---------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }
]);

// ---------------------------------------------------------------------------
// Adattarolas
// ---------------------------------------------------------------------------
let STORE_FILE = null;

const DEFAULT_STORE = {
  version: 1,
  settings: {
    vscodiumPath: '',
    xamppPath: IS_WIN ? 'C:\\xampp' : '/opt/lampp',
    htdocsPath: IS_WIN ? 'C:\\xampp\\htdocs' : '/opt/lampp/htdocs',
    driveFolder: '',
    theme: 'dark'
  },
  projects: []
};

function readStore() {
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const data = JSON.parse(raw);
    data.settings = Object.assign({}, DEFAULT_STORE.settings, data.settings || {});
    data.projects = Array.isArray(data.projects) ? data.projects : [];
    return data;
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_STORE));
  }
}

function writeStore(data) {
  const tmp = STORE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, STORE_FILE);
  return true;
}

// ---------------------------------------------------------------------------
// Segedfuggvenyek
// ---------------------------------------------------------------------------
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', 'vendor', 'dist', 'build', '.cache', '.next', '__pycache__']);
const TEXT_EXT = new Set([
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
  '.json', '.md', '.txt', '.php', '.sql', '.xml', '.yml', '.yaml', '.env', '.ini', '.cfg', '.conf',
  '.py', '.java', '.c', '.h', '.cpp', '.cs', '.sh', '.bat', '.ps1', '.svg', '.htaccess', '.gitignore'
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf'
};
function mimeOf(p) {
  return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

function langFromExt(ext) {
  const map = {
    '.html': 'html', '.htm': 'html', '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript', '.json': 'json', '.md': 'markdown',
    '.php': 'php', '.sql': 'sql', '.xml': 'xml', '.svg': 'xml', '.yml': 'yaml', '.yaml': 'yaml',
    '.py': 'python', '.java': 'java', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cs': 'csharp',
    '.sh': 'shell', '.bat': 'bat', '.ps1': 'powershell', '.ini': 'ini', '.txt': 'plaintext'
  };
  return map[ext] || 'plaintext';
}

async function buildTree(root, rel = '', depth = 0) {
  if (depth > 8) return [];
  const abs = path.join(root, rel);
  let entries;
  try {
    entries = await fsp.readdir(abs, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.htaccess' && e.name !== '.env' && e.name !== '.gitignore') continue;
    const childRel = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push({
        name: e.name,
        rel: childRel,
        abs: path.join(root, childRel),
        dir: true,
        children: await buildTree(root, childRel, depth + 1)
      });
    } else if (e.isFile()) {
      out.push({
        name: e.name,
        rel: childRel,
        abs: path.join(root, childRel),
        dir: false,
        ext: path.extname(e.name).toLowerCase()
      });
    }
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'hu') : a.dir ? -1 : 1));
  return out;
}

function portOpen(port, host = '127.0.0.1', timeout = 700) {
  return new Promise((resolve) => {
    const sock = new netSocket.Socket();
    let done = false;
    const finish = (v) => { if (!done) { done = true; sock.destroy(); resolve(v); } };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

function firstExisting(list) {
  for (const p of list) {
    try { if (p && fs.existsSync(p)) return p; } catch (e) { /* ignore */ }
  }
  return '';
}

function detectVSCodium() {
  const home = os.homedir();
  if (IS_WIN) {
    return firstExisting([
      path.join(home, 'AppData', 'Local', 'Programs', 'VSCodium', 'VSCodium.exe'),
      'C:\\Program Files\\VSCodium\\VSCodium.exe',
      'C:\\Program Files (x86)\\VSCodium\\VSCodium.exe',
      path.join(home, 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'Code.exe'),
      'C:\\Program Files\\Microsoft VS Code\\Code.exe'
    ]);
  }
  return firstExisting(['/usr/bin/codium', '/usr/local/bin/codium', '/snap/bin/codium', '/usr/bin/code']);
}

function detectXampp() {
  if (IS_WIN) return firstExisting(['C:\\xampp', 'D:\\xampp', path.join(os.homedir(), 'xampp')]);
  return firstExisting(['/opt/lampp']);
}

function detectDrive() {
  const home = os.homedir();
  const candidates = [];
  if (IS_WIN) {
    for (const letter of ['G', 'H', 'I', 'J']) {
      candidates.push(`${letter}:\\My Drive`);
      candidates.push(`${letter}:\\Sajat meghajto`);
      candidates.push(`${letter}:\\Saját meghajtó`);
    }
    candidates.push(path.join(home, 'Google Drive'));
    candidates.push(path.join(home, 'My Drive'));
  } else {
    candidates.push(path.join(home, 'GoogleDrive'));
    candidates.push(path.join(home, 'Google Drive'));
  }
  return firstExisting(candidates);
}

async function copyDir(src, dest, stats) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && SKIP_DIRS.has(e.name)) { stats.skipped++; continue; }
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d, stats);
    } else if (e.isFile()) {
      await fsp.copyFile(s, d);
      stats.files++;
      stats.bytes += (await fsp.stat(d)).size;
    }
  }
}

// ---------------------------------------------------------------------------
// Beepitett elonezet-szerver (sima HTML oldalakhoz, XAMPP nelkul)
// ---------------------------------------------------------------------------
const previewServers = new Map(); // root -> { server, port }

function startPreviewServer(root) {
  const key = path.normalize(root);
  const existing = previewServers.get(key);
  if (existing) return Promise.resolve(existing.port);

  const server = http.createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (urlPath.endsWith('/')) urlPath += 'index.html';
      let target = path.normalize(path.join(key, urlPath));
      if (target !== key && !target.startsWith(key + path.sep)) {
        res.writeHead(403); return res.end('Forbidden');
      }
      let st = await fsp.stat(target).catch(() => null);
      if (st && st.isDirectory()) {
        target = path.join(target, 'index.html');
        st = await fsp.stat(target).catch(() => null);
      }
      if (!st) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        return res.end('<body style="font-family:system-ui;padding:40px;color:#444">'
          + '<h2>404 &mdash; nincs ilyen fajl</h2><p><code>' + urlPath + '</code></p>'
          + '<p>Van index.html a projekt mappajaban?</p></body>');
      }
      const buf = await fsp.readFile(target);
      res.writeHead(200, { 'content-type': mimeOf(target), 'cache-control': 'no-store' });
      res.end(buf);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String((e && e.message) || e));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      previewServers.set(key, { server, port });
      resolve(port);
    });
  });
}

function stopPreviewServer(root) {
  const key = path.normalize(root || '');
  const rec = previewServers.get(key);
  if (rec) { try { rec.server.close(); } catch (e) {} previewServers.delete(key); }
}

function stopAllPreviewServers() {
  for (const [, rec] of previewServers) { try { rec.server.close(); } catch (e) {} }
  previewServers.clear();
}

// Mit tartalmaz a projekt? Ez donti el az "automatikus" modot.
async function inspectProject(root) {
  const out = { hasIndex: false, hasPhp: false, exists: false };
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    out.exists = true;
    for (const e of entries) {
      const low = e.name.toLowerCase();
      if (e.isFile() && (low === 'index.html' || low === 'index.htm')) out.hasIndex = true;
      if (e.isFile() && low.endsWith('.php')) out.hasPhp = true;
    }
    if (!out.hasPhp) {
      for (const e of entries) {
        if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        const sub = await fsp.readdir(path.join(root, e.name)).catch(() => []);
        if (sub.some((n) => n.toLowerCase().endsWith('.php'))) { out.hasPhp = true; break; }
      }
    }
  } catch (e) { /* nincs mappa */ }
  return out;
}

// ---------------------------------------------------------------------------
// Ablak
// ---------------------------------------------------------------------------
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#12131a',
    show: false,
    autoHideMenuBar: true,
    title: 'Projekt Hub',
    webPreferences: {
      preload: path.join(APP_ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL('app://local/src/index.html');

  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Kulso linkek ne az appban nyiljanak meg (kiveve a beagyazott elonezet)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  STORE_FILE = path.join(app.getPath('userData'), 'projekt-hub-data.json');
  if (!fs.existsSync(STORE_FILE)) writeStore(DEFAULT_STORE);

  // fs-alapu kiszolgalas: asar csomagban is mukodik (a net.fetch(file://) nem mindig)
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname);
      if (rel.startsWith('/')) rel = rel.slice(1);
      const target = path.normalize(path.join(APP_ROOT, rel));
      if (!target.startsWith(APP_ROOT)) return new Response('Forbidden', { status: 403 });
      const buf = await fsp.readFile(target);
      return new Response(buf, { headers: { 'content-type': mimeOf(target) } });
    } catch (e) {
      return new Response('Not found', { status: 404 });
    }
  });

  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
const ok = (data) => ({ ok: true, data });
const fail = (e) => ({ ok: false, error: (e && e.message) || String(e) });

ipcMain.handle('store:load', async () => {
  try { return ok(readStore()); } catch (e) { return fail(e); }
});

ipcMain.handle('store:save', async (_e, data) => {
  try { writeStore(data); return ok(true); } catch (e) { return fail(e); }
});

ipcMain.handle('store:path', async () => ok(STORE_FILE));

ipcMain.handle('store:export', async () => {
  try {
    const stamp = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Adatok mentése',
      defaultPath: `projekt-hub-mentes-${stamp}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (r.canceled) return ok(null);
    await fsp.writeFile(r.filePath, JSON.stringify(readStore(), null, 2), 'utf8');
    return ok(r.filePath);
  } catch (e) { return fail(e); }
});

ipcMain.handle('store:import', async () => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Mentés betöltése',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (r.canceled) return ok(null);
    const data = JSON.parse(await fsp.readFile(r.filePaths[0], 'utf8'));
    if (!data || !Array.isArray(data.projects)) return fail(new Error('Ez nem Projekt Hub mentés.'));
    data.settings = Object.assign({}, DEFAULT_STORE.settings, data.settings || {});
    writeStore(data);
    return ok(data);
  } catch (e) { return fail(e); }
});

ipcMain.handle('detect:all', async () => {
  try {
    return ok({
      vscodiumPath: detectVSCodium(),
      xamppPath: detectXampp(),
      driveFolder: detectDrive()
    });
  } catch (e) { return fail(e); }
});

ipcMain.handle('dialog:pickFolder', async (_e, title) => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Mappa kivalasztasa',
      properties: ['openDirectory', 'createDirectory']
    });
    return ok(r.canceled ? null : r.filePaths[0]);
  } catch (e) { return fail(e); }
});

ipcMain.handle('dialog:pickFile', async (_e, opts) => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: (opts && opts.title) || 'Fajl kivalasztasa',
      properties: (opts && opts.multi) ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: (opts && opts.filters) || []
    });
    return ok(r.canceled ? null : (opts && opts.multi ? r.filePaths : r.filePaths[0]));
  } catch (e) { return fail(e); }
});

ipcMain.handle('fs:tree', async (_e, root) => {
  try {
    if (!root || !fs.existsSync(root)) return fail(new Error('A projekt mappaja nem talalhato: ' + root));
    return ok(await buildTree(root));
  } catch (e) { return fail(e); }
});

ipcMain.handle('fs:read', async (_e, file) => {
  try {
    const ext = path.extname(file).toLowerCase();
    const st = await fsp.stat(file);
    if (st.size > 2 * 1024 * 1024) return fail(new Error('A fajl tul nagy a beepitett szerkesztohoz (>2 MB).'));
    if (!TEXT_EXT.has(ext) && ext !== '') {
      return ok({ binary: true, ext, size: st.size, content: '' });
    }
    const content = await fsp.readFile(file, 'utf8');
    return ok({ binary: false, ext, size: st.size, content, language: langFromExt(ext) });
  } catch (e) { return fail(e); }
});

ipcMain.handle('fs:write', async (_e, { file, content }) => {
  try { await fsp.writeFile(file, content, 'utf8'); return ok(true); } catch (e) { return fail(e); }
});

ipcMain.handle('fs:newFile', async (_e, { dir, name }) => {
  try {
    const target = path.join(dir, name);
    if (fs.existsSync(target)) return fail(new Error('Mar letezik ilyen nevu fajl.'));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, '', 'utf8');
    return ok(target);
  } catch (e) { return fail(e); }
});

ipcMain.handle('fs:exists', async (_e, p) => ok(!!p && fs.existsSync(p)));

ipcMain.handle('open:vscodium', async (_e, { exe, target }) => {
  try {
    const bin = exe || detectVSCodium();
    if (!bin) return fail(new Error('Nem talalom a VSCodiumot. Add meg a Beallitasokban.'));
    const child = spawn(bin, [target], { detached: true, stdio: 'ignore', shell: false });
    child.unref();
    return ok(true);
  } catch (e) { return fail(e); }
});

ipcMain.handle('open:explorer', async (_e, p) => {
  try { shell.openPath(p); return ok(true); } catch (e) { return fail(e); }
});

ipcMain.handle('open:external', async (_e, url) => {
  try { await shell.openExternal(url); return ok(true); } catch (e) { return fail(e); }
});

ipcMain.handle('open:terminal', async (_e, dir) => {
  try {
    if (IS_WIN) {
      spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/K', `cd /d "${dir}"`], { detached: true, stdio: 'ignore', shell: false }).unref();
    } else {
      spawn('x-terminal-emulator', [], { cwd: dir, detached: true, stdio: 'ignore' }).unref();
    }
    return ok(true);
  } catch (e) { return fail(e); }
});

// --- XAMPP ---------------------------------------------------------------
function xamppScript(xamppPath, service, action) {
  if (IS_WIN) {
    const file = `${service}_${action}.bat`; // apache_start.bat, mysql_stop.bat ...
    return path.join(xamppPath, file);
  }
  return path.join(xamppPath, 'lampp');
}

ipcMain.handle('xampp:status', async () => {
  try {
    const [apache, mysql] = await Promise.all([portOpen(80), portOpen(3306)]);
    return ok({ apache, mysql });
  } catch (e) { return fail(e); }
});

ipcMain.handle('xampp:control', async (_e, { xamppPath, service, action }) => {
  try {
    const base = xamppPath || detectXampp();
    if (!base || !fs.existsSync(base)) return fail(new Error('Nem talalom a XAMPP mappat. Add meg a Beallitasokban.'));

    if (IS_WIN) {
      const script = xamppScript(base, service, action);
      if (!fs.existsSync(script)) return fail(new Error('Nem talalom: ' + script));
      spawn('cmd.exe', ['/c', script], { cwd: base, detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      exec(`"${path.join(base, 'lampp')}" ${action}${service === 'apache' ? 'apache' : 'mysql'}`);
    }
    return ok(true);
  } catch (e) { return fail(e); }
});

ipcMain.handle('xampp:panel', async (_e, xamppPath) => {
  try {
    const base = xamppPath || detectXampp();
    const exe = IS_WIN ? path.join(base, 'xampp-control.exe') : path.join(base, 'manager-linux-x64.run');
    if (!fs.existsSync(exe)) return fail(new Error('Nem talalom a XAMPP vezerlopultot: ' + exe));
    spawn(exe, [], { cwd: base, detached: true, stdio: 'ignore' }).unref();
    return ok(true);
  } catch (e) { return fail(e); }
});

// --- Drive ---------------------------------------------------------------
ipcMain.handle('drive:upload', async (_e, { source, driveFolder, subfolder, files }) => {
  try {
    if (!driveFolder || !fs.existsSync(driveFolder)) {
      return fail(new Error('A Drive mappa nincs beallitva vagy nem letezik. Nezd meg a Beallitasokat.'));
    }
    const dest = path.join(driveFolder, subfolder || path.basename(source || 'projekt'));
    const stats = { files: 0, bytes: 0, skipped: 0 };

    if (Array.isArray(files) && files.length) {
      await fsp.mkdir(dest, { recursive: true });
      for (const f of files) {
        const d = path.join(dest, path.basename(f));
        await fsp.copyFile(f, d);
        stats.files++;
        stats.bytes += (await fsp.stat(d)).size;
      }
    } else {
      if (!source || !fs.existsSync(source)) return fail(new Error('A projekt mappaja nem letezik: ' + source));
      await copyDir(source, dest, stats);
    }
    return ok({ dest, ...stats });
  } catch (e) { return fail(e); }
});

ipcMain.handle('drive:openFolder', async (_e, p) => {
  try { shell.openPath(p); return ok(true); } catch (e) { return fail(e); }
});

// --- Beepitett elonezet ---------------------------------------------------
ipcMain.handle('preview:inspect', async (_e, root) => {
  try { return ok(await inspectProject(root)); } catch (e) { return fail(e); }
});

ipcMain.handle('preview:serve', async (_e, root) => {
  try {
    if (!root || !fs.existsSync(root)) return fail(new Error('A projekt mappaja nem letezik: ' + root));
    const port = await startPreviewServer(root);
    return ok({ url: 'http://127.0.0.1:' + port + '/', port });
  } catch (e) { return fail(e); }
});

ipcMain.handle('preview:stop', async (_e, root) => {
  try { stopPreviewServer(root); return ok(true); } catch (e) { return fail(e); }
});

// ---------------------------------------------------------------------------
// Megosztas  (reszletek: megosztas.js)
//
// Minden megosztott projekt kap egy sajat, apro git-repot az app adatmappajaban.
// A projekt SAJAT kodrepojahoz nem nyulunk hozza — lasd a megosztas.js elejen
// a magyarazatot.
// ---------------------------------------------------------------------------
function megosztasMappa(projektId) {
  const tiszta = String(projektId || '').replace(/[^A-Za-z0-9_-]/g, '') || 'x';
  return path.join(app.getPath('userData'), 'megosztas', tiszta);
}

ipcMain.handle('share:git', async () => {
  try {
    const g = await megosztas.gitElerheto();
    const szemely = g.ok ? await megosztas.gitSzemely() : { nev: '', email: '' };
    return ok({ ok: g.ok, verzio: g.verzio || '', uzenet: g.uzenet || '', szemely });
  } catch (e) { return fail(e); }
});

ipcMain.handle('share:sync', async (_e, { projektId, repoUrl, helyi, en }) => {
  try {
    const r = await megosztas.szinkron({
      dir: megosztasMappa(projektId),
      repoUrl, helyi, en,
      uzenet: `${(en && en.nev) || 'valaki'} — Projekt Hub`
    });
    return ok(r);
  } catch (e) { return fail(e); }
});

ipcMain.handle('share:read', async (_e, { projektId, repoUrl, en }) => {
  try {
    return ok(await megosztas.beolvas({ dir: megosztasMappa(projektId), repoUrl, en }));
  } catch (e) { return fail(e); }
});

ipcMain.handle('share:folder', async (_e, projektId) => {
  try {
    const d = megosztasMappa(projektId);
    await fsp.mkdir(d, { recursive: true });
    return ok(d);
  } catch (e) { return fail(e); }
});

ipcMain.handle('share:detach', async (_e, projektId) => {
  try {
    await fsp.rm(megosztasMappa(projektId), { recursive: true, force: true });
    return ok(true);
  } catch (e) { return fail(e); }
});

app.on('before-quit', stopAllPreviewServers);
