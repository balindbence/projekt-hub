'use strict';
/* ===========================================================================
   MEGOSZTAS  —  kozos projekt ket gep kozott, GitHubon keresztul
   ===========================================================================

   MIT CSINAL
   ----------
   Egy projekt jegyzeteit, teendoit es haladasat szinkronizalja ket (vagy tobb)
   gep kozott. NEM a projekt kodrepojaban dolgozik, hanem egy sajat, pici
   repoban, amit teljesen ez a modul birtokol. Ezert nyugodtan tud benne
   "git reset --hard"-ot hasznalni: nincs benne semmi, amit a felhasznalo
   kezzel szerkesztene.

   MIERT IGY
   ---------
   Ha az app a projekt sajat repojat commitolgatna a hatterben, elobb-utobb
   osszeakadna a VSCodiumbol vegzett munkaval, es a felhasznalo egy merge
   konfliktus kozepen talalna magat anelkul, hogy kerte volna.

   A SZINKRON MENETE  (read-modify-write, ujraprobalassal)
   -------------------------------------------------------
       1. fetch
       2. reset --hard origin/<ag>      <- innentol a helyi masolat == a tavoli
       3. beolvassuk a tavoli allapotot
       4. osszefesuljuk a helyi allapottal   (entitasonkent az ujabb nyer)
       5. kiirjuk, commit, push
       6. ha a push elbukott (kozben mas is pusholt) -> vissza az 1-re

   Mivel a 2. lepes utan a helyi tortenet mindig a tavoli folytatasa, git-szintu
   merge konfliktus nem tud keletkezni. Az osszefesules a mi kezunkben van.

   MI HOL VAN A REPOBAN
   --------------------
       projekt.json          a projekt mezoi, mezonkenti idobelyeggel
       jegyzetek/<id>.json   egy jegyzet = egy fajl  (ezert nem utkoztok)
       tagok/<kulcs>.json    ki hasznalja a projektet
       naplo/<id>.json       "mi tortent" bejegyzesek
       OLVASSEL.md           magyarazat annak, aki a repot GitHubon nyitja meg

   Ez a modul NEM fugg az Electrontol — sima Node. Ezert tesztelheto kulon.
   =========================================================================== */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');

const NAPLO_MAX = 200;          // ennyi bejegyzest tartunk meg
const PUSH_PROBA = 3;           // ennyiszer probaljuk ujra, ha kozben mas pusholt

/* ------------------------------------------------------------------ *
 *  Parancsfuttatas
 * ------------------------------------------------------------------ */

function futtat(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 90000,
      ...opts
    }, (err, stdout, stderr) => {
      resolve({
        kod: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        ki: String(stdout || ''),
        hiba: String(stderr || ''),
        err: err || null
      });
    });
  });
}

const git = (args, cwd) => futtat('git', args, cwd ? { cwd } : {});

/** Van-e egyaltalan git a gepen? */
async function gitElerheto() {
  const r = await git(['--version']);
  if (r.kod !== 0) {
    return { ok: false, uzenet: 'Nem talalom a gitet. A megosztashoz telepitve kell lennie: https://git-scm.com' };
  }
  return { ok: true, verzio: r.ki.trim() };
}

/* ------------------------------------------------------------------ *
 *  Apro segedek
 * ------------------------------------------------------------------ */

const most = () => new Date().toISOString();

/** Fajlnevbe biztonsagos azonosito. */
function tisztaId(id) {
  return String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'x';
}

/** Ket ISO idobelyeg kozul az ujabb nyer. Ures/hianyzo = legregebbi. */
function ujabb(a, b) {
  return String(a || '') >= String(b || '') ? a : b;
}

async function olvasJson(p, alap = null) {
  try {
    return JSON.parse(await fsp.readFile(p, 'utf8'));
  } catch (e) {
    return alap;
  }
}

async function irJson(p, adat) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, JSON.stringify(adat, null, 2) + '\n', 'utf8');
}

async function listaz(dir) {
  try {
    return (await fsp.readdir(dir)).filter((n) => n.endsWith('.json'));
  } catch (e) {
    return [];
  }
}

/** A tavoli URL-bol emberi nev: balindbence/portfolio-hub */
function repoNev(url) {
  const m = String(url || '').match(/github\.com[/:]([^/]+\/[^/.]+)/i);
  return m ? m[1] : String(url || '');
}

/* ------------------------------------------------------------------ *
 *  A repo eloallitasa
 * ------------------------------------------------------------------ */

function vanRepo(dir) {
  try {
    return fs.existsSync(path.join(dir, '.git'));
  } catch (e) {
    return false;
  }
}

async function tavoliUrl(dir) {
  const r = await git(['remote', 'get-url', 'origin'], dir);
  return r.kod === 0 ? r.ki.trim() : '';
}

/** Melyik agon vagyunk? Ures repoban is ad ertelmes valaszt. */
async function agNeve(dir) {
  const r = await git(['symbolic-ref', '--short', 'HEAD'], dir);
  if (r.kod === 0 && r.ki.trim()) return r.ki.trim();
  return 'main';
}

/** Letezik-e az origin/<ag>? Ures repoban nem. */
async function vanTavoliAg(dir, ag) {
  const r = await git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${ag}`], dir);
  return r.kod === 0 && !!r.ki.trim();
}

/**
 * Gondoskodik rola, hogy a `dir`-ben a `repoUrl` klonja legyen.
 * Ha mas repo van ott, kicsereli.
 */
async function repotElokeszit(dir, repoUrl, en) {
  if (vanRepo(dir)) {
    const jelenlegi = await tavoliUrl(dir);
    if (normUrl(jelenlegi) !== normUrl(repoUrl)) {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  }

  if (!vanRepo(dir)) {
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(path.dirname(dir), { recursive: true });
    const r = await git(['clone', '--quiet', repoUrl, dir]);
    if (r.kod !== 0 || !vanRepo(dir)) {
      throw new Error(klonHiba(r, repoUrl));
    }
  }

  // A commithoz kell nev es e-mail. Ha nincs globalis, adunk sajatot.
  const nev = (en && en.nev) || 'Projekt Hub';
  const mail = (en && en.email) || 'projekt-hub@local';
  await git(['config', 'user.name', nev], dir);
  await git(['config', 'user.email', mail], dir);
  return dir;
}

function normUrl(u) {
  return String(u || '').trim().replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase();
}

function klonHiba(r, url) {
  const t = (r.hiba || '') + (r.ki || '');
  if (/authentication|could not read username|permission denied|403/i.test(t)) {
    return 'A GitHub nem engedett be. Nyisd meg egyszer a repot VSCodiumbol (vagy futtass egy git push-t), '
      + 'hogy a Windows elmentse a belepesi adatokat, aztan probald ujra.';
  }
  if (/not found|repository .* does not exist|404/i.test(t)) {
    return 'Nincs ilyen repo, vagy nincs hozza jogod: ' + url
      + '\nEllenorizd a linket, es hogy a fiokod tagja-e a repnak.';
  }
  if (/could not resolve host|network|timed out/i.test(t)) {
    return 'Nem erem el a GitHubot. Van internet?';
  }
  return 'A repo letoltese nem sikerult.\n' + (t.trim() || 'ismeretlen hiba');
}

/* ------------------------------------------------------------------ *
 *  Allapot beolvasasa / kiirasa
 * ------------------------------------------------------------------ */

const URES_ALLAPOT = () => ({ projekt: { mezok: {} }, jegyzetek: [], tagok: [], naplo: [] });

async function allapotOlvas(dir) {
  const a = URES_ALLAPOT();

  const pj = await olvasJson(path.join(dir, 'projekt.json'), null);
  if (pj && typeof pj === 'object') {
    a.projekt.mezok = (pj.mezok && typeof pj.mezok === 'object') ? pj.mezok : {};
  }

  for (const f of await listaz(path.join(dir, 'jegyzetek'))) {
    const j = await olvasJson(path.join(dir, 'jegyzetek', f), null);
    if (j && j.id) a.jegyzetek.push(j);
  }
  for (const f of await listaz(path.join(dir, 'tagok'))) {
    const t = await olvasJson(path.join(dir, 'tagok', f), null);
    if (t && t.kulcs) a.tagok.push(t);
  }
  for (const f of await listaz(path.join(dir, 'naplo'))) {
    const n = await olvasJson(path.join(dir, 'naplo', f), null);
    if (n && n.id) a.naplo.push(n);
  }
  return a;
}

/**
 * Kiirja az osszefesult allapotot. CSAK a sajat mappait bantja —
 * ha a repoban van mas is (pl. GitHub README), az marad.
 */
async function allapotIr(dir, a) {
  await irJson(path.join(dir, 'projekt.json'), { mezok: a.projekt.mezok });

  await konyvtartSzinkron(path.join(dir, 'jegyzetek'), a.jegyzetek, (j) => tisztaId(j.id));
  await konyvtartSzinkron(path.join(dir, 'tagok'), a.tagok, (t) => tisztaId(t.kulcs));
  await konyvtartSzinkron(path.join(dir, 'naplo'), a.naplo, (n) => tisztaId(n.id));

  const olvassel = path.join(dir, 'OLVASSEL.md');
  if (!fs.existsSync(olvassel)) {
    await fsp.writeFile(olvassel, LEIRAS, 'utf8');
  }
}

/** A mappa tartalma pontosan a lista legyen: ami kimaradt, torlodik. */
async function konyvtartSzinkron(dir, lista, kulcsFn) {
  await fsp.mkdir(dir, { recursive: true });
  const kell = new Set();
  for (const elem of lista) {
    const nev = kulcsFn(elem) + '.json';
    kell.add(nev);
    await irJson(path.join(dir, nev), elem);
  }
  for (const meglevo of await listaz(dir)) {
    if (!kell.has(meglevo)) {
      await fsp.rm(path.join(dir, meglevo), { force: true });
    }
  }
}

const LEIRAS = `# Projekt Hub — megosztott projekt

Ezt a repót a **Projekt Hub** alkalmazás kezeli. Nem kézzel kell szerkeszteni.

Csak a projekt *adatai* vannak benne — jegyzetek, teendők, haladás —, **a kódotok nem**.
A kód maradjon a saját repójában, a szokásos módon.

| Mi | Hol |
|---|---|
| a projekt mezői (név, haladás, állapot, határidő) | \`projekt.json\` |
| jegyzetek és teendők, egy fájl egy jegyzet | \`jegyzetek/\` |
| kik használják | \`tagok/\` |
| mi történt | \`naplo/\` |

Ha valakit be akartok venni: **Settings → Collaborators**, aztán ő a saját
Projekt Hubjában a *Csatlakozás közös projekthez* gombbal beilleszti ennek a
repónak a linkjét.
`;

/* ------------------------------------------------------------------ *
 *  OSSZEFESULES  — ez a lenyeg
 * ------------------------------------------------------------------ */

/**
 * @param tavoli   amit a GitHubon talaltunk
 * @param helyi    amit a gepen tartunk
 * @param en       {kulcs, nev, github}
 */
function osszefesul(tavoli, helyi, en) {
  const ki = URES_ALLAPOT();

  /* --- projekt mezoi: mezonkent az ujabb nyer --- */
  const mezok = {};
  const nevek = new Set([
    ...Object.keys((tavoli.projekt && tavoli.projekt.mezok) || {}),
    ...Object.keys((helyi.projekt && helyi.projekt.mezok) || {})
  ]);
  for (const nev of nevek) {
    const t = (tavoli.projekt.mezok || {})[nev];
    const h = (helyi.projekt.mezok || {})[nev];
    if (!t) { mezok[nev] = h; continue; }
    if (!h) { mezok[nev] = t; continue; }
    mezok[nev] = (String(h.ts || '') > String(t.ts || '')) ? h : t;
  }
  ki.projekt.mezok = mezok;

  /* --- jegyzetek: id szerint, az ujabb modositas nyer --- */
  const jmap = new Map();
  for (const j of tavoli.jegyzetek) if (j && j.id) jmap.set(j.id, j);
  for (const j of helyi.jegyzetek) {
    if (!j || !j.id) continue;
    const van = jmap.get(j.id);
    if (!van) { jmap.set(j.id, j); continue; }
    // A torles is csak egy modositas: az nyer, amelyik kesobbi.
    jmap.set(j.id, String(j.modositva || '') > String(van.modositva || '') ? j : van);
  }
  ki.jegyzetek = Array.from(jmap.values())
    .sort((a, b) => String(a.letrehozva || '').localeCompare(String(b.letrehozva || '')));

  /* --- tagok: mindenki a sajat sorat frissiti --- */
  const tmap = new Map();
  for (const t of tavoli.tagok) if (t && t.kulcs) tmap.set(t.kulcs, t);
  for (const t of helyi.tagok || []) if (t && t.kulcs && !tmap.has(t.kulcs)) tmap.set(t.kulcs, t);
  if (en && en.kulcs) {
    const regi = tmap.get(en.kulcs) || {};
    tmap.set(en.kulcs, {
      kulcs: en.kulcs,
      nev: en.nev || regi.nev || 'Ismeretlen',
      github: en.github || regi.github || '',
      csatlakozott: regi.csatlakozott || most(),
      utoljara: most()
    });
  }
  ki.tagok = Array.from(tmap.values())
    .sort((a, b) => String(a.csatlakozott || '').localeCompare(String(b.csatlakozott || '')));

  /* --- naplo: osszefuzve, ujak elol, felso hatarral --- */
  const nmap = new Map();
  for (const n of tavoli.naplo) if (n && n.id) nmap.set(n.id, n);
  for (const n of helyi.naplo || []) if (n && n.id) nmap.set(n.id, n);
  ki.naplo = Array.from(nmap.values())
    .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')))
    .slice(0, NAPLO_MAX);

  return ki;
}

/* ------------------------------------------------------------------ *
 *  A szinkron
 * ------------------------------------------------------------------ */

/**
 * @param opts.dir      hova klonozzuk (az app sajat mappajaban)
 * @param opts.repoUrl  a GitHub repo linkje
 * @param opts.helyi    {projekt:{mezok}, jegyzetek:[], naplo:[], tagok:[]}
 * @param opts.en       {kulcs, nev, github, email}
 * @param opts.uzenet   commit uzenet (opcionalis)
 */
async function szinkron(opts) {
  const { dir, repoUrl, helyi, en } = opts;

  const g = await gitElerheto();
  if (!g.ok) throw new Error(g.uzenet);
  if (!repoUrl) throw new Error('Nincs megadva a repo linkje.');

  await repotElokeszit(dir, repoUrl, en);
  const ag = await agNeve(dir);

  let eredmeny = null;
  let utolsoHiba = '';

  for (let proba = 1; proba <= PUSH_PROBA; proba++) {
    // 1) mi van a tavoliban
    const f = await git(['fetch', '--quiet', 'origin'], dir);
    if (f.kod !== 0 && proba === 1) {
      throw new Error(klonHiba(f, repoUrl));
    }

    // 2) allitsuk a helyi masolatot pontosan a tavolira
    let tavoliAllapot = URES_ALLAPOT();
    if (await vanTavoliAg(dir, ag)) {
      await git(['reset', '--hard', `origin/${ag}`], dir);
      await git(['clean', '-fdq'], dir);
      tavoliAllapot = await allapotOlvas(dir);
    }

    // 3) osszefesules
    eredmeny = osszefesul(tavoliAllapot, helyi, en);

    // 4) kiiras
    await allapotIr(dir, eredmeny);

    // 5) van-e egyaltalan valtozas?
    await git(['add', '-A'], dir);
    const allapot = await git(['status', '--porcelain'], dir);
    const vanValtozas = allapot.kod === 0 && allapot.ki.trim().length > 0;

    if (vanValtozas) {
      const uz = opts.uzenet || `${(en && en.nev) || 'valaki'} — frissites`;
      const c = await git(['commit', '-m', uz], dir);
      if (c.kod !== 0) {
        utolsoHiba = (c.hiba || c.ki || '').trim();
        // ures commit nem hiba, minden mas az
        if (!/nothing to commit/i.test(utolsoHiba)) {
          throw new Error('Nem sikerult menteni a valtozast.\n' + utolsoHiba);
        }
      }
    }

    // 6) push
    const helyben = await git(['rev-parse', 'HEAD'], dir);
    const vanMitTolni = helyben.kod === 0;
    if (!vanMitTolni) break;

    const p = await git(['push', 'origin', `HEAD:${ag}`], dir);
    if (p.kod === 0) {
      return { ok: true, adat: eredmeny, ag, repo: repoNev(repoUrl), ideje: most() };
    }

    utolsoHiba = ((p.hiba || '') + (p.ki || '')).trim();

    // Ha kozben valaki mas pusholt, ujra futunk. Minden mas hiba: megallunk.
    if (!/non-fast-forward|fetch first|rejected|behind/i.test(utolsoHiba)) {
      throw new Error(pushHiba(utolsoHiba, repoUrl));
    }
  }

  // Ha idaig eljutunk, haromszor is alulmaradtunk egy parhuzamos pushsal.
  if (eredmeny) {
    return {
      ok: true, csakHelyi: true, adat: eredmeny, ag, repo: repoNev(repoUrl), ideje: most(),
      figyelmeztetes: 'A valtozasaid osszefesultek, de a feltoltes nem fert be — kozben masok is mentettek. '
        + 'A kovetkezo szinkronnal felmegy.'
    };
  }
  throw new Error(pushHiba(utolsoHiba, repoUrl));
}

function pushHiba(szoveg, url) {
  const t = String(szoveg || '');
  if (/authentication|could not read username|permission denied|403/i.test(t)) {
    return 'A GitHub nem engedte a feltoltest. Van jogod irni ebbe a repoba?\n'
      + 'Ha a haverod repoja, kerd meg, hogy vegyen fel Collaboratornak.';
  }
  if (/could not resolve host|network|timed out/i.test(t)) {
    return 'Nem erem el a GitHubot. Van internet?';
  }
  if (/protected branch|pre-receive hook/i.test(t)) {
    return 'A GitHub visszautasitotta a feltoltest (vedett ag?). Nezd meg a repo beallitasait: ' + url;
  }
  return 'A feltoltes nem sikerult.\n' + (t || 'ismeretlen hiba');
}

/* ------------------------------------------------------------------ *
 *  Csak beolvasas — csatlakozaskor hasznaljuk
 * ------------------------------------------------------------------ */

/** Letolti a repot es visszaadja, mi van benne. Nem ir bele semmit. */
async function beolvas(opts) {
  const { dir, repoUrl, en } = opts;
  const g = await gitElerheto();
  if (!g.ok) throw new Error(g.uzenet);

  await repotElokeszit(dir, repoUrl, en);
  const ag = await agNeve(dir);
  const f = await git(['fetch', '--quiet', 'origin'], dir);
  if (f.kod !== 0) throw new Error(klonHiba(f, repoUrl));

  if (!(await vanTavoliAg(dir, ag))) {
    return { ok: true, ures: true, adat: URES_ALLAPOT(), ag, repo: repoNev(repoUrl) };
  }
  await git(['reset', '--hard', `origin/${ag}`], dir);
  await git(['clean', '-fdq'], dir);
  return { ok: true, ures: false, adat: await allapotOlvas(dir), ag, repo: repoNev(repoUrl) };
}

/** A gep git-beallitasai — ebbol talaljuk ki, ki vagy. */
async function gitSzemely() {
  const n = await git(['config', '--get', 'user.name']);
  const e = await git(['config', '--get', 'user.email']);
  return {
    nev: n.kod === 0 ? n.ki.trim() : '',
    email: e.kod === 0 ? e.ki.trim() : ''
  };
}

module.exports = {
  gitElerheto,
  gitSzemely,
  szinkron,
  beolvas,
  osszefesul,
  repoNev,
  URES_ALLAPOT,
  _teszt: { allapotOlvas, allapotIr, repotElokeszit, agNeve }
};
