'use strict';
/* =========================================================================
   Projekt Hub — renderer

   Ket dolog, amit erdemes tudni, mielott hozzanyulsz:

   1) MEZO-IDOBELYEGEK
      Minden megoszthato mezo mellett tartunk egy idobelyeget (mezoTs) es azt,
      ki allitotta (mezoKi). Szinkronnal mezonkent az ujabb nyer — igy ha ti
      ketten mast allitotok, nem az egyik ember munkaja tunik el, hanem
      mindketto megmarad a maga mezojeben.

   2) A TORLES IS MODOSITAS
      Megosztott projektben a jegyzet nem tunik el, hanem `torolve: true`
      lesz. Kulonben a masik gep visszahozna a sajat regi masolatabol.
   ========================================================================= */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let STORE = { settings: {}, projects: [] };
let currentId = null;
let editor = null;
let openFile = null;
let dirty = false;
let saveTimer = null;
let syncTimer = null;
let gitOk = false;
let gitUzenet = '';
let szinkronFut = false;

const STATUS_LABEL = {
  planning: 'Tervezés', in_progress: 'Folyamatban', review: 'Átnézés',
  done: 'Kész', paused: 'Szünetel'
};
const TYPE_LABEL = { todo: 'Teendő', idea: 'Ötlet', bug: 'Hiba', missing: 'Kimaradt' };
const PRIO_LABEL = { high: 'Fontos', normal: 'Normál', low: 'Ráér' };
const SZINEK = ['#e3b04b', '#5fbf8f', '#6f8cff', '#c98bd8', '#e8833a'];

/* A megoszthato mezok: kozos nev -> helyi mezo */
const MEZOK = {
  nev: 'name', leiras: 'description', allapot: 'status',
  haladas: 'progress', hatarido: 'deadline', szin: 'color'
};

/* ====================== segedek ====================== */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const most = () => new Date().toISOString();

function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('bad', !!bad);
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 3600);
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

const baseName = (p) => (!p ? '' : (p.split(/[\\/]/).filter(Boolean).pop() || p));
const project = () => STORE.projects.find((p) => p.id === currentId) || null;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 350);
}
async function persist() {
  const r = await window.api.store.save(STORE);
  if (!r.ok) toast('Mentési hiba: ' + r.error, true);
}
function touch(p) { p.updatedAt = most(); }

/** Emberi idokulonbseg. */
function mikor(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const mp = (Date.now() - d.getTime()) / 1000;
  if (mp < 45) return 'most';
  if (mp < 3600) return Math.round(mp / 60) + ' perce';
  if (mp < 86400) return Math.round(mp / 3600) + ' órája';
  if (mp < 172800) return 'tegnap';
  if (mp < 604800) return Math.round(mp / 86400) + ' napja';
  return d.toLocaleDateString('hu-HU');
}

/** Nevbol stabil szin + kezdobetu. */
function avatarStilus(kulcs, nev) {
  const paletta = [
    ['#3c4a6b', '#c3d3f2'], ['#5a4630', '#e8c99a'], ['#33553f', '#a8ddbd'],
    ['#553348', '#e2b6d4'], ['#3f4a52', '#c8d3da'], ['#5a3535', '#efb4b4']
  ];
  let h = 0;
  const s = String(kulcs || nev || '?');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const [bg, fg] = paletta[h % paletta.length];
  return { bg, fg, betu: (String(nev || '?').trim()[0] || '?').toUpperCase() };
}

function avatarEl(cls, kulcs, nev) {
  const a = avatarStilus(kulcs, nev);
  const el = document.createElement('span');
  el.className = cls;
  el.style.background = a.bg;
  el.style.color = a.fg;
  el.textContent = a.betu;
  el.title = nev || '';
  return el;
}

/* ====================== en ====================== */

function en() {
  const s = STORE.settings;
  return { kulcs: s.enKulcs, nev: s.enNev || 'Én', github: s.enGithub || '', email: s.enEmail || '' };
}

/* ====================== mezo-modositas ====================== */

/** Beallit egy megoszthato mezot, es feljegyzi, mikor es ki. */
function mezotAllit(p, kozosNev, ertek, naploSzoveg) {
  const helyiNev = MEZOK[kozosNev];
  if (!helyiNev) return;
  if (p[helyiNev] === ertek) return;
  p[helyiNev] = ertek;
  p.mezoTs = p.mezoTs || {};
  p.mezoKi = p.mezoKi || {};
  p.mezoTs[kozosNev] = most();
  p.mezoKi[kozosNev] = en().kulcs;
  touch(p);
  if (naploSzoveg) naplozz(p, naploSzoveg);
  scheduleSave();
  szinkronKesobb(p);
}

/** Naplobejegyzes — csak megosztott projektnel van ertelme. */
function naplozz(p, szoveg) {
  if (!p.megosztas || !p.megosztas.be) return;
  p.fuggoNaplo = p.fuggoNaplo || [];
  p.fuggoNaplo.push({ id: uid(), ts: most(), ki: en().kulcs, kiNev: en().nev, szoveg });
  if (p.fuggoNaplo.length > 60) p.fuggoNaplo = p.fuggoNaplo.slice(-60);
}

/* ====================== projektlista ====================== */

const IKON_LANC = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
  + ' stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><path d="M8 12h8"/></svg>';

function eloJegyzetek(p) {
  return (p.notes || []).filter((n) => !n.torolve);
}

function renderProjectList() {
  const q = ($('#searchInput').value || '').toLowerCase().trim();
  const list = $('#projectList');
  list.innerHTML = '';
  $('#projCount').textContent = STORE.projects.length;

  const items = STORE.projects.filter((p) =>
    !q || (p.name || '').toLowerCase().includes(q) || (p.path || '').toLowerCase().includes(q));

  if (!items.length) {
    list.innerHTML = '<div class="eline" style="padding:8px 10px">Nincs találat.</div>';
    return;
  }

  for (const p of items) {
    const nyitott = eloJegyzetek(p).filter((n) => !n.done).length;
    const szin = p.color || SZINEK[0];
    const kozos = p.megosztas && p.megosztas.be;

    const el = document.createElement('div');
    el.className = 'p' + (p.id === currentId ? ' on' : '');

    const r1 = document.createElement('div');
    r1.className = 'p-r1';
    r1.innerHTML = `<span class="sd" style="background:${szin}"></span>`
      + `<span class="p-nm"></span><span class="p-pct">${p.progress || 0}%</span>`;
    r1.querySelector('.p-nm').textContent = p.name || '(névtelen)';

    const bar = document.createElement('div');
    bar.className = 'p-bar';
    bar.innerHTML = `<i style="width:${p.progress || 0}%;background:${szin}"></i>`;

    const meta = document.createElement('div');
    meta.className = 'p-m';
    let mh = `<span>${STATUS_LABEL[p.status] || ''}</span>`;
    if (nyitott) mh += `<span class="pin"></span><span>${nyitott} teendő</span>`;
    if (kozos) mh += `<span class="pin"></span><span class="shr">${IKON_LANC} közös</span>`;
    meta.innerHTML = mh;

    el.append(r1, bar, meta);
    el.addEventListener('click', () => selectProject(p.id));
    list.appendChild(el);
  }
}

/* ====================== projekt betoltes ====================== */

function selectProject(id) {
  currentId = id;
  const p = project();
  if (!p) return;

  $('#emptyState').classList.add('hidden');
  $('#workspace').classList.remove('hidden');

  $('#projName').textContent = p.name || '(névtelen)';
  $('#projPath').textContent = p.path || 'nincs mappa megadva';

  urlapotTolt(p);
  setRing(p.progress || 0);
  renderStrip(p);
  renderNotes();
  renderShare();
  renderProjectList();

  $('#pvMode').value = p.previewMode || 'auto';
  $('#pvUrl').value = p.previewUrl || '';
  $('#pvInfo').textContent = '';

  openFile = null;
  dirty = false;
  $('#openFileName').textContent = 'Válassz egy fájlt balról';
  $('#btnSaveFile').disabled = true;
  $('#dirtyDot').classList.add('hidden');
  $('#editorPlaceholder').classList.remove('hidden');
  if (editor) editor.setValue('');
  loadTree();

  if (p.megosztas && p.megosztas.be) szinkron(p, { csendes: true });
}

/** Urlapmezok feltoltese — a fokuszban levot nem bantjuk (gepel benne). */
function urlapotTolt(p) {
  const parok = [
    ['#fName', p.name || ''], ['#fPath', p.path || ''],
    ['#fPreview', p.previewUrl || ''], ['#fDriveSub', p.driveSubfolder || ''],
    ['#fDesc', p.description || ''], ['#projStatus', p.status || 'in_progress'],
    ['#projDeadline', p.deadline || ''], ['#fPreviewMode', p.previewMode || 'auto'],
    ['#progressRange', String(p.progress || 0)]
  ];
  for (const [sel, ertek] of parok) {
    const el = $(sel);
    if (!el || el === document.activeElement) continue;
    if (el.value !== ertek) el.value = ertek;
  }
}

function setRing(v) {
  const C = 2 * Math.PI * 24;
  const fg = $('#ringFg');
  fg.style.strokeDasharray = C;
  fg.style.strokeDashoffset = C * (1 - v / 100);
  fg.style.stroke = v >= 100 ? 'var(--ok)' : 'var(--acc)';
  $('#ringLabel').textContent = v + '%';
}

function renderStrip(p) {
  $('#stStatus').textContent = STATUS_LABEL[p.status] || '—';
  $('#stStatus').className = 'val' + (p.status === 'done' ? ' ok' : '');
  const ki = p.mezoKi && p.mezoKi.allapot;
  const kiNev = tagNeve(p, ki);
  $('#stStatusSub').textContent = p.mezoTs && p.mezoTs.allapot
    ? (kiNev && ki !== en().kulcs ? `${kiNev} · ${mikor(p.mezoTs.allapot)}` : mikor(p.mezoTs.allapot))
    : '';

  const dl = $('#stDeadline'), dls = $('#stDeadlineSub');
  if (!p.deadline) {
    dl.textContent = 'nincs'; dl.className = 'val dim'; dls.textContent = '';
  } else {
    const d = new Date(p.deadline + 'T23:59:59');
    const nap = Math.ceil((d - new Date()) / 86400000);
    if (nap < 0) { dl.textContent = `${Math.abs(nap)} napja lejárt`; dl.className = 'val bad'; }
    else if (nap === 0) { dl.textContent = 'Ma'; dl.className = 'val warn'; }
    else { dl.textContent = `Még ${nap} nap`; dl.className = 'val' + (nap <= 3 ? ' warn' : ''); }
    dls.textContent = d.toLocaleDateString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  const elo = eloJegyzetek(p);
  const nyitott = elo.filter((n) => !n.done);
  const fontos = nyitott.filter((n) => n.prio === 'high').length;
  $('#stTodos').textContent = nyitott.length;
  $('#stTodosSub').textContent = fontos ? `${fontos} fontos` : (elo.length ? 'nincs sürgős' : '');
}

function tagNeve(p, kulcs) {
  if (!kulcs) return '';
  if (kulcs === en().kulcs) return en().nev;
  const t = ((p.megosztas && p.megosztas.tagok) || []).find((x) => x.kulcs === kulcs);
  return t ? t.nev : '';
}

/* ====================== jegyzetek ====================== */

function renderNotes() {
  const p = project();
  if (!p) return;
  const kozos = !!(p.megosztas && p.megosztas.be);

  const mind = eloJegyzetek(p).slice().sort((a, b) => {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    const rang = { high: 0, normal: 1, low: 2 };
    const r = (rang[a.prio] ?? 1) - (rang[b.prio] ?? 1);
    if (r) return r;
    return String(b.created || '').localeCompare(String(a.created || ''));
  });

  const nyitott = mind.filter((n) => !n.done);
  const badge = $('#notesBadge');
  badge.textContent = nyitott.length;
  badge.classList.toggle('zero', nyitott.length === 0);

  // ki szerinti szuro (csak kozos projektnel)
  const who = $('#noteWho');
  who.classList.toggle('hidden', !kozos);
  if (kozos) {
    const jelenlegi = who.value;
    const kulcsok = Array.from(new Set(mind.map((n) => n.szerzo).filter(Boolean)));
    who.innerHTML = '<option value="">Mindenki</option>'
      + kulcsok.map((k) => `<option value="${k}">${tagNeve(p, k) || 'ismeretlen'}</option>`).join('');
    who.value = kulcsok.includes(jelenlegi) ? jelenlegi : '';
  }

  const szuro = kozos && who.value ? who.value : '';
  const keszIs = $('#showDone').checked;
  let lathato = keszIs ? mind : nyitott;
  if (szuro) lathato = lathato.filter((n) => n.szerzo === szuro);

  $('#noteCount').textContent = `${nyitott.length} nyitott`
    + (mind.length - nyitott.length ? ` · ${mind.length - nyitott.length} kész` : '');

  const lista = $('#noteList');
  lista.innerHTML = '';
  if (!lathato.length) {
    lista.innerHTML = '<div class="eline">Nincs jegyzet. Ha eszedbe jut egy kimaradt funkció, írd ide fel.</div>';
  } else {
    lathato.forEach((n) => lista.appendChild(noteEl(n, kozos, true)));
  }

  const mini = $('#overviewNotes');
  mini.innerHTML = '';
  const top = nyitott.slice(0, 5);
  $('#ovCount').textContent = nyitott.length || '';
  if (!top.length) mini.innerHTML = '<div class="eline">Nincs nyitott teendő.</div>';
  else top.forEach((n) => mini.appendChild(noteEl(n, kozos, false)));
}

function noteEl(n, kozos, teljes) {
  const p = project();
  const el = document.createElement('div');
  el.className = 'todo' + (n.done ? ' done' : '');

  const cb = document.createElement('button');
  cb.className = 'cbx' + (n.done ? ' d' : '');
  cb.title = n.done ? 'Visszanyit' : 'Kész';
  cb.addEventListener('click', () => {
    n.done = !n.done;
    n.doneAt = n.done ? most() : null;
    jegyzetModositva(p, n);
    naplozz(p, (n.done ? 'lezárta: ' : 'újranyitotta: ') + '„' + n.text + '”');
    scheduleSave(); renderNotes(); renderStrip(p); renderProjectList(); szinkronKesobb(p);
  });

  const body = document.createElement('div');
  body.className = 'tb-b';
  const txt = document.createElement('div');
  txt.className = 'tt';
  txt.textContent = n.text;

  const meta = document.createElement('div');
  meta.className = 'tm';

  if (teljes || n.prio === 'high') {
    const pr = document.createElement('span');
    pr.className = 'pr' + (n.prio === 'high' ? ' hi' : (n.prio === 'low' ? ' lo' : ''));
    pr.textContent = PRIO_LABEL[n.prio] || 'Normál';
    meta.appendChild(pr);
  }
  if (teljes) {
    meta.appendChild(pin());
    const ty = document.createElement('span');
    ty.textContent = TYPE_LABEL[n.type] || n.type || '';
    meta.appendChild(ty);
  }
  if (kozos && n.szerzoNev) {
    meta.appendChild(pin());
    meta.appendChild(avatarEl('av', n.szerzo, n.szerzoNev));
    const nv = document.createElement('span');
    nv.textContent = n.done && n.modosito && n.modosito !== n.szerzo
      ? `${tagNeve(p, n.modosito) || '?'} zárta le`
      : n.szerzoNev;
    meta.appendChild(nv);
  }
  meta.appendChild(pin());
  const t = document.createElement('span');
  t.textContent = mikor(n.done ? (n.doneAt || n.created) : n.created);
  meta.appendChild(t);

  body.append(txt, meta);

  const del = document.createElement('button');
  del.className = 'ndel';
  del.textContent = '✕';
  del.title = 'Törlés';
  del.addEventListener('click', () => {
    if (p.megosztas && p.megosztas.be) {
      // Megosztottnal nem torlunk, hanem megjeloljuk — kulonben visszajonne.
      n.torolve = true;
      jegyzetModositva(p, n);
      naplozz(p, 'törölt egy jegyzetet: „' + n.text + '”');
    } else {
      p.notes = p.notes.filter((x) => x.id !== n.id);
    }
    scheduleSave(); renderNotes(); renderStrip(p); renderProjectList(); szinkronKesobb(p);
  });

  el.append(cb, body, del);
  return el;
}

function pin() {
  const s = document.createElement('span');
  s.className = 'pin';
  return s;
}

function jegyzetModositva(p, n) {
  n.modositva = most();
  n.modosito = en().kulcs;
  touch(p);
}

/* ====================== MEGOSZTAS ====================== */

function webUrl(u) {
  return String(u || '').trim().replace(/\.git$/i, '');
}

function renderShare() {
  const p = project();
  if (!p) return;
  const m = p.megosztas || { be: false };
  const be = !!m.be;

  $('#shareOff').classList.toggle('hidden', be);
  $('#shareOn').classList.toggle('hidden', !be);
  $('#shareDot').classList.toggle('hidden', !be);

  const gw = $('#gitWarn');
  if (!gitOk && gitUzenet) {
    gw.textContent = gitUzenet;
    gw.classList.remove('hidden');
  } else {
    gw.classList.add('hidden');
  }

  if (!be) {
    if (!$('#shareUrl').value && m.repo) $('#shareUrl').value = m.repo;
    return;
  }

  $('#shareRepo').textContent = webUrl(m.repo).replace(/^https?:\/\//, '');

  const st = $('#syncState');
  const span = st.querySelector('span');
  st.className = 'syncst' + (szinkronFut ? ' busy' : (m.hiba ? ' bad' : ''));
  span.textContent = szinkronFut ? 'Szinkronizál…'
    : (m.hiba ? 'Nem sikerült' : (m.utolso ? 'Szinkronizálva ' + mikor(m.utolso) : 'még nem futott'));

  const eb = $('#syncErr');
  if (m.hiba) { eb.textContent = m.hiba; eb.classList.remove('hidden'); }
  else eb.classList.add('hidden');

  // tagok
  const ml = $('#memberList');
  ml.innerHTML = '';
  const tagok = m.tagok || [];
  $('#memCount').textContent = tagok.length || '';
  if (!tagok.length) {
    ml.innerHTML = '<div class="eline">Még nincs adat — futtass egy szinkront.</div>';
  } else {
    for (const t of tagok) {
      const row = document.createElement('div');
      row.className = 'mem';
      row.appendChild(avatarEl('av2', t.kulcs, t.nev));
      const b = document.createElement('div');
      b.className = 'mem-b';
      const n1 = document.createElement('div');
      n1.className = 'mem-n';
      n1.textContent = t.nev || 'ismeretlen';
      const n2 = document.createElement('div');
      n2.className = 'mem-s';
      n2.textContent = (t.github ? t.github + ' · ' : '') + (t.kulcs === en().kulcs ? 'most aktív' : mikor(t.utoljara));
      b.append(n1, n2);
      row.appendChild(b);
      if (t.kulcs === en().kulcs) {
        const y = document.createElement('span');
        y.className = 'you';
        y.textContent = 'te';
        row.appendChild(y);
      }
      ml.appendChild(row);
    }
  }

  // naplo
  const feed = $('#feed');
  feed.innerHTML = '';
  const naplo = (m.naplo || []).slice(0, 12);
  if (!naplo.length) {
    feed.innerHTML = '<div class="eline">Még nem történt semmi.</div>';
  } else {
    for (const n of naplo) {
      const fi = document.createElement('div');
      fi.className = 'fi';
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = mikor(n.ts);
      const s = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = n.kiNev || 'valaki';
      s.append(b, document.createTextNode(' ' + (n.szoveg || '')));
      fi.append(t, s);
      feed.appendChild(fi);
    }
  }
}

/** Helyi allapot -> a szinkronmodul formatuma. */
function csomagol(p) {
  const mezok = {};
  for (const [kozos, helyi] of Object.entries(MEZOK)) {
    mezok[kozos] = {
      e: p[helyi] === undefined ? '' : p[helyi],
      ts: (p.mezoTs && p.mezoTs[kozos]) || p.createdAt || most(),
      ki: (p.mezoKi && p.mezoKi[kozos]) || en().kulcs
    };
  }
  return {
    projekt: { mezok },
    jegyzetek: (p.notes || []).map((n) => ({
      id: n.id, szoveg: n.text, tipus: n.type, prio: n.prio,
      kesz: !!n.done, keszAt: n.doneAt || null, letrehozva: n.created,
      szerzo: n.szerzo || en().kulcs, szerzoNev: n.szerzoNev || en().nev,
      modositva: n.modositva || n.created, modosito: n.modosito || n.szerzo || en().kulcs,
      torolve: !!n.torolve
    })),
    tagok: (p.megosztas && p.megosztas.tagok) || [],
    naplo: ((p.megosztas && p.megosztas.naplo) || []).concat(p.fuggoNaplo || [])
  };
}

/**
 * A szinkron eredmenyet visszaolvasztjuk a helyi allapotba.
 * Ujra ellenorizzuk az idobelyegeket, mert kozben a felhasznalo is irhatott.
 */
function kicsomagol(p, adat) {
  for (const [kozos, helyi] of Object.entries(MEZOK)) {
    const t = adat.projekt.mezok[kozos];
    if (!t) continue;
    const helyiTs = (p.mezoTs && p.mezoTs[kozos]) || '';
    if (String(t.ts || '') >= String(helyiTs)) {
      p[helyi] = t.e;
      p.mezoTs = p.mezoTs || {}; p.mezoKi = p.mezoKi || {};
      p.mezoTs[kozos] = t.ts;
      p.mezoKi[kozos] = t.ki;
    }
  }

  const helyiek = new Map((p.notes || []).map((n) => [n.id, n]));
  const ujak = [];
  for (const j of adat.jegyzetek || []) {
    const van = helyiek.get(j.id);
    const tavoliUjabb = !van || String(j.modositva || '') >= String(van.modositva || '');
    if (van && !tavoliUjabb) { ujak.push(van); helyiek.delete(j.id); continue; }
    ujak.push({
      id: j.id, text: j.szoveg, type: j.tipus, prio: j.prio,
      done: !!j.kesz, doneAt: j.keszAt || null, created: j.letrehozva,
      szerzo: j.szerzo, szerzoNev: j.szerzoNev,
      modositva: j.modositva, modosito: j.modosito, torolve: !!j.torolve
    });
    helyiek.delete(j.id);
  }
  // ami csak nalunk van (meg nem ment fel), az maradjon
  for (const maradek of helyiek.values()) ujak.push(maradek);
  p.notes = ujak;

  p.megosztas = p.megosztas || {};
  p.megosztas.tagok = adat.tagok || [];
  p.megosztas.naplo = adat.naplo || [];
  p.fuggoNaplo = [];
}

/** Kesleltetett szinkron — nem minden gombnyomasra megyunk a halozatra. */
function szinkronKesobb(p) {
  if (!p || !p.megosztas || !p.megosztas.be) return;
  clearTimeout(szinkronKesobb._t);
  szinkronKesobb._t = setTimeout(() => {
    const akt = project();
    if (akt && akt.megosztas && akt.megosztas.be) szinkron(akt, { csendes: true });
  }, 9000);
}

async function szinkron(p, opts = {}) {
  if (!p || !p.megosztas || !p.megosztas.be || szinkronFut) return;
  if (!gitOk) {
    if (!opts.csendes) toast(gitUzenet || 'Nincs git a gépen.', true);
    return;
  }
  szinkronFut = true;
  if (project() === p) renderShare();

  const r = await window.api.megosztas.szinkron({
    projektId: p.id, repoUrl: p.megosztas.repo, helyi: csomagol(p), en: en()
  });

  szinkronFut = false;

  if (!r.ok) {
    p.megosztas.hiba = r.error;
    scheduleSave();
    if (project() === p) renderShare();
    if (!opts.csendes) toast('Szinkron hiba', true);
    log('Szinkron hiba: ' + r.error, 'err');
    return;
  }

  p.megosztas.hiba = '';
  p.megosztas.utolso = r.data.ideje;
  kicsomagol(p, r.data.adat);
  touch(p);
  await persist();

  if (project() === p) {
    urlapotTolt(p);
    setRing(p.progress || 0);
    renderStrip(p);
    renderNotes();
    renderShare();
    $('#projName').textContent = p.name || '(névtelen)';
  }
  renderProjectList();

  if (r.data.figyelmeztetes) toast(r.data.figyelmeztetes, true);
  else if (!opts.csendes) toast('Szinkronizálva.');
  log('Szinkron kész: ' + (r.data.repo || ''), 'okl');
}

async function megosztastBekapcsol() {
  const p = project();
  if (!p) return;
  const url = $('#shareUrl').value.trim();
  const eb = $('#shareErr');
  eb.classList.add('hidden');

  if (!url) { eb.textContent = 'Illeszd be a repó linkjét.'; eb.classList.remove('hidden'); return; }
  if (!gitOk) { eb.textContent = gitUzenet; eb.classList.remove('hidden'); return; }

  // A meglevo jegyzeteket "sajatunkka" tesszuk, hogy legyen szerzojuk.
  const enK = en();
  for (const n of p.notes || []) {
    n.szerzo = n.szerzo || enK.kulcs;
    n.szerzoNev = n.szerzoNev || enK.nev;
    n.modositva = n.modositva || n.created || most();
    n.modosito = n.modosito || enK.kulcs;
    n.torolve = !!n.torolve;
  }
  p.mezoTs = p.mezoTs || {};
  p.mezoKi = p.mezoKi || {};
  for (const kozos of Object.keys(MEZOK)) {
    if (!p.mezoTs[kozos]) { p.mezoTs[kozos] = p.updatedAt || most(); p.mezoKi[kozos] = enK.kulcs; }
  }

  p.megosztas = { be: true, repo: url, utolso: '', tagok: [], naplo: [], hiba: '' };
  p.fuggoNaplo = [{ id: uid(), ts: most(), ki: enK.kulcs, kiNev: enK.nev, szoveg: 'megosztotta a projektet' }];
  await persist();
  renderShare();
  renderProjectList();

  await szinkron(p);
  if (p.megosztas.hiba) {
    // nem sikerult -> ne maradjon felig bekapcsolva
    eb.textContent = p.megosztas.hiba;
    eb.classList.remove('hidden');
    p.megosztas.be = false;
    await persist();
    renderShare();
    renderProjectList();
  } else {
    toast('Megosztás bekapcsolva.');
  }
}

async function csatlakozas() {
  const url = $('#joinUrl').value.trim();
  const mappa = $('#joinPath').value.trim();
  const eb = $('#joinErr');
  eb.classList.add('hidden');

  if (!url) { eb.textContent = 'Illeszd be a repó linkjét.'; eb.classList.remove('hidden'); return; }
  if (!gitOk) { eb.textContent = gitUzenet; eb.classList.remove('hidden'); return; }

  const letezo = STORE.projects.find((x) => x.megosztas && x.megosztas.be
    && webUrl(x.megosztas.repo).toLowerCase() === webUrl(url).toLowerCase());
  if (letezo) {
    $('#joinModal').classList.add('hidden');
    selectProject(letezo.id);
    toast('Ez a projekt már megvan nálad.');
    return;
  }

  const ideiglenesId = uid();
  $('#btnJoinGo').disabled = true;
  const r = await window.api.megosztas.beolvas({ projektId: ideiglenesId, repoUrl: url, en: en() });
  $('#btnJoinGo').disabled = false;

  if (!r.ok) { eb.textContent = r.error; eb.classList.remove('hidden'); return; }
  if (r.data.ures) {
    eb.textContent = 'Ez a repó még üres — a haverod még nem kapcsolta be nála a megosztást.';
    eb.classList.remove('hidden');
    return;
  }

  const mezok = r.data.adat.projekt.mezok || {};
  const ert = (k, alap) => (mezok[k] && mezok[k].e !== undefined ? mezok[k].e : alap);

  const p = {
    id: ideiglenesId,
    name: ert('nev', 'Közös projekt'),
    path: mappa,
    previewUrl: mappa ? 'http://localhost/' + baseName(mappa) : '',
    previewMode: 'auto',
    progress: Number(ert('haladas', 0)) || 0,
    status: ert('allapot', 'in_progress'),
    color: ert('szin', SZINEK[STORE.projects.length % SZINEK.length]),
    deadline: ert('hatarido', ''),
    description: ert('leiras', ''),
    driveSubfolder: '',
    notes: [],
    mezoTs: {}, mezoKi: {},
    megosztas: { be: true, repo: url, utolso: '', tagok: [], naplo: [], hiba: '' },
    fuggoNaplo: [{ id: uid(), ts: most(), ki: en().kulcs, kiNev: en().nev, szoveg: 'csatlakozott a projekthez' }],
    createdAt: most(), updatedAt: most()
  };
  kicsomagol(p, r.data.adat);
  for (const k of Object.keys(MEZOK)) {
    if (mezok[k]) { p.mezoTs[k] = mezok[k].ts; p.mezoKi[k] = mezok[k].ki; }
  }

  STORE.projects.push(p);
  await persist();
  $('#joinModal').classList.add('hidden');
  $('#joinUrl').value = ''; $('#joinPath').value = '';
  selectProject(p.id);
  toast('Csatlakoztál: ' + p.name);
  szinkron(p, { csendes: true });
}

async function megosztastKikapcsol() {
  const p = project();
  if (!p || !p.megosztas) return;
  if (!confirm('Kikapcsolod a megosztást?\n\nA jegyzetek és a haladás megmaradnak nálad, '
    + 'csak nem frissülnek többé a haverodéval. A GitHubon lévő repó érintetlen marad.')) return;
  await window.api.megosztas.leval(p.id);
  p.megosztas = { be: false, repo: p.megosztas.repo, utolso: '', tagok: [], naplo: [], hiba: '' };
  p.fuggoNaplo = [];
  await persist();
  renderShare(); renderNotes(); renderProjectList();
  toast('Megosztás kikapcsolva.');
}

/* ====================== fajlfa + szerkeszto ====================== */

async function loadTree() {
  const p = project();
  const box = $('#fileTree');
  box.innerHTML = '';
  if (!p || !p.path) { box.innerHTML = '<div class="eline" style="padding:6px">Nincs mappa megadva.</div>'; return; }
  const r = await window.api.fs.tree(p.path);
  if (!r.ok) { box.innerHTML = `<div class="eline" style="padding:6px">${r.error}</div>`; return; }
  if (!r.data.length) { box.innerHTML = '<div class="eline" style="padding:6px">Üres mappa.</div>'; return; }
  box.appendChild(treeNodes(r.data));
}

function treeNodes(nodes) {
  const frag = document.createDocumentFragment();
  for (const n of nodes) {
    const row = document.createElement('div');
    row.className = 'node';
    row.innerHTML = `<span class="ic">${n.dir ? '▸' : '·'}</span><span class="nm"></span>`;
    row.querySelector('.nm').textContent = n.name;
    frag.appendChild(row);

    if (n.dir) {
      const kids = document.createElement('div');
      kids.className = 'children hidden';
      kids.appendChild(treeNodes(n.children || []));
      frag.appendChild(kids);
      row.addEventListener('click', () => {
        const zart = kids.classList.toggle('hidden');
        row.querySelector('.ic').textContent = zart ? '▸' : '▾';
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
      monaco.editor.defineTheme('ph', {
        base: 'vs-dark', inherit: true, rules: [],
        colors: { 'editor.background': '#0c0d10', 'editorGutter.background': '#0c0d10' }
      });
      editor = monaco.editor.create(document.getElementById('monaco'), {
        value: '', language: 'plaintext', theme: 'ph', automaticLayout: true,
        fontSize: 13, fontFamily: 'Cascadia Code, Consolas, monospace',
        minimap: { enabled: true }, tabSize: 2, scrollBeyondLastLine: false,
        padding: { top: 12 }
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
        '<p>A beépített szerkesztő nem tölt be.<br />Fejlesztői módban futtasd újra: <code>npm install</code>.</p>';
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

/* ====================== XAMPP / Drive ====================== */

async function refreshXampp() {
  const r = await window.api.xampp.status();
  if (!r.ok) return;
  const { apache, mysql } = r.data;
  $('#pillApache').classList.toggle('on', apache);
  $('#pillMysql').classList.toggle('on', mysql);
  const da = $('#dotApache'), dm = $('#dotMysql');
  if (da) da.className = 'dot' + (apache ? ' on' : '');
  if (dm) dm.className = 'dot' + (mysql ? ' on' : '');
}

async function uploadProject() {
  const p = project();
  if (!p) return;
  if (!STORE.settings.driveFolder) { toast('Előbb add meg a Drive mappát a Beállításokban.', true); openSettings(); return; }
  if (!p.path) { toast('Ehhez a projekthez nincs mappa megadva.', true); return; }

  toast('Másolás a Drive mappába…');
  log(`Feltöltés indul: ${p.path}`);
  const r = await window.api.drive.upload({
    source: p.path, driveFolder: STORE.settings.driveFolder,
    subfolder: p.driveSubfolder || p.name || baseName(p.path)
  });
  if (!r.ok) { toast(r.error, true); log('Feltöltés hiba: ' + r.error, 'err'); return; }
  const mb = (r.data.bytes / 1048576).toFixed(2);
  toast(`Kész: ${r.data.files} fájl (${mb} MB)`);
  log(`Feltöltve ${r.data.files} fájl (${mb} MB) ide: ${r.data.dest}`, 'okl');
  p.lastUpload = most();
  touch(p); scheduleSave();
}

/* ====================== beallitasok ====================== */

function openSettings() {
  const s = STORE.settings;
  $('#sMeName').value = s.enNev || '';
  $('#sMeGithub').value = s.enGithub || '';
  $('#sVscodium').value = s.vscodiumPath || '';
  $('#sXampp').value = s.xamppPath || '';
  $('#sHtdocs').value = s.htdocsPath || '';
  $('#sDrive').value = s.driveFolder || '';
  window.api.store.path().then((r) => { if (r.ok) $('#storeHint').textContent = 'Adatfájl: ' + r.data; });
  $('#gitHint').textContent = gitOk ? ('Git: ' + gitUzenet) : ('Git: nincs — a megosztás nem fog működni');
  $('#settingsModal').classList.remove('hidden');
}

function renderMe() {
  const e = en();
  const a = avatarStilus(e.kulcs, e.nev);
  const av = $('#meAvatar');
  av.textContent = a.betu;
  av.style.background = a.bg;
  av.style.color = a.fg;
  $('#meName').textContent = e.nev;
}

/* ====================== fulek ====================== */

function valtFul(nev) {
  $$('.tb').forEach((x) => x.classList.toggle('on', x.dataset.tab === nev));
  $$('.pane').forEach((x) => x.classList.toggle('on', x.dataset.panel === nev));
  if (nev === 'editor' && editor) setTimeout(() => editor.layout(), 50);
  if (nev === 'preview') openPreview();
  if (nev === 'tools') refreshXampp();
  if (nev === 'share') renderShare();
}

/* ====================== esemenyek ====================== */

function bind() {
  $$('.tb').forEach((t) => t.addEventListener('click', () => valtFul(t.dataset.tab)));
  $('#btnAllNotes').addEventListener('click', () => valtFul('notes'));
  $('#searchInput').addEventListener('input', renderProjectList);

  /* --- uj projekt --- */
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
    const t = most();
    const p = {
      id: uid(),
      name: name || baseName($('#nPath').value) || 'Új projekt',
      path: $('#nPath').value.trim(),
      previewUrl: $('#nPreview').value.trim(),
      previewMode: 'auto', progress: 0, status: 'planning',
      color: SZINEK[STORE.projects.length % SZINEK.length],
      deadline: '', description: '', driveSubfolder: name || '',
      notes: [], mezoTs: {}, mezoKi: {},
      megosztas: { be: false, repo: '', utolso: '', tagok: [], naplo: [], hiba: '' },
      fuggoNaplo: [], createdAt: t, updatedAt: t
    };
    for (const k of Object.keys(MEZOK)) { p.mezoTs[k] = t; p.mezoKi[k] = en().kulcs; }
    STORE.projects.push(p);
    persist();
    $('#newModal').classList.add('hidden');
    selectProject(p.id);
    toast('Projekt létrehozva.');
  });

  /* --- haladas --- */
  $('#progressRange').addEventListener('input', (e) => {
    const p = project(); if (!p) return;
    const regi = p.progress || 0;
    const uj = +e.target.value;
    p.progress = uj;
    setRing(uj);
    p.mezoTs = p.mezoTs || {}; p.mezoKi = p.mezoKi || {};
    p.mezoTs.haladas = most(); p.mezoKi.haladas = en().kulcs;
    touch(p); scheduleSave(); renderProjectList();
    clearTimeout($('#progressRange')._n);
    $('#progressRange')._n = setTimeout(() => {
      if (regi !== p.progress) naplozz(p, `haladás ${regi}% → ${p.progress}%`);
      szinkronKesobb(p);
    }, 900);
  });
  $$('[data-setprog]').forEach((b) => b.addEventListener('click', () => {
    const p = project(); if (!p) return;
    const regi = p.progress || 0;
    mezotAllit(p, 'haladas', +b.dataset.setprog, `haladás ${regi}% → ${b.dataset.setprog}%`);
    $('#progressRange').value = p.progress;
    setRing(p.progress);
    renderProjectList();
  }));

  /* --- urlapmezok --- */
  const kozosMezo = { '#fName': 'nev', '#fDesc': 'leiras', '#projStatus': 'allapot', '#projDeadline': 'hatarido' };
  const helyiMezo = { '#fPath': 'path', '#fPreview': 'previewUrl', '#fDriveSub': 'driveSubfolder', '#fPreviewMode': 'previewMode' };

  Object.entries(kozosMezo).forEach(([sel, kozos]) => {
    const node = $(sel);
    const evt = (node.tagName === 'SELECT' || node.type === 'date') ? 'change' : 'input';
    node.addEventListener(evt, (e) => {
      const p = project(); if (!p) return;
      const regi = p[MEZOK[kozos]];
      mezotAllit(p, kozos, e.target.value,
        kozos === 'allapot' ? `állapotot állított: ${STATUS_LABEL[e.target.value] || e.target.value}` : '');
      if (kozos === 'nev') { $('#projName').textContent = p.name; renderProjectList(); }
      if (kozos === 'allapot' || kozos === 'hatarido') { renderStrip(p); renderProjectList(); }
      void regi;
    });
  });

  Object.entries(helyiMezo).forEach(([sel, kulcs]) => {
    const node = $(sel);
    const evt = node.tagName === 'SELECT' ? 'change' : 'input';
    node.addEventListener(evt, (e) => {
      const p = project(); if (!p) return;
      p[kulcs] = e.target.value;
      touch(p); scheduleSave();
      if (kulcs === 'path') { $('#projPath').textContent = p.path; loadTree(); }
      if (kulcs === 'previewMode') { $('#pvMode').value = p.previewMode; openPreview(); }
      if (kulcs === 'previewUrl' && $('#pvMode').value === 'url') $('#pvUrl').value = p.previewUrl;
    });
  });

  $('#btnPickPath').addEventListener('click', async () => {
    const r = await window.api.dialog.pickFolder('Projekt mappája');
    if (r.ok && r.data) {
      const p = project(); if (!p) return;
      p.path = r.data; $('#fPath').value = r.data; $('#projPath').textContent = r.data;
      touch(p); scheduleSave(); loadTree();
    }
  });

  $('#btnDeleteProject').addEventListener('click', async () => {
    const p = project(); if (!p) return;
    if (!confirm(`Biztos törlöd a(z) "${p.name}" projektet a listából?\n\n(A gépeden lévő fájlok NEM törlődnek.)`)) return;
    if (p.megosztas && p.megosztas.be) await window.api.megosztas.leval(p.id);
    STORE.projects = STORE.projects.filter((x) => x.id !== p.id);
    persist();
    currentId = null;
    renderProjectList();
    if (STORE.projects.length) selectProject(STORE.projects[0].id);
    else { $('#workspace').classList.add('hidden'); $('#emptyState').classList.remove('hidden'); }
  });

  /* --- jegyzetek --- */
  const addNote = () => {
    const p = project(); if (!p) return;
    const text = $('#noteText').value.trim();
    if (!text) return;
    const t = most();
    p.notes = p.notes || [];
    p.notes.push({
      id: uid(), text, type: $('#noteType').value, prio: $('#notePrio').value,
      done: false, created: t, doneAt: null,
      szerzo: en().kulcs, szerzoNev: en().nev, modositva: t, modosito: en().kulcs, torolve: false
    });
    $('#noteText').value = '';
    naplozz(p, 'hozzáadott egyet: „' + text + '”');
    touch(p); scheduleSave();
    renderNotes(); renderStrip(p); renderProjectList(); szinkronKesobb(p);
  };
  $('#btnAddNote').addEventListener('click', addNote);
  $('#noteText').addEventListener('keydown', (e) => { if (e.key === 'Enter') addNote(); });
  $('#showDone').addEventListener('change', renderNotes);
  $('#noteWho').addEventListener('change', renderNotes);

  /* --- megosztas --- */
  $('#btnShareOn').addEventListener('click', megosztastBekapcsol);
  $('#btnShareOff').addEventListener('click', megosztastKikapcsol);
  $('#btnSyncNow').addEventListener('click', () => szinkron(project()));
  $('#btnNewRepo').addEventListener('click', () => {
    const p = project();
    const nev = (p && p.name ? p.name : 'projekt').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'projekt';
    window.api.open.external('https://github.com/new?name=' + encodeURIComponent(nev + '-hub'));
    toast('Hozd létre üresen, majd másold ide a linkjét.');
  });
  $('#btnInvite').addEventListener('click', () => {
    const p = project(); if (!p || !p.megosztas) return;
    window.api.open.external(webUrl(p.megosztas.repo) + '/settings/access');
  });
  $('#btnShareOpenRepo').addEventListener('click', () => {
    const p = project(); if (!p || !p.megosztas) return;
    window.api.open.external(webUrl(p.megosztas.repo));
  });
  $('#btnShareFolder').addEventListener('click', async () => {
    const p = project(); if (!p) return;
    const r = await window.api.megosztas.mappa(p.id);
    if (r.ok) window.api.open.explorer(r.data);
  });
  $('#btnJoin').addEventListener('click', () => {
    $('#joinErr').classList.add('hidden');
    $('#joinModal').classList.remove('hidden');
    $('#joinUrl').focus();
  });
  $('#btnCloseJoin').addEventListener('click', () => $('#joinModal').classList.add('hidden'));
  $('#btnJoinGo').addEventListener('click', csatlakozas);
  $('#btnJoinPick').addEventListener('click', async () => {
    const r = await window.api.dialog.pickFolder('A projekt mappája nálad');
    if (r.ok && r.data) $('#joinPath').value = r.data;
  });

  /* --- szerkeszto --- */
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

  /* --- elonezet --- */
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

  /* --- eszkozok --- */
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
    valtFul('preview');
    navigate('http://localhost/phpmyadmin');
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

  $('#btnUploadDrive').addEventListener('click', uploadProject);
  $('#btnUploadFiles').addEventListener('click', async () => {
    const p = project(); if (!p) return;
    if (!STORE.settings.driveFolder) { toast('Nincs Drive mappa beállítva.', true); return; }
    const pick = await window.api.dialog.pickFile({ title: 'Feltöltendő fájlok', multi: true });
    if (!pick.ok || !pick.data || !pick.data.length) return;
    const r = await window.api.drive.upload({
      driveFolder: STORE.settings.driveFolder,
      subfolder: p.driveSubfolder || p.name, files: pick.data
    });
    if (!r.ok) { toast(r.error, true); return; }
    toast(`${r.data.files} fájl feltöltve.`);
    log(`${r.data.files} fájl → ${r.data.dest}`, 'okl');
  });

  /* --- beallitasok --- */
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnCloseSettings').addEventListener('click', () => $('#settingsModal').classList.add('hidden'));
  $('#btnSaveSettings').addEventListener('click', () => {
    STORE.settings.enNev = $('#sMeName').value.trim() || 'Én';
    STORE.settings.enGithub = $('#sMeGithub').value.trim();
    STORE.settings.vscodiumPath = $('#sVscodium').value.trim();
    STORE.settings.xamppPath = $('#sXampp').value.trim();
    STORE.settings.htdocsPath = $('#sHtdocs').value.trim();
    STORE.settings.driveFolder = $('#sDrive').value.trim();
    persist();
    renderMe();
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
    beallitasokatPotol();
    currentId = null;
    renderMe(); renderProjectList();
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

  $$('.modal').forEach((m) => m.addEventListener('click', (e) => {
    if (e.target === m) m.classList.add('hidden');
  }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $$('.modal').forEach((m) => m.classList.add('hidden'));
  });
}

/* ====================== elonezet ====================== */

function navigate(url) {
  const wv = $('#pvView');
  try {
    if (wv.getURL && wv.getURL() === url) wv.reload();
    else wv.src = url;
  } catch (e) { wv.src = url; }
}
const withScheme = (u) => (/^https?:\/\//i.test(u) ? u : 'http://' + u);

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
    if (!raw) { info.textContent = 'Írj be egy címet — pl. http://localhost/projektnev — és nyomd meg a Megnyit gombot.'; return; }
    const url = withScheme(raw);
    $('#pvUrl').value = url;
    info.textContent = 'Saját URL — ehhez futnia kell a szervernek (XAMPP esetén az Apache-nak).';
    navigate(url);
    return;
  }

  if (!p || !p.path) { info.textContent = 'Ehhez a projekthez nincs mappa megadva — az Áttekintés fülön add meg.'; return; }

  let useServer = true;
  let insp = null;
  if (mode === 'auto') {
    const r = await window.api.preview.inspect(p.path);
    if (r.ok) {
      insp = r.data;
      if (!insp.exists) { info.textContent = 'A projekt mappája nem található: ' + p.path; return; }
      if (insp.hasPhp) useServer = false;
    }
  }

  if (!useServer) {
    const raw = (p.previewUrl || '').trim();
    if (!raw) {
      info.textContent = 'PHP-fájlokat találtam, ezekhez XAMPP kell. Add meg az Áttekintés fülön az előnézet URL-t '
        + '(pl. http://localhost/' + baseName(p.path) + ').';
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
    : 'Beépített szerver — nem kell XAMPP. Ezt a mappát szolgálja ki: ' + p.path;
  navigate(r.data.url);
}

/* ====================== indulas ====================== */

/** Regi mentes -> uj mezok potlasa. */
function beallitasokatPotol() {
  const s = STORE.settings = STORE.settings || {};
  if (!s.enKulcs) s.enKulcs = 'u-' + uid();
  if (!s.enNev) s.enNev = '';
  for (const p of STORE.projects) {
    p.notes = p.notes || [];
    p.mezoTs = p.mezoTs || {};
    p.mezoKi = p.mezoKi || {};
    p.fuggoNaplo = p.fuggoNaplo || [];
    p.megosztas = Object.assign(
      { be: false, repo: '', utolso: '', tagok: [], naplo: [], hiba: '' }, p.megosztas || {});
    for (const n of p.notes) if (n.torolve === undefined) n.torolve = false;
  }
}

(async function init() {
  bind();

  const r = await window.api.store.load();
  if (r.ok) STORE = r.data;
  beallitasokatPotol();

  // git + szemely
  const g = await window.api.megosztas.git();
  if (g.ok) {
    gitOk = !!g.data.ok;
    gitUzenet = g.data.ok ? (g.data.verzio || '') : (g.data.uzenet || '');
    if (!STORE.settings.enNev && g.data.szemely && g.data.szemely.nev) {
      STORE.settings.enNev = g.data.szemely.nev;
    }
    if (g.data.szemely && g.data.szemely.email) STORE.settings.enEmail = g.data.szemely.email;
  } else {
    gitOk = false;
    gitUzenet = g.error || 'A git nem elérhető.';
  }
  if (!STORE.settings.enNev) STORE.settings.enNev = 'Én';

  // elso indulas: talaljuk ki a beallitasokat
  if (!STORE.settings.vscodiumPath && !STORE.settings.driveFolder) {
    const d = await window.api.detect.all();
    if (d.ok) {
      STORE.settings.vscodiumPath = STORE.settings.vscodiumPath || d.data.vscodiumPath || '';
      STORE.settings.xamppPath = STORE.settings.xamppPath || d.data.xamppPath || '';
      STORE.settings.driveFolder = STORE.settings.driveFolder || d.data.driveFolder || '';
      if (STORE.settings.xamppPath && !STORE.settings.htdocsPath) {
        STORE.settings.htdocsPath = STORE.settings.xamppPath + window.api.sep + 'htdocs';
      }
    }
  }
  await persist();

  renderMe();
  renderProjectList();
  if (STORE.projects.length) selectProject(STORE.projects[0].id);

  refreshXampp();
  setInterval(refreshXampp, 8000);

  // idozitett szinkron minden megosztott projektre
  syncTimer = setInterval(() => {
    for (const p of STORE.projects) {
      if (p.megosztas && p.megosztas.be) { szinkron(p, { csendes: true }); break; }
    }
  }, 180000);
  window.addEventListener('focus', () => {
    const p = project();
    if (p && p.megosztas && p.megosztas.be) szinkron(p, { csendes: true });
  });
})();
