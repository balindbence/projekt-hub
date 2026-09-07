#!/usr/bin/env python3
"""Ideiglenes UI-teszt: a renderert Chromiumban futtatja hamis window.api-val.
   Azt nezi, hogy a felulet nem dob-e hibat, es hogy a logika helyesen mukodik-e.
   Futtatas:  python3 teszt-ui.py"""

import http.server, socketserver, threading, functools, json, sys, os
from playwright.sync_api import sync_playwright

GYOKER = os.path.dirname(os.path.abspath(__file__))
import socket as _sock
_t = _sock.socket(); _t.bind(("127.0.0.1", 0)); PORT = _t.getsockname()[1]; _t.close()
hibak = []

def ok(felt, mit):
    print(("  OK    " if felt else "  HIBA  ") + mit)
    if not felt:
        hibak.append(mit)

# ---------- statikus szerver ----------
class Csend(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

class Ujra(socketserver.TCPServer):
    allow_reuse_address = True

def szerver():
    h = functools.partial(Csend, directory=GYOKER)
    with Ujra(("127.0.0.1", PORT), h) as s:
        s.serve_forever()

threading.Thread(target=szerver, daemon=True).start()

import time, socket
for _ in range(50):
    try:
        socket.create_connection(("127.0.0.1", PORT), 0.2).close(); break
    except OSError:
        time.sleep(0.1)

# ---------- hamis window.api ----------
MOCK = r"""
window.__hivasok = [];
const _tarolo = { settings: {}, projects: [] };
const j = (d) => ({ ok: true, data: d });

// A "tavoli" oldal: ide kerul, amit felkuldunk, es innen jon vissza,
// kiegeszitve egy masik ember jegyzetevel — mintha Marci is dolgozna.
window.__tavoli = null;

window.api = {
  platform: 'win32', sep: '\\',
  store: {
    load: async () => j(JSON.parse(JSON.stringify(_tarolo))),
    save: async (d) => { Object.assign(_tarolo, JSON.parse(JSON.stringify(d))); return j(true); },
    path: async () => j('C:\\teszt\\adat.json'),
    export: async () => j(null),
    import: async () => j(null)
  },
  detect: { all: async () => j({ vscodiumPath: '', xamppPath: '', driveFolder: '' }) },
  dialog: {
    pickFolder: async () => j('C:\\xampp\\htdocs\\teszt'),
    pickFile: async () => j(null)
  },
  fs: {
    tree: async () => j([
      { name: 'index.html', rel: 'index.html', abs: 'C:\\x\\index.html', dir: false, ext: '.html' },
      { name: 'css', rel: 'css', abs: 'C:\\x\\css', dir: true, children: [
        { name: 'style.css', rel: 'css/style.css', abs: 'C:\\x\\css\\style.css', dir: false, ext: '.css' }] }
    ]),
    read: async () => j({ binary: false, ext: '.html', size: 10, content: '<h1>hi</h1>', language: 'html' }),
    write: async () => j(true), newFile: async () => j('C:\\x\\uj.txt'), exists: async () => j(true)
  },
  open: {
    vscodium: async () => j(true), explorer: async () => j(true),
    external: async (u) => { window.__hivasok.push('external:' + u); return j(true); },
    terminal: async () => j(true)
  },
  xampp: {
    status: async () => j({ apache: true, mysql: false }),
    control: async () => j(true), panel: async () => j(true)
  },
  drive: { upload: async () => j({ dest: 'X', files: 3, bytes: 1048576, skipped: 0 }), openFolder: async () => j(true) },
  preview: {
    inspect: async () => j({ exists: true, hasIndex: true, hasPhp: false }),
    serve: async () => j({ url: 'http://127.0.0.1:1234/', port: 1234 }), stop: async () => j(true)
  },
  megosztas: {
    git: async () => j({ ok: true, verzio: 'git version 2.43.0', uzenet: '',
                         szemely: { nev: 'Bence', email: 'bence@pelda.hu' } }),
    szinkron: async (p) => {
      window.__hivasok.push('szinkron');
      // Ugy teszunk, mintha a tavoli oldalon Marci is dolgozott volna.
      const a = JSON.parse(JSON.stringify(p.helyi));
      a.jegyzetek.push({
        id: 'marci-1', szoveg: 'Marci hibaja', tipus: 'bug', prio: 'high', kesz: false,
        keszAt: null, letrehozva: '2026-09-07T08:00:00.000Z',
        szerzo: 'u-marci', szerzoNev: 'Marci',
        modositva: '2026-09-07T08:00:00.000Z', modosito: 'u-marci', torolve: false
      });
      a.tagok = [
        { kulcs: p.en.kulcs, nev: p.en.nev, github: p.en.github, csatlakozott: '2026-09-01T10:00:00.000Z', utoljara: new Date().toISOString() },
        { kulcs: 'u-marci', nev: 'Marci', github: 'marci-dev', csatlakozott: '2026-09-02T10:00:00.000Z', utoljara: '2026-09-07T08:00:00.000Z' }
      ];
      a.naplo = [{ id: 'n-m', ts: '2026-09-07T08:00:00.000Z', ki: 'u-marci', kiNev: 'Marci',
                   szoveg: 'hozzáadott egy hibát' }].concat(a.naplo || []);
      window.__tavoli = a;
      return j({ ok: true, adat: a, ag: 'main', repo: 'teszt/repo', ideje: new Date().toISOString() });
    },
    beolvas: async () => j({ ok: true, ures: false, ag: 'main', repo: 'teszt/repo', adat: {
      projekt: { mezok: {
        nev: { e: 'Csatlakozott projekt', ts: '2026-09-06T10:00:00.000Z', ki: 'u-marci' },
        haladas: { e: 45, ts: '2026-09-06T10:00:00.000Z', ki: 'u-marci' },
        allapot: { e: 'in_progress', ts: '2026-09-06T10:00:00.000Z', ki: 'u-marci' },
        leiras: { e: 'Marci projektje', ts: '2026-09-06T10:00:00.000Z', ki: 'u-marci' },
        hatarido: { e: '', ts: '2026-09-06T10:00:00.000Z', ki: 'u-marci' },
        szin: { e: '#6f8cff', ts: '2026-09-06T10:00:00.000Z', ki: 'u-marci' }
      } },
      jegyzetek: [{ id: 'mj1', szoveg: 'Marci teendoje', tipus: 'todo', prio: 'normal', kesz: false,
        keszAt: null, letrehozva: '2026-09-06T10:00:00.000Z', szerzo: 'u-marci', szerzoNev: 'Marci',
        modositva: '2026-09-06T10:00:00.000Z', modosito: 'u-marci', torolve: false }],
      tagok: [{ kulcs: 'u-marci', nev: 'Marci', github: 'marci-dev',
                csatlakozott: '2026-09-02T10:00:00.000Z', utoljara: '2026-09-07T08:00:00.000Z' }],
      naplo: []
    } }),
    mappa: async () => j('C:\\adat\\megosztas\\x'),
    leval: async () => j(true)
  }
};
window.confirm = () => true;
window.prompt = () => 'uj.txt';
"""

def main():
    print("\n===== UI ONTESZT =====")
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        page = b.new_page(viewport={"width": 1440, "height": 900})

        naplo = []
        page.on("console", lambda m: naplo.append((m.type, m.text)))
        page.on("pageerror", lambda e: naplo.append(("pageerror", str(e))))

        page.add_init_script(MOCK)
        page.goto(f"http://127.0.0.1:{PORT}/src/index.html")
        page.wait_for_timeout(700)

        sulyos = [t for t in naplo if t[0] in ("pageerror",) or (t[0] == "error" and "teszt-stub" not in t[1])]
        ok(not sulyos, "betoltodott JS-hiba nelkul" + (" — " + str(sulyos[:2]) if sulyos else ""))

        # ---------- ures allapot ----------
        ok(page.is_visible("#emptyState"), "ures allapot latszik, ha nincs projekt")

        # ---------- uj projekt ----------
        page.click("#btnNewProjectEmpty")
        page.fill("#nName", "Portfólió oldal")
        page.fill("#nPath", "C:\\xampp\\htdocs\\portfolio")
        page.click("#btnCreateProject")
        page.wait_for_timeout(250)
        ok(page.is_visible("#workspace"), "letrejott a projekt, latszik a munkafelulet")
        ok(page.inner_text("#projName").strip() == "Portfólió oldal", "a fejlecben a projekt neve")
        ok(page.locator("#projectList .p").count() == 1, "egy elem az oldalsavban")

        # ---------- haladas ----------
        page.click('[data-setprog="75"]')
        page.wait_for_timeout(150)
        ok(page.inner_text("#ringLabel").strip() == "75%", "a haladas-gyuru 75%-ot mutat")
        ok("75%" in page.inner_text("#projectList .p"), "az oldalsav is 75%-ot mutat")

        # ---------- allapot / hatarido ----------
        page.select_option("#projStatus", "review")
        page.wait_for_timeout(120)
        ok("Átnézés" in page.inner_text("#stStatus"), "statuszcsik koveti az allapotot")
        page.fill("#projDeadline", "2030-01-01")
        page.dispatch_event("#projDeadline", "change")
        page.wait_for_timeout(120)
        ok("Még" in page.inner_text("#stDeadline"), "hatarido kiszamolva: " + page.inner_text("#stDeadline"))

        # ---------- jegyzetek ----------
        page.click('.tb[data-tab="notes"]')
        page.fill("#noteText", "Sötét mód gomb kimaradt")
        page.select_option("#notePrio", "high")
        page.click("#btnAddNote")
        page.wait_for_timeout(150)
        page.fill("#noteText", "Favicon hiányzik")
        page.select_option("#notePrio", "normal")
        page.click("#btnAddNote")
        page.wait_for_timeout(200)
        ok(page.locator("#noteList .todo").count() == 2, "ket jegyzet a listaban")
        ok(page.inner_text("#notesBadge").strip() == "2", "a ful jelzoje 2")

        page.click('.tb[data-tab="overview"]')
        page.wait_for_timeout(150)
        ok(page.inner_text("#stTodos").strip() == "2", "attekintes: 2 nyitott teendo")
        ok("1 fontos" in page.inner_text("#stTodosSub"), "es 1 fontos")
        ok(page.locator("#overviewNotes .todo").count() == 2, "attekintesben is latszanak")

        # kesz jeloles
        page.click("#overviewNotes .todo .cbx")
        page.wait_for_timeout(200)
        ok(page.inner_text("#stTodos").strip() == "1", "lezaras utan 1 nyitott")

        # ---------- megosztas: meg nincs ----------
        page.click('.tb[data-tab="share"]')
        page.wait_for_timeout(150)
        ok(page.is_visible("#shareOff"), "megosztas ful: a bekapcsolo latszik")
        ok(not page.is_visible("#shareOn"), "a megosztott nezet meg rejtve")

        # ures link -> hibauzenet
        page.click("#btnShareOn")
        page.wait_for_timeout(150)
        ok(page.is_visible("#shareErr"), "ures link eseten szol")

        # ---------- megosztas bekapcsolasa ----------
        page.fill("#shareUrl", "https://github.com/balindbence/portfolio-hub")
        page.click("#btnShareOn")
        page.wait_for_timeout(600)
        ok(page.is_visible("#shareOn"), "megosztas bekapcsolt")
        ok("balindbence/portfolio-hub" in page.inner_text("#shareRepo"), "a repo neve latszik")
        ok("Szinkronizálva" in page.inner_text("#syncState"), "szinkron-allapot: " + page.inner_text("#syncState").strip())
        ok(page.locator("#memberList .mem").count() == 2, "ket tag jelenik meg")
        ok("te" in page.inner_text("#memberList"), "sajat magadat 'te'-kent jeloli")
        ok(page.locator("#feed .fi").count() >= 2, "a naplo feltoltodott")

        # a tavolrol erkezett jegyzet megjelent-e
        page.click('.tb[data-tab="notes"]')
        page.wait_for_timeout(200)
        szoveg = page.inner_text("#noteList")
        ok("Marci hibaja" in szoveg, "Marci jegyzete atjott a szinkronnal")
        ok("Marci" in szoveg, "es latszik a szerzoje")
        ok(page.is_visible("#noteWho"), "kozos projektnel megjelent a 'ki' szuro")

        # szuro Marcira
        page.select_option("#noteWho", "u-marci")
        page.wait_for_timeout(200)
        ok(page.locator("#noteList .todo").count() == 1, "szures Marcira: 1 jegyzet")
        page.select_option("#noteWho", "")
        page.wait_for_timeout(150)

        # ---------- torles = sirko ----------
        elotte = page.locator("#noteList .todo").count()
        page.locator("#noteList .todo").first.locator(".ndel").click()
        page.wait_for_timeout(250)
        utana = page.locator("#noteList .todo").count()
        ok(utana == elotte - 1, "torles utan eggyel kevesebb latszik")
        tarolt = page.evaluate("() => STORE.projects[0].notes.filter(n => n.torolve).length")
        ok(tarolt == 1, "de a jegyzet megmaradt sirkokent (torolve=true)")

        # ---------- oldalsav jelzi a kozos projektet ----------
        ok("közös" in page.inner_text("#projectList"), "az oldalsav jelzi, hogy kozos")

        # ---------- csatlakozas masik projekthez ----------
        page.click('.tb[data-tab="share"]')
        page.wait_for_timeout(100)
        page.evaluate("() => document.querySelector('#shareOn').classList.add('hidden')")
        page.evaluate("() => document.querySelector('#joinModal').classList.remove('hidden')")
        page.fill("#joinUrl", "https://github.com/marci-dev/kozos-projekt")
        page.click("#btnJoinGo")
        page.wait_for_timeout(700)
        ok(page.locator("#projectList .p").count() == 2, "letrejott a masodik, csatlakoztatott projekt")
        ok("Csatlakozott projekt" in page.inner_text("#projName"), "a nevet a repobol vette: " + page.inner_text("#projName").strip())
        ok(page.inner_text("#ringLabel").strip() in ("45%", "45 %"), "a haladast is atvette (45%)")

        # ---------- fulek vegigkattintasa ----------
        for ful in ["overview", "notes", "editor", "preview", "share", "tools"]:
            page.click(f'.tb[data-tab="{ful}"]')
            page.wait_for_timeout(120)
        ok(True, "minden ful megnyilik")

        # ---------- beallitasok ----------
        page.click("#btnSettings")
        page.wait_for_timeout(150)
        ok(page.is_visible("#settingsModal"), "beallitasok megnyilik")
        ok(page.input_value("#sMeName") == "Bence", "a nevet a git configbol vette")
        page.fill("#sMeName", "Bence B.")
        page.click("#btnSaveSettings")
        page.wait_for_timeout(200)
        ok(page.inner_text("#meName").strip() == "Bence B.", "nevvaltas atmegy az oldalsavra")

        # ---------- vegso hibaellenorzes ----------
        sulyos2 = [t for t in naplo if t[0] == "pageerror" or (t[0] == "error" and "teszt-stub" not in t[1])]
        ok(not sulyos2, "a teljes vegigkattintas alatt sem volt JS-hiba"
           + (" — " + str(sulyos2[:3]) if sulyos2 else ""))

        page.click('#projectList .p')
        page.click('.tb[data-tab="overview"]')
        page.wait_for_timeout(400)
        page.screenshot(path="ui-attekintes.png")
        page.click('.tb[data-tab="share"]')
        page.wait_for_timeout(400)
        page.screenshot(path="ui-megosztas.png")
        page.click('.tb[data-tab="notes"]')
        page.wait_for_timeout(300)
        page.screenshot(path="ui-jegyzetek.png")
        b.close()

    print("===== EREDMENY =====")
    if not hibak:
        print("MINDEN UI-TESZT ATMENT")
    else:
        print("SIKERTELEN: %d" % len(hibak))
        for h in hibak:
            print("   - " + h)
    print("====================\n")
    sys.exit(1 if hibak else 0)

main()
