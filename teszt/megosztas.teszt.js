'use strict';
/* Ideiglenes teszt a megosztas modulhoz.
   Ket "gepet" jatszik el egy helyi bare repoval — GitHub nelkul.
   Futtatas:  node teszt-megosztas.js                                   */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const M = require('../megosztas');

const GYOKER = path.join(os.tmpdir(), 'ph-teszt-' + Date.now());
const BARE = path.join(GYOKER, 'tavoli.git');
const A_DIR = path.join(GYOKER, 'gepA');
const B_DIR = path.join(GYOKER, 'gepB');

const A = { kulcs: 'u-bence', nev: 'Bence', github: 'balindbence', email: 'bence@pelda.hu' };
const B = { kulcs: 'u-marci', nev: 'Marci', github: 'marci-dev', email: 'marci@pelda.hu' };

let hibak = [];
function ok(felt, mit) {
  console.log((felt ? '  OK    ' : '  HIBA  ') + mit);
  if (!felt) hibak.push(mit);
}
function sh(file, args, cwd) {
  return new Promise((res) => execFile(file, args, { cwd }, (e, o, s) =>
    res({ kod: e ? 1 : 0, ki: String(o || ''), hiba: String(s || '') })));
}

const most = () => new Date().toISOString();
let ora = Date.parse('2026-09-07T10:00:00.000Z');
const ts = (percPlusz = 0) => new Date(ora + percPlusz * 60000).toISOString();

function mezo(ertek, idopont, ki) { return { e: ertek, ts: idopont, ki }; }

function ujJegyzet(id, szoveg, szerzo, idopont, extra = {}) {
  return Object.assign({
    id, szoveg, tipus: 'todo', prio: 'normal', kesz: false,
    letrehozva: idopont, szerzo: szerzo.kulcs, szerzoNev: szerzo.nev,
    modositva: idopont, modosito: szerzo.kulcs, torolve: false
  }, extra);
}

async function main() {
  console.log('\n===== MEGOSZTAS ONTESZT =====');
  await fsp.mkdir(GYOKER, { recursive: true });

  // ---------- 0. ures "GitHub" repo ----------
  await fsp.mkdir(BARE, { recursive: true });
  await sh('git', ['init', '--bare', '-b', 'main', BARE]);
  ok(fs.existsSync(path.join(BARE, 'HEAD')), 'letrejott az ures tavoli repo');

  const g = await M.gitElerheto();
  ok(g.ok, 'git elerheto: ' + (g.verzio || g.uzenet));

  // ---------- 1. A megosztja (ures repoba ir eloszor) ----------
  const aHelyi1 = {
    projekt: {
      mezok: {
        nev: mezo('Portfólió oldal', ts(0), A.kulcs),
        haladas: mezo(40, ts(0), A.kulcs),
        allapot: mezo('in_progress', ts(0), A.kulcs),
        leiras: mezo('Saját bemutatkozó oldal.', ts(0), A.kulcs)
      }
    },
    jegyzetek: [
      ujJegyzet('j1', 'Sötét mód gomb kimaradt', A, ts(0)),
      ujJegyzet('j2', 'Referencia képek kellenek', A, ts(1))
    ],
    tagok: [],
    naplo: [{ id: 'n1', ts: ts(0), ki: A.kulcs, kiNev: A.nev, szoveg: 'megosztotta a projektet' }]
  };
  const r1 = await M.szinkron({ dir: A_DIR, repoUrl: BARE, helyi: aHelyi1, en: A });
  ok(r1.ok && !r1.csakHelyi, 'A: elso szinkron ures repoba sikerult');
  ok(r1.adat.jegyzetek.length === 2, 'A: ket jegyzet felment (' + r1.adat.jegyzetek.length + ')');
  ok(r1.adat.tagok.length === 1 && r1.adat.tagok[0].kulcs === A.kulcs, 'A: bekerult tagkent');

  // ---------- 2. B csatlakozik (csak olvas) ----------
  const b0 = await M.beolvas({ dir: B_DIR, repoUrl: BARE, en: B });
  ok(b0.ok && !b0.ures, 'B: latja a repot');
  ok(b0.adat.jegyzetek.length === 2, 'B: megkapta a ket jegyzetet');
  ok(b0.adat.projekt.mezok.nev.e === 'Portfólió oldal', 'B: megkapta a projekt nevet');
  ok(b0.adat.projekt.mezok.haladas.e === 40, 'B: megkapta a haladast (40)');

  // ---------- 3. mindketten dolgoznak, aztan szinkronizalnak ----------
  // B hozzaad egy sajatot es allit a haladason
  const bHelyi = {
    projekt: { mezok: Object.assign({}, b0.adat.projekt.mezok, {
      haladas: mezo(62, ts(10), B.kulcs)
    }) },
    jegyzetek: b0.adat.jegyzetek.concat([ujJegyzet('j3', 'Űrlap nem validál e-mailt', B, ts(10), { tipus: 'bug' })]),
    tagok: b0.adat.tagok,
    naplo: b0.adat.naplo.concat([{ id: 'n2', ts: ts(10), ki: B.kulcs, kiNev: B.nev, szoveg: 'haladás 40% → 62%' }])
  };
  const r2 = await M.szinkron({ dir: B_DIR, repoUrl: BARE, helyi: bHelyi, en: B });
  ok(r2.ok && !r2.csakHelyi, 'B: szinkron sikerult');
  ok(r2.adat.tagok.length === 2, 'B: mar ketten vannak a tagok kozt');

  // A eddig nem tudott errol; o mas jegyzetet ad hozza ugyanabban az idoben
  const aHelyi2 = {
    projekt: { mezok: Object.assign({}, r1.adat.projekt.mezok, {
      allapot: mezo('review', ts(12), A.kulcs)
    }) },
    jegyzetek: r1.adat.jegyzetek.concat([ujJegyzet('j4', 'Favicon hiányzik', A, ts(12))]),
    tagok: r1.adat.tagok,
    naplo: r1.adat.naplo
  };
  const r3 = await M.szinkron({ dir: A_DIR, repoUrl: BARE, helyi: aHelyi2, en: A });
  ok(r3.ok, 'A: masodik szinkron sikerult');

  const idk = r3.adat.jegyzetek.map((j) => j.id).sort();
  ok(JSON.stringify(idk) === JSON.stringify(['j1', 'j2', 'j3', 'j4']),
    'mind a negy jegyzet megvan, semmi nem veszett el: ' + idk.join(','));
  ok(r3.adat.projekt.mezok.haladas.e === 62, 'B haladasa (62) tulelte A szinkronjat');
  ok(r3.adat.projekt.mezok.allapot.e === 'review', 'A allapota is bekerult');
  ok(r3.adat.tagok.length === 2, 'mindket tag lathato');

  // ---------- 4. utkozo mezo: ket ember ugyanazt allitja ----------
  const aH3 = {
    projekt: { mezok: Object.assign({}, r3.adat.projekt.mezok, { haladas: mezo(70, ts(20), A.kulcs) }) },
    jegyzetek: r3.adat.jegyzetek, tagok: r3.adat.tagok, naplo: r3.adat.naplo
  };
  await M.szinkron({ dir: A_DIR, repoUrl: BARE, helyi: aH3, en: A });

  const bAllapot = await M.beolvas({ dir: B_DIR, repoUrl: BARE, en: B });
  const bH3 = {
    projekt: { mezok: Object.assign({}, bAllapot.adat.projekt.mezok, { haladas: mezo(85, ts(25), B.kulcs) }) },
    jegyzetek: bAllapot.adat.jegyzetek, tagok: bAllapot.adat.tagok, naplo: bAllapot.adat.naplo
  };
  const r4 = await M.szinkron({ dir: B_DIR, repoUrl: BARE, helyi: bH3, en: B });
  ok(r4.adat.projekt.mezok.haladas.e === 85, 'utkozesnel a kesobbi ertek nyer (85)');
  ok(r4.adat.projekt.mezok.haladas.ki === B.kulcs, 'es tudjuk, ki allitotta');

  // ---------- 5. torles atmegy a masik gepre ----------
  const aElotte = await M.beolvas({ dir: A_DIR, repoUrl: BARE, en: A });
  const torolt = aElotte.adat.jegyzetek.map((j) =>
    j.id === 'j2' ? Object.assign({}, j, { torolve: true, modositva: ts(30), modosito: A.kulcs }) : j);
  await M.szinkron({
    dir: A_DIR, repoUrl: BARE, en: A,
    helyi: { projekt: aElotte.adat.projekt, jegyzetek: torolt, tagok: aElotte.adat.tagok, naplo: aElotte.adat.naplo }
  });

  const bUtana = await M.beolvas({ dir: B_DIR, repoUrl: BARE, en: B });
  const j2 = bUtana.adat.jegyzetek.find((j) => j.id === 'j2');
  ok(!!j2 && j2.torolve === true, 'B is latja, hogy a j2 torolve lett');
  ok(bUtana.adat.jegyzetek.filter((j) => !j.torolve).length === 3, 'harom elo jegyzet maradt');

  // ---------- 6. torolt jegyzet nem tamad fel ----------
  // B-nek meg a REGI (nem torolt) valtozata van meg egy elavult masolatban
  const regiJ2 = aElotte.adat.jegyzetek.find((j) => j.id === 'j2');
  const bRegivel = {
    projekt: bUtana.adat.projekt,
    jegyzetek: bUtana.adat.jegyzetek.map((j) => (j.id === 'j2' ? regiJ2 : j)),
    tagok: bUtana.adat.tagok, naplo: bUtana.adat.naplo
  };
  const r6 = await M.szinkron({ dir: B_DIR, repoUrl: BARE, helyi: bRegivel, en: B });
  const j2b = r6.adat.jegyzetek.find((j) => j.id === 'j2');
  ok(!!j2b && j2b.torolve === true, 'a torles nem "tamad fel" egy elavult masolattol');

  // ---------- 7. parhuzamos push: kozben valaki mas ir ----------
  // Kesztetunk egy harmadik klont, ami A fetch-e utan pushol.
  const C_DIR = path.join(GYOKER, 'gepC');
  const cAllapot = await M.beolvas({ dir: C_DIR, repoUrl: BARE, en: B });
  await M.szinkron({
    dir: C_DIR, repoUrl: BARE, en: B,
    helyi: {
      projekt: cAllapot.adat.projekt,
      jegyzetek: cAllapot.adat.jegyzetek.concat([ujJegyzet('j9', 'Kozben erkezett', B, ts(40))]),
      tagok: cAllapot.adat.tagok, naplo: cAllapot.adat.naplo
    }
  });
  // A most szinkronizal egy regebbi kepbol kiindulva
  const r7 = await M.szinkron({
    dir: A_DIR, repoUrl: BARE, en: A,
    helyi: {
      projekt: aElotte.adat.projekt,
      jegyzetek: aElotte.adat.jegyzetek.concat([ujJegyzet('j10', 'A is irt', A, ts(41))]),
      tagok: aElotte.adat.tagok, naplo: aElotte.adat.naplo
    }
  });
  const van9 = r7.adat.jegyzetek.some((j) => j.id === 'j9');
  const van10 = r7.adat.jegyzetek.some((j) => j.id === 'j10');
  ok(van9 && van10, 'parhuzamos irasnal egyik oldal sem veszett el');

  // ---------- 8. a kodrepot nem bantjuk ----------
  const idegen = path.join(A_DIR, 'valami-mas.txt');
  await fsp.writeFile(idegen, 'ezt nem mi kezeljuk', 'utf8');
  const utolso = await M.beolvas({ dir: A_DIR, repoUrl: BARE, en: A });
  await M.szinkron({ dir: A_DIR, repoUrl: BARE, en: A, helyi: utolso.adat });
  ok(fs.existsSync(path.join(A_DIR, 'OLVASSEL.md')), 'keszult OLVASSEL.md a repoban');

  // ---------- 9. rossz link ----------
  let hibaUzenet = '';
  try {
    await M.szinkron({ dir: path.join(GYOKER, 'gepX'), repoUrl: path.join(GYOKER, 'nincs-ilyen.git'),
      helyi: M.URES_ALLAPOT(), en: A });
  } catch (e) { hibaUzenet = e.message; }
  ok(hibaUzenet.length > 0, 'rossz linknel ertheto hibat ad: ' + hibaUzenet.split('\n')[0].slice(0, 70));

  // ---------- vege ----------
  console.log('===== EREDMENY =====');
  if (!hibak.length) console.log('MINDEN TESZT ATMENT');
  else { console.log('SIKERTELEN: ' + hibak.length); hibak.forEach((h) => console.log('   - ' + h)); }
  console.log('====================\n');

  await fsp.rm(GYOKER, { recursive: true, force: true });
  process.exit(hibak.length ? 1 : 0);
}

main().catch((e) => { console.error('\nOSSZEOMLOTT:', e); process.exit(2); });
