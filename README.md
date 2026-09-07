# Projekt Hub

A webes projektjeid egy helyen: haladás, jegyzetek, beépített szerkesztő,
VSCodium- és XAMPP-indítás, Drive-feltöltés — és mostantól **közös projektek**,
ha a haverodnál is fent van az app.

---

## Indítás

**Ha csak használni akarod:** töltsd le a legfrissebb `Projekt-Hub-…-telepito.exe`-t
a **Releases** oldalról.

A Windows kék ablakkal fog rád szólni, mert a fájl nincs aláírva:
**További információ → Futtatás mindenképp.** Elég egyszer.

**Fejlesztéshez:** `Inditas.bat` (kell hozzá Node.js).
**Saját exe:** `App-keszitese.bat` → a `dist` mappába kerül.

---

## Közös projekt a haveroddal

Ha ketten dolgoztok ugyanazon, ugyanazokat a **jegyzeteket, teendőket és a
haladást** fogjátok látni, mindkettőtök gépén, magától frissülve.

### Hogyan

1. **Készíts egy üres repót GitHubon.** Csak a megosztásnak kell — lehet privát.
   Ne pipáld be az „Add a README file"-t.
2. A projekt **Megosztás** fülén illeszd be a repó linkjét, és nyomd meg a
   *Megosztás bekapcsolása* gombot.
3. GitHubon **Settings → Collaborators**, add hozzá a haverodat.
4. Ő a saját Projekt Hubjában a **Csatlakozás közös projekthez** gombbal
   beilleszti ugyanezt a linket.

Ennyi. Nem kell token, nem kell szerver, nem kell regisztrálni sehova — a gépeden
lévő gitet és a már bejelentkezett GitHub-fiókodat használja.

### Mit oszt meg és mit nem

| Megosztódik | Nem osztódik meg |
|---|---|
| jegyzetek, teendők, ki mit zárt le | **a projekt fájljai** |
| haladás, állapot, határidő, leírás | a beállításaid (XAMPP, Drive útvonalak) |
| ki mikor mit csinált | a többi projekted |

**A kódotok szándékosan marad ki.** Ha az app a projekted saját repóját
commitolgatná a háttérben, előbb-utóbb összeakadna a VSCodiumból végzett
munkáddal, és egy merge konfliktus közepén találnád magad anélkül, hogy kérted
volna. Ehelyett az app egy külön, pár kilobájtos repót kezel teljesen egyedül.
A kódhoz maradjon a szokásos git.

### Mi történik, ha egyszerre írtok

Nem vész el semmi. Minden jegyzet külön fájl a repóban, ezért két új jegyzet
soha nem ütközik. Ha ugyanazt a *mezőt* állítjátok (pl. mindketten a haladást),
a későbbi nyer — és látod, ki állította.

Ha törölsz egy jegyzetet közös projektben, az nem tűnik el nyomtalanul, hanem
töröltként megy át a másik gépre. Enélkül a haverod gépe visszahozná a saját
régi másolatából.

Az app magától szinkronizál: induláskor, ablakra váltáskor, változás után pár
másodperccel, és hárompercenként. A *Szinkron most* gombbal kézzel is tudod.

### Ha elakad

| Amit látsz | Mi a baj |
|---|---|
| „Nem találom a gitet" | telepítsd: git-scm.com |
| „A GitHub nem engedett be" | nyisd meg egyszer a repót VSCodiumból, hogy a Windows elmentse a belépési adatokat |
| „Nincs ilyen repó, vagy nincs hozzá jogod" | rossz a link, vagy a haverod még nem vett fel Collaboratornak |
| „Ez a repó még üres" | a haverod még nem kapcsolta be nála a megosztást |

---

## Mit tud még

**Áttekintés** — egy csíkban a haladás, az állapot, a határidő és a nyitott
teendők száma. A haladást csúszkával vagy a 0/25/50/75/100 gombokkal állítod.

**Jegyzetek** — teendő, ötlet, hiba, kimaradt funkció; fontosság szerint
rendezve. Közös projektnél látod, ki írta, és szűrhetsz emberre.

**Kód** — beépített VS Code-motoros szerkesztő gyors javításokhoz. Ctrl+S ment.

**Előnézet** — beépített szerver a sima HTML oldalakhoz (nem kell XAMPP), vagy
a saját URL, ha PHP van a projektben. Automatikus módban magától eldönti.

**Eszközök** — Apache és MySQL indítása/leállítása, phpMyAdmin, htdocs,
parancssor a projektben, Drive-feltöltés.

Az adataid itt vannak: `%APPDATA%\Projekt Hub\projekt-hub-data.json`
A közös projektek adatrepói: `%APPDATA%\Projekt Hub\megosztas\`

---

## Fejlesztéshez

```
npm install
npm start          # inditas
npm run teszt      # a megosztas-motor ontesztje (git kell hozza)
npm run dist       # telepito keszitese
```

A `teszt/megosztas.teszt.js` két „gépet" játszik el egy helyi repóval, GitHub
nélkül: ellenőrzi, hogy párhuzamos íráskor nem vész el jegyzet, hogy a törlés
átmegy, és hogy ütköző mezőnél a későbbi nyer. Ha hozzányúlsz a
`megosztas.js`-hez, ezt futtasd le.

A `teszt/ui.teszt.py` a felületet kattintja végig Chromiumban hamis
adatforrással (kell hozzá `pip install playwright`).

---

## Fájlok

| Fájl | Mi van benne |
|---|---|
| `main.js` | Electron főfolyamat: fájlkezelés, XAMPP, Drive, előnézet-szerver |
| `megosztas.js` | a közös projektek git-alapú szinkronja — a logika itt van |
| `preload.js` | a híd a felület és a főfolyamat között |
| `src/index.html` | a felület szerkezete |
| `src/styles.css` | a kinézet |
| `src/renderer.js` | a felület logikája |

---

## Új verzió kiadása

1. `GitHub-feltoltes.bat` — egyszeri beállítás.
2. Utána bármikor: `Frissites-feltoltese.bat` — emeli a verziószámot, feltölti,
   és a GitHub megépíti az új telepítőt a Releases oldalra.
