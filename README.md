# Projekt Hub

Saját vezérlőpult a web-projektekhez: haladás, jegyzetek, beépített kódszerkesztő,
XAMPP-vezérlés, előnézet és Drive-feltöltés — mind egy ablakban.

---

## Telepítés (ha csak használni akarod)

Töltsd le a legfrissebb telepítőt a **Releases** oldalról:

- `Projekt-Hub-1.0.0-win-x64.exe` → telepítő, Start menü + asztali ikon
- `Projekt-Hub-1.0.0-win-x64-portable.exe` → telepítés nélkül, pendrive-ról is fut

A Windows SmartScreen kékre válthat, mert a fájl nincs aláírva (a kódaláíró tanúsítvány
évi több tízezer forint). **További információ → Futtatás mindenképp.**

---

## Telepítő készítése magadnak

Kell hozzá Node.js (LTS): https://nodejs.org

Dupla katt a **`Telepito-keszitese.bat`** fájlra — a végén a `dist` mappában
ott lesz a telepítő és a hordozható exe.

Parancssorból:

```
npm install
npm run dist
```

Fejlesztéshez, telepítő nélkül: `npm start` (vagy `Inditas.bat`).

---

## GitHub: hogy a laptopodra is egy kattintás legyen

Egyszeri beállítás:

Előbb dupla katt a **`Github-elokeszites.bat`** fájlra — ez teszi a helyére a
`.github\workflows\build.yml`-t (ez mondja meg a GitHubnak, hogyan építse az appot).

```
cd C:\Users\Bence\source\projekt-hub
git init
git add .
git commit -m "Projekt Hub 1.0"
git branch -M main
git remote add origin https://github.com/FELHASZNALONEVED/projekt-hub.git
git push -u origin main
```

(A repót előbb hozd létre a github.com-on — üresen, README nélkül.)

Innentől, ha új verziót akarsz kiadni:

```
git add .
git commit -m "mi valtozott"
git tag v1.0.1
git push && git push --tags
```

A `.github/workflows/build.yml` erre magától elindul: egy Windows gépen lefordítja
az appot, és felteszi a telepítőt a **Releases** oldalra. Kb. 5 perc, utána a laptopodon
csak letöltöd az `.exe`-t. Nem kell rajta se Node.js, se semmi.

Kézzel is indíthatod: GitHub → **Actions** → *Build* → *Run workflow*. Ilyenkor a kész
fájl a futás alján, az „Artifacts" résznél lesz.

> Fontos: a `package.json`-ban lévő `version` és a git tag maradjon szinkronban
> (`"version": "1.0.1"` → `git tag v1.0.1`).

---

## Beállítások (bal alul a ⚙️)

Az app első induláskor megpróbálja magától megtalálni ezeket, de nézd át:

| Mező | Mi ez |
|---|---|
| VSCodium futtatható fájl | pl. `C:\Users\Bence\AppData\Local\Programs\VSCodium\VSCodium.exe` |
| XAMPP mappa | általában `C:\xampp` |
| htdocs mappa | `C:\xampp\htdocs` |
| Google Drive mappa | a Drive for Desktop meghajtója, pl. `G:\My Drive` vagy `G:\Saját meghajtó` |

## Mit tud

**Áttekintés** — százalékos haladás (te állítod a csúszkával vagy a 0/25/50/75/100 gombokkal),
állapot, határidő visszaszámlálóval, leírás, és a legfontosabb nyitott teendők.

**Kód** — fájlfa + beépített VS Code-motoros szerkesztő (Monaco). Ctrl+S ment.
Gyors javításokhoz; komolyabb munkához a fenti **VSCodium** gomb megnyitja
a projektmappát a VSCodiumban.

**Jegyzetek** — ide írod fel, ha egy funkció kimaradt. Típus (teendő / ötlet / hiba /
kimaradt funkció) és prioritás. A nyitott elemek száma a fülön és a projektlistában is látszik.

**Előnézet** — az oldalad az appon belül nyílik meg, vissza/előre/frissítés gombokkal.
Három mód közül választhatsz a fenti legördülőben:

- **Automatikus** (alapértelmezett) — megnézi a projektet: ha talál `.php` fájlt, a megadott
  XAMPP-címet nyitja meg; ha csak HTML/CSS/JS van, a beépített szervert használja.
- **Beépített szerver** — az app saját mini webszervere szolgálja ki a projektmappát egy szabad
  localhost porton. Sima HTML oldalhoz **nem kell XAMPP**, nem kell a htdocs-ba másolni semmit.
- **Saját URL / XAMPP** — a megadott címet tölti be (PHP, adatbázis, vagy máshol futó szerver).

A phpMyAdmin is itt fut, nem külön ablakban.

**Eszközök** — Apache és MySQL indítása/leállítása, élő státusz (a 80-as és 3306-os port
figyelésével), XAMPP vezérlőpult, projektmappa, parancssor a projektben, Drive-műveletek, napló.

## Drive-feltöltés

A Drive for Desktop mappájába másol. A projekt **Drive almappa** mezője adja meg,
hova (pl. `Suli/Web/Portfolio`). A Drive kliens onnantól magától szinkronizál.

- A `node_modules`, `.git`, `vendor`, `dist`, `build` mappákat kihagyja.
- Másolás, nem tükrözés: a Drive-ból nem töröl semmit.
- A ⬆ Drive gomb az egész projektet viszi; az Eszközök fülön van
  „Kiválasztott fájlok a Drive-ra" is.

## Adatok két gép között

A projektek, százalékok és jegyzetek egy JSON fájlban vannak:
`%APPDATA%\Projekt Hub\projekt-hub-data.json`
(a pontos utat a Beállítások ablak alján kiírja).

A Beállításokban van **„Adatok mentése fájlba"** és **„Mentés betöltése"** — ha a
mentést a Drive mappádba teszed, a laptopon egy kattintással behúzod ugyanazokat
a projekteket. (Az elérési utak gépenként eltérhetnek, azokat ott át kell írni.)

## Ha valami nem megy

- **A XAMPP indító gomb nem csinál semmit** → indítsd az appot rendszergazdaként,
  vagy használd a XAMPP vezérlőpult gombot.
- **A VSCodium gomb hibát ír** → add meg kézzel az elérési utat a Beállításokban.
- **Az előnézet üres** → fut az Apache? (fent a pötty zöld?) Jó az URL?
- **A szerkesztő nem tölt be** (fejlesztői módban) → futtasd újra: `npm install`.
