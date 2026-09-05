'use strict';

/* =========================================================================
   Projekt Hub - renderer
   ========================================================================= */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let STORE = { settings: {}, projects: [] };
let currentId = null;
let editor = null;
let openFile = null;
let dirty = false;
let saveTimer = null;

const STATUS_LABEL = {
  planning: 'Tervezés', in_progress: 'Folyamatban', review: 'Átnézés',
  done: 'Kész', paused: 'Szünetel'
};
const TYPE_LABEL = { todo: 'Teendő', idea: 'Ötlet', bug: 'Hiba', missing: 'Kimaradt' };
const PRIO_LABEL = { high: 'Fontos', normal: 'Normál', low: 'Ráér' };

/* ---------------------- segedek ---------------------- */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('bad', !!bad);
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 3200);
}

function log(msg, kind = '') {
  const el = $('#log');
  if (!el) return;
  const d = document.createElement('div');
  d.className = kind;
  d.textContent = `[${new Date().toLocaleTimeString('hu-HU')}] ${msg}`;
  el.prepend(d);
  while (el.children.length > 120) el.removeChild(el.lastChild);
}

function baseName(p) {
  if (!p) return '';
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

function project() {
  return STORE.projects.find((p) => p.id === currentId) || null;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 350);
}

async function persist() {
  const r = await window.api.store.save(STORE);
  if (!r.ok) toast('Mentési hiba: ' + r.error, true);
}

function touch(p) {
  p.updatedAt = new Date().toISOString();
}

/* ---------------------- projektlista ---------------------- */

function renderProjectList() {
  const q = ($('#searchInput').value || '').toLowerCase().trim();
  const list = $('#projectList');
  list.innerHTML = '';

  const items = STORE.projects.filter((p) =>
    !q || (p.name || '').toLowerCase().includes(q) || (p.path || '').toLowerCase().includes(q)
  );

  if (!items.length) {
    list.innerHTML = '<div class="empty-line" style="padding:10px">Nincs találat.</div>';
    return;
  }

  for (const p of items) {
    const open = (p.notes || []).filter((n) => !n.done).length;
    const el = document.createElement('div');
    el.className = 'p-item' + (p.id === currentId ? ' active' : '');
    el.innerHTML = `
      <div class="p-top">
        <span class="proj-dot" style="background:${p.color || '#7c5cff'}"></span>
        <span class="p-name"></span>
        <span class="p-pct">${p.progress || 0}%</span>
      </div>
      <div class="p-bar"><span style="width:${p.progress || 0}%;background:${p.color || '#7c5cff'}"></span></div>
      <div class="p-meta"><span>${STATUS_LABEL[p.status] || ''}</span>${open ? `<span>• ${open} teendő</span>` : ''}</div>`;
    el.querySelector('.p-name').textContent = p.name || '(névtelen)';
    el.addEventListener('click', () => selectProject(p.id));
    list.appendChild(el);
  }
}

/* ---------------------- projekt betoltes ---------------------- */

function selectProject(id) {
  currentId = id;
  const p = project();
  if (!p) return;

  $('#emptyState').classList.add('hidden');
  $('#workspace').classList.remove('hidden');

  $('#projName').textContent = p.name || '(névtelen)';
  $('#projPath').textContent = p.path || 'nincs mappa megadva';
  $('#projDot').style.background = p.color || '#7c5cff';

  $('#fName').value = p.name || '';
  $('#fPath').value = p.path || '';
  $('#fPreview').value = p.previewUrl || '';
  $('#fDriveSub').value = p.driveSubfolder || '';
  $('#fDesc').value = p.description || '';
  $('#projStatus').value = p.status || 'in_progress';
  $('#projDeadline').value = p.deadline || '';
  $('#progressRange').value = p.progress || 0;

  setRing(p.progress || 0);
  renderDeadline(p);
  renderNotes();
  renderProjectList();

  $('#fPreviewMode').value = p.previewMode || 'auto';
  $('#pvMode').value = p.previewMode || 'auto';
  $('#pvUrl').value = p.previewUrl || '';
  $('#pvInfo').textContent = '';
  openFile = null;
  dirty = false;
  $('#openFileName').textContent = 'Válassz egy fájlt balról';
  $('#btnSaveFile').disabled = true;
  $('#editorPlaceholder').classList.remove('hidden');
  if (editor) editor.setValue('');
  loadTree();
}

function setRing(v) {
  const C = 2 * Math.PI * 52;
  const fg = $('#ringFg');
  fg.style.strokeDasharray = C;
  fg.style.strokeDashoffset = C * (1 - v / 100);
  fg.style.stroke = v >= 100 ? 'var(--accent2)' : 'var(--accent)';
  $('#ringLabel').textContent = v + '%';
}

function renderDeadline(p) {
  const el = $('#deadlineHint');
  if (!p.deadline) { el.textContent = ''; return; }
  const d = new Date(p.deadline + 'T23:59:59');
  const days = Math.ceil((d - new Date()) / 86400000);
  if (days < 0) { el.textContent = `⚠ ${Math.abs(days)} napja lejárt`; el.style.color = 'var(--danger)'; }
  else if (days === 0) { el.textContent = 'Ma van a határidő'; el.style.color = 'var(--warn)'; }
  else { el.textContent = `Még ${days} nap`; el.style.color = days <= 3 ? 'var(--warn)' : 'var(--muted)'; }
}

/* ---------------------- jegyzetek ---------------------- */

function renderNotes() {
  const p = project();
  if (!p) return;
  const showDone = $('#showDone').checked;
  const notes = (p.notes || []).slice().sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const rank = { high: 0, normal: 1, low: 2 };
    return (rank[a.prio] ?? 1) - (rank[b.prio] ?? 1);
  });

  const open = notes.filter((n) => !n.done);
  const badge = $('#notesBadge');
  badge.textContent = open.length;
  badge.classList.toggle('zero', open.length === 0);

  const visible = showDone ? notes : open;
  $('#noteList').innerHTML = '';
  if (!visible.length) {
    $('#noteList').innerHTML = '<div class="empty-line">Nincs jegyzet. Ha eszedbe jut egy kimaradt funkció, írd ide fel.</div>';
  } else {
    visible.forEach((n) => $('#noteList').appendChild(noteEl(n)));
  }

  const mini = $('#overviewNotes');
  mini.innerHTML = '';
  const top = open.slice(0, 5);
  if (!top.length) mini.innerHTML = '<div class="empty-line">Nincs nyitott teendő. 🎉</div>';
  else top.forEach((n) => mini.appendChild(noteEl(n)));
}

function noteEl(n) {
  const p = project();
  const el = document.createElement('div');
  el.className = `note ${n.prio || 'normal'}${n.done ? ' done' : ''}`;

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!n.done;
  cb.addEventListener('change', () => {
    n.done = cb.checked;
    n.doneAt = cb.checked ? new Date().toISOString() : null;
    touch(p); scheduleSave(); renderNotes(); renderProjectList();
  });

  const body = document.createElement('div');
  body.className = 'n-body';
  const txt = document.createElement('div');
  txt.className = 'n-text';
  txt.textContent = n.text;
  const meta = document.createElement('div');
  meta.className = 'n-meta';
  meta.innerHTML = `<span class="tag">${TYPE_LABEL[n.type] || n.type}</span><span class="tag">${PRIO_LABEL[n.prio] || ''}</span><span>${new Date(n.created).toLocaleDateString('hu-HU')}</span>`;
  body.append(txt, meta);

  const del = document.createElement('button');
  del.className = 'n-del';
  del.textContent = '✕';
  del.title = 'Törlés';
  del.addEventListener('click', () => {
    p.notes = p.notes.filter((x) => x.id !== n.id);
    touch(p); scheduleSave(); renderNotes(); renderProjectList();
  });

  el.append(cb, body, del);
  return el;
}

/* ---------------------- fajlfa + szerkeszto ---------------------- */

async function loadTree() {
  const p = project();
  const box = $('#fileTree');
  box.innerHTML = '';
  if (!p || !p.path) { box.innerHTML = '<div class="empty-line">Nincs mappa megadva.</div>'; return; }

  const r = await window.api.fs.tree(p.path);
  if (!r.ok) { box.innerHTML = `<div class="empty-line">${r.error}</div>`; return; }
  if (!r.data.length) { box.innerHTML = '<div class="empty-line">Üres mappa.</div>'; return; }
  box.appendChild(treeNodes(r.data));
}

function treeNodes(nodes) {
  const frag = document.createDocumentFragment();
  for (const n of nodes) {
    const row = document.createElement('div');
    row.className = 'node';
    row.innerHTML = `<span>${n.dir ? '📁' : fileIcon(n.ext)}</span><span class="nm"></span>`;
    row.querySelector('.nm').textContent = n.name;
    frag.appendChild(row);

    if (n.dir) {
      const kids = document.createElement('div');
      kids.className = 'children hidden';
      kids.appendChild(treeNodes(n.children || []));
      frag.appendChild(kids);
      row.addEventListener('click', () => {
        kids.classList.toggle('hidden');
        row.firstElementChild.textContent = kids.classList.contains('hidden') ? '📁' : '📂';
      });
    } else {
      row.addEventListener('click', () => {
        $$('.node.sel').forEach((x) => x.classList.remove('sel'));
        row.classList.add('sel');
        openInEditor(n.abs, n.name);
      });
    }
  }
  return frag;
}

function fileIcon(ext) {
  const m = { '.html': '🌐', '.htm': '🌐', '.css': '🎨', '.js': '📜', '.php': '🐘',
    '.json': '🔧', '.md': '📝', '.sql': '🗄️', '.png': '🖼️', '.jpg': '🖼️', '.svg': '🖼️' };
  return m[ext] || '📄';
}

async function openInEditor(abs, name) {
  const r = await window.api.fs.read(abs);
  if (!r.ok) { toast(r.error, true); return; }
  if (r.data.binary) { toast('Bináris fájl — a beépített szerkesztő nem nyitja meg.', true); return; }

  const ed = await ensureEditor();
  if (!ed) return;
  openFile = abs;
  dirty = false;
  $('#dirtyDot').classList.add('hidden');
  $('#btnSaveFile').disabled = true;
  $('#openFileName').textContent = name;
  $('#editorPlaceholder').classList.add('hidden');

  const model = monaco.editor.createModel(r.data.content, r.data.language);
  const old = editor.getModel();
  editor.setModel(model);
  if (old) old.dispose();
  editor.focus();
}

function ensureEditor() {
  if (editor) return Promise.resolve(editor);
  return new Promise((resolve) => {
    const VS = '/node_modules/monaco-editor/min/vs';
    window.MonacoEnvironment = {
      getWorkerUrl: () => new URL(VS + '/base/worker/workerMain.js', location.origin).toString()
    };
    require.config({ paths: { vs: VS } });
    require(['vs/editor/editor.main'], () => {
      editor = monaco.editor.create(document.getElementById('monaco'), {
        value: '',
        language: 'plaintext',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 13,
        fontFamily: 'Cascadia Code, Consolas, monospace',
        minimap: { enabled: true },
        tabSize: 2,
        scrollBeyondLastLine: false
      });
      editor.onDidChangeModelContent(() => {
        if (!openFile) return;
        dirty = true;
        $('#dirtyDot').classList.remove('hidden');
        $('#btnSaveFile').disabled = false;
      });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveFile);
      resolve(editor);
    }, (err) => {
      console.error('Monaco betöltési hiba:', err);
      $('#editorPlaceholder').innerHTML =
        '<p>A beépített szerkesztő nem tölt be.<br />Fejlesztői módban futtasd újra: <code>npm install</code>.<br />' +
        'Telepített appnál ez csomagolási hiba — szólj, és javítom.</p>';
      $('#editorPlaceholder').classList.remove('hidden');
      resolve(null);
    });
  });
}

async function saveFile() {
  if (!openFile || !editor) return;
  const r = await window.api.fs.write(openFile, editor.getValue());
  if (!r.ok) { toast(r.error, true); return; }
  dirty = false;
  $('#dirtyDot').classList.add('hidden');
  $('#btnSaveFile').disabled = true;
  toast('Mentve: ' + baseName(openFile));
}

/* ---------------------- XAMPP ---------------------- */

async function refreshXampp() {
  const r = await window.api.xampp.status();
  if (!r.ok) return;
  const { apache, mysql } = r.data;
  $('#pillApache').classList.toggle('on', apache);
  $('#pillMysql').classList.toggle('on', mysql);
  const da = $('#dotApache'), dm = $('#dotMysql');
  if (da) { da.className = 'dot ' + (apache ? 'on' : 'off'); }
  if (dm) { dm.className = 'dot ' + (mysql ? 'on' : 'off'); }
}

/* ---------------------- Drive ---------------------- */

async function uploadProject() {
  const p = project();
  if (!p) return;
  if (!STORE.settings.driveFolder) { toast('Előbb add meg a Drive mappát a Beállításokban.', true); openSettings(); return; }
  if (!p.path) { toast('Ehhez a projekthez nincs mappa megadva.', true); return; }

  toast('Másolás a Drive mappába…');
  log(`Feltöltés indul: ${p.path}`);
  const r = await window.api.drive.upload({
    source: p.path,
    driveFolder: STORE.settings.driveFolder,
    subfolder: p.driveSubfolder || p.name || baseName(p.path)
  });
  if (!r.ok) { toast(r.error, true); log('Feltöltés hiba: ' + r.error, 'err'); return; }
  const mb = (r.data.bytes / 1048576).toFixed(2);
  toast(`Kész: ${r.data.files} fájl (${mb} MB) → ${r.data.dest}`);
  log(`Feltöltve ${r.data.files} fájl (${mb} MB) ide: ${r.data.dest}`, 'okl');
  p.lastUpload = new Date().toISOString();
  touch(p); scheduleSave();
}

/* ---------------------- beallitasok ---------------------- */

function openSettings() {
  const s = STORE.settings;
  $('#sVscodium').value = s.vscodiumPath || '';
  $('#sXampp').value = s.xamppPath || '';
  $('#sHtdocs').value = s.htdocsPath || '';
  $('#sDrive').value = s.driveFolder || '';
  window.api.store.path().then((r) => { if (r.ok) $('#storeHint').textContent = 'Adatfájl: ' + r.data; });
  $('#settingsModal').classList.remove('hidden');
}

/* ---------------------- esemenyek ---------------------- */

function bind() {
  // fulek
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.remove('active'));
    $$('.panel').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    $(`.panel[data-panel="${t.dataset.tab}"]`).classList.add('active');
    if (t.dataset.tab === 'editor' && editor) setTimeout(() => editor.layout(), 50);
    if (t.dataset.tab === 'preview') openPreview();
    if (t.dataset.tab === 'tools') refreshXampp();
  }));

  $('#searchInput').addEventListener('input', renderProjectList);

  // uj projekt
  const openNew = () => {
    $('#nName').value = ''; $('#nPath').value = ''; $('#nPreview').value = '';
    $('#newModal').classList.remove('hidden');
    $('#nName').focus();
  };
  $('#btnNewProject').addEventListener('click', openNew);
  $('#btnNewProjectEmpty').addEventListener('click', openNew);
  $('#btnCloseNew').addEventListener('click', () => $('#newModal').classList.add('hidden'));

  $('#btnNPick').addEventListener('click', async () => {
    const r = await window.api.dialog.pickFolder('Projekt mappája');
    if (r.ok && r.data) {
      $('#nPath').value = r.data;
      if (!$('#nName').value) $('#nName').value = baseName(r.data);
      if (!$('#nPreview').value) $('#nPreview').value = 'http://localhost/' + baseName(r.data);
    }
  });

  $('#btnCreateProject').addEventListener('click', () => {
    const name = $('#nName').value.trim();
    const p = {
      id: uid(),
      name: name || baseName($('#nPath').value) || 'Új projekt',
      path: $('#nPath').value.trim(),
      previewUrl: $('#nPreview').value.trim(),
      previewMode: 'auto',
      progress: 0,
      status: 'planning',
      color: ['#7c5cff', '#4dd4ac', '#f5a524', '#4b8dff', '#f0576b'][STORE.projects.length % 5],
      deadline: '',
      description: '',
      driveSubfolder: name || '',
      notes: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    STORE.projects.push(p);
    persist();
    $('#newModal').classList.add('hidden');
    selectProject(p.id);
    toast('Projekt létrehozva.');
  });

  // attekintes mezok
  $('#progressRange').addEventListener('input', (e) => {
    const p = project(); if (!p) return;
    p.progress = +e.target.value;
    setRing(p.progress);
    touch(p); scheduleSave(); renderProjectList();
  });
  $$('[data-setprog]').forEach((b) => b.addEventListener('click', () => {
    const p = project(); if (!p) return;
    p.progress = +b.dataset.setprog;
    $('#progressRange').value = p.progress;
    setRing(p.progress);
    touch(p); scheduleSave(); renderProjectList();
  }));

  const fieldMap = {
    '#fName': 'name', '#fPath': 'path', '#fPreview': 'previewUrl',
    '#fDriveSub': 'driveSubfolder', '#fDesc': 'description',
    '#projStatus': 'status', '#projDeadline': 'deadline',
    '#fPreviewMode': 'previewMode'
  };
  Object.entries(fieldMap).forEach(([sel, key]) => {
    const node = $(sel);
    const evt = (node.tagName === 'SELECT' || node.type === 'date') ? 'change' : 'input';
    node.addEventListener(evt, (e) => {
      const p = project(); if (!p) return;
      p[key] = e.target.value;
      touch(p); scheduleSave();
      if (key === 'name') { $('#projName').textContent = p.name; renderProjectList(); }
      if (key === 'path') { $('#projPath').textContent = p.path; loadTree(); }
      if (key === 'deadline') renderDeadline(p);
      if (key === 'status') renderProjectList();
      if (key === 'previewUrl' && $('#pvMode').value === 'url') $('#pvUrl').value = p.previewUrl;
      if (key === 'previewMode') { $('#pvMode').value = p.previewMode; openPreview(); }
    });
  });

  $('#btnPickPath').addEventListener('click', async () => {
    const r = await window.api.dialog.pickFolder('Projekt mappája');
    if (r.ok && r.data) {
      const p = project();
      p.path = r.data; $('#fPath').value = r.data; $('#projPath').textContent = r.data;
      touch(p); scheduleSave(); loadTree();
    }
  });

  $('#btnDeleteProject').addEventListener('click', () => {
    const p = project(); if (!p) return;
    if (!confirm(`Biztos törlöd a(z) "${p.name}" projektet a listából?\n\n(A gépeden lévő fájlok NEM törlődnek.)`)) return;
    STORE.projects = STORE.projects.filter((x) => x.id !== p.id);
    persist();
    currentId = null;
    renderProjectList();
    if (STORE.projects.length) selectProject(STORE.projects[0].id);
    else { $('#workspace').classList.add('hidden'); $('#emptyState').classList.remove('hidden'); }
  });

  // jegyzetek
  const addNote = () => {
    const p = project(); if (!p) return;
    const text = $('#noteText').value.trim();
    if (!text) return;
    p.notes = p.notes || [];
    p.notes.push({
      id: uid(), text, type: $('#noteType').value, prio: $('#notePrio').value,
      done: false, created: new Date().toISOString()
    });
    $('#noteText').value = '';
    touch(p); scheduleSave(); renderNotes(); renderProjectList();
  };
  $('#btnAddNote').addEventListener('click', addNote);
  $('#noteText').addEventListener('keydown', (e) => { if (e.key === 'Enter') addNote(); });
  $('#showDone').addEventListener('change', renderNotes);

  // szerkeszto
  $('#btnSaveFile').addEventListener('click', saveFile);
  $('#btnRefreshTree').addEventListener('click', loadTree);
  $('#btnNewFile').addEventListener('click', async () => {
    const p = project(); if (!p || !p.path) return;
    const name = prompt('Új fájl neve (almappa is mehet, pl. css/style.css):');
    if (!name) return;
    const r = await window.api.fs.newFile(p.path, name);
    if (!r.ok) { toast(r.error, true); return; }
    await loadTree();
    openInEditor(r.data, baseName(r.data));
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveFile(); }
  });

  // elonezet
  $('#btnPvGo').addEventListener('click', goToTypedUrl);
  $('#pvUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') goToTypedUrl(); });
  $('#btnPvReload').addEventListener('click', () => { try { $('#pvView').reload(); } catch (e) {} });
  $('#pvMode').addEventListener('change', () => {
    const p = project();
    if (p) {
      p.previewMode = $('#pvMode').value;
      $('#fPreviewMode').value = p.previewMode;
      if (p.previewMode === 'url') $('#pvUrl').value = p.previewUrl || '';
      touch(p); scheduleSave();
    }
    openPreview();
  });
  $('#btnPvBack').addEventListener('click', () => { try { if ($('#pvView').canGoBack()) $('#pvView').goBack(); } catch (e) {} });
  $('#btnPvFwd').addEventListener('click', () => { try { if ($('#pvView').canGoForward()) $('#pvView').goForward(); } catch (e) {} });
  $('#btnPvExternal').addEventListener('click', () => window.api.open.external($('#pvUrl').value));

  // eszkozok
  const openCodium = async () => {
    const p = project(); if (!p || !p.path) { toast('Nincs projekt mappa.', true); return; }
    const r = await window.api.open.vscodium(STORE.settings.vscodiumPath, p.path);
    if (!r.ok) { toast(r.error, true); log(r.error, 'err'); } else log('VSCodium megnyitva: ' + p.path, 'okl');
  };
  $('#btnOpenCodium').addEventListener('click', openCodium);
  $('#btnOpenCodium2').addEventListener('click', openCodium);

  $('#btnOpenFolder').addEventListener('click', () => {
    const p = project(); if (p && p.path) window.api.open.explorer(p.path);
  });
  $('#btnOpenTerm').addEventListener('click', () => {
    const p = project(); if (p && p.path) window.api.open.terminal(p.path);
  });
  $('#btnOpenHtdocs').addEventListener('click', () => window.api.open.explorer(STORE.settings.htdocsPath));
  $('#btnOpenDrive').addEventListener('click', () => {
    if (!STORE.settings.driveFolder) { toast('Nincs Drive mappa beállítva.', true); return; }
    window.api.drive.openFolder(STORE.settings.driveFolder);
  });
  $('#btnPhpMyAdmin').addEventListener('click', () => {
    $('#pvUrl').value = 'http://localhost/phpmyadmin';
    $$('.tab').forEach((x) => x.classList.remove('active'));
    $$('.panel').forEach((x) => x.classList.remove('active'));
    $('.tab[data-tab="preview"]').classList.add('active');
    $('.panel[data-panel="preview"]').classList.add('active');
    openPreview();
  });

  $$('[data-xampp]').forEach((b) => b.addEventListener('click', async () => {
    const [service, action] = b.dataset.xampp.split(':');
    const r = await window.api.xampp.control(STORE.settings.xamppPath, service, action);
    if (!r.ok) { toast(r.error, true); log(r.error, 'err'); return; }
    log(`${service} ${action === 'start' ? 'indítás' : 'leállítás'} elküldve`, 'okl');
    setTimeout(refreshXampp, 1500);
    setTimeout(refreshXampp, 4000);
  }));
  $('#btnXamppPanel').addEventListener('click', async () => {
    const r = await window.api.xampp.panel(STORE.settings.xamppPath);
    if (!r.ok) toast(r.error, true);
  });

  // drive
  $('#btnUploadDrive').addEventListener('click', uploadProject);
  $('#btnUploadFiles').addEventListener('click', async () => {
    const p = project(); if (!p) return;
    if (!STORE.settings.driveFolder) { toast('Nincs Drive mappa beállítva.', true); return; }
    const pick = await window.api.dialog.pickFile({ title: 'Feltöltendő fájlok', multi: true });
    if (!pick.ok || !pick.data || !pick.data.length) return;
    const r = await window.api.drive.upload({
      driveFolder: STORE.settings.driveFolder,
      subfolder: p.driveSubfolder || p.name,
      files: pick.data
    });
    if (!r.ok) { toast(r.error, true); return; }
    toast(`${r.data.files} fájl feltöltve.`);
    log(`${r.data.files} fájl → ${r.data.dest}`, 'okl');
  });

  // beallitasok
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnCloseSettings').addEventListener('click', () => $('#settingsModal').classList.add('hidden'));
  $('#btnSaveSettings').addEventListener('click', () => {
    STORE.settings.vscodiumPath = $('#sVscodium').value.trim();
    STORE.settings.xamppPath = $('#sXampp').value.trim();
    STORE.settings.htdocsPath = $('#sHtdocs').value.trim();
    STORE.settings.driveFolder = $('#sDrive').value.trim();
    persist();
    $('#settingsModal').classList.add('hidden');
    toast('Beállítások mentve.');
  });
  $('#btnAutodetect').addEventListener('click', async () => {
    const r = await window.api.detect.all();
    if (!r.ok) return;
    if (r.data.vscodiumPath) $('#sVscodium').value = r.data.vscodiumPath;
    if (r.data.xamppPath) {
      $('#sXampp').value = r.data.xamppPath;
      if (!$('#sHtdocs').value) $('#sHtdocs').value = r.data.xamppPath + window.api.sep + 'htdocs';
    }
    if (r.data.driveFolder) $('#sDrive').value = r.data.driveFolder;
    toast('Felismerés kész — nézd át az értékeket.');
  });
  $('#btnExport').addEventListener('click', async () => {
    await persist();
    const r = await window.api.store.export();
    if (!r.ok) { toast(r.error, true); return; }
    if (r.data) toast('Elmentve: ' + r.data);
  });
  $('#btnImport').addEventListener('click', async () => {
    if (!confirm('A betöltés felülírja a jelenlegi projekteket és jegyzeteket. Folytatod?')) return;
    const r = await window.api.store.import();
    if (!r.ok) { toast(r.error, true); return; }
    if (!r.data) return;
    STORE = r.data;
    currentId = null;
    renderProjectList();
    if (STORE.projects.length) selectProject(STORE.projects[0].id);
    $('#settingsModal').classList.add('hidden');
    toast('Betöltve.');
  });

  $$('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
    const kind = b.dataset.pick;
    if (kind === 'vscodium') {
      const r = await window.api.dialog.pickFile({
        title: 'VSCodium futtatható fájl',
        filters: window.api.platform === 'win32' ? [{ name: 'Program', extensions: ['exe'] }] : []
      });
      if (r.ok && r.data) $('#sVscodium').value = r.data;
    } else {
      const r = await window.api.dialog.pickFolder('Mappa kiválasztása');
      if (!r.ok || !r.data) return;
      if (kind === 'xampp') $('#sXampp').value = r.data;
      if (kind === 'htdocs') $('#sHtdocs').value = r.data;
      if (kind === 'drive') $('#sDrive').value = r.data;
    }
  }));

  // modal hatterre kattintas
  $$('.modal').forEach((m) => m.addEventListener('click', (e) => {
    if (e.target === m) m.classList.add('hidden');
  }));
}

function navigate(url) {
  const wv = $('#pvView');
  try {
    if (wv.getURL && wv.getURL() === url) wv.reload();
    else wv.src = url;
  } catch (e) { wv.src = url; }
}

function withScheme(u) {
  return /^https?:\/\//i.test(u) ? u : 'http://' + u;
}

function goToTypedUrl() {
  const raw = ($('#pvUrl').value || '').trim();
  if (!raw) return;
  const url = withScheme(raw);
  $('#pvUrl').value = url;
  navigate(url);
}

async function openPreview() {
  const p = project();
  const info = $('#pvInfo');
  const mode = $('#pvMode').value || 'auto';

  if (mode === 'url') {
    const raw = ($('#pvUrl').value || (p && p.previewUrl) || '').trim();
    if (!raw) {
      info.textContent = 'Írj be egy címet — pl. http://localhost/projektnev — és nyomd meg a Megnyit gombot.';
      return;
    }
    const url = withScheme(raw);
    $('#pvUrl').value = url;
    info.textContent = 'Saját URL — ehhez futnia kell a szervernek (XAMPP esetén az Apache-nak).';
    navigate(url);
    return;
  }

  if (!p || !p.path) {
    info.textContent = 'Ehhez a projekthez nincs mappa megadva — az Áttekintés fülön add meg.';
    return;
  }

  let useServer = true;
  let insp = null;
  if (mode === 'auto') {
    const r = await window.api.preview.inspect(p.path);
    if (r.ok) {
      insp = r.data;
      if (!insp.exists) {
        info.textContent = 'A projekt mappája nem található: ' + p.path;
        return;
      }
      if (insp.hasPhp) useServer = false;
    }
  }

  if (!useServer) {
    const raw = (p.previewUrl || '').trim();
    if (!raw) {
      info.textContent = 'PHP-fájlokat találtam, ezekhez XAMPP kell. Add meg az Áttekintés fülön az előnézet URL-t (pl. http://localhost/' + baseName(p.path) + ').';
      return;
    }
    const url = withScheme(raw);
    $('#pvUrl').value = url;
    info.textContent = 'PHP-t találtam a projektben → XAMPP-on keresztül nyitom meg. Fusson az Apache!';
    navigate(url);
    return;
  }

  const r = await window.api.preview.serve(p.path);
  if (!r.ok) { info.textContent = r.error; return; }
  $('#pvUrl').value = r.data.url;
  info.textContent = insp && !insp.hasIndex
    ? 'Beépített szerver fut, de nincs index.html a mappa gyökerében — írd a címsorba a fájl nevét.'
    : 'Beépített szerver — nem kell XAMPP. A mappádat szolgálja ki: ' + p.path;
  navigate(r.data.url);
}

/* ---------------------- indulas ---------------------- */

(async function init() {
  bind();

  const r = await window.api.store.load();
  if (r.ok) STORE = r.data;

  // elso indulas: probaljuk kitalalni a beallitasokat
  if (!STORE.settings.vscodiumPath && !STORE.settings.driveFolder) {
    const d = await window.api.detect.all();
    if (d.ok) {
      STORE.settings.vscodiumPath = STORE.settings.vscodiumPath || d.data.vscodiumPath || '';
      STORE.settings.xamppPath = STORE.settings.xamppPath || d.data.xamppPath || '';
      STORE.settings.driveFolder = STORE.settings.driveFolder || d.data.driveFolder || '';
      if (STORE.settings.xamppPath && !STORE.settings.htdocsPath) {
        STORE.settings.htdocsPath = STORE.settings.xamppPath + window.api.sep + 'htdocs';
      }
      persist();
    }
  }

  renderProjectList();
  if (STORE.projects.length) selectProject(STORE.projects[0].id);

  refreshXampp();
  setInterval(refreshXampp, 8000);
})();
