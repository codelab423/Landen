# 🌍 Landen

Een website voor de familie: iedereen logt in en vinkt de landen aan waar hij/zij geweest is.
Elk land kleurt op een gedetailleerde wereldkaart, en je verdient XP — hoe moeilijker het land, hoe meer XP.

*A family website to track which countries everyone has visited — with a detailed world map, XP, levels and a leaderboard. Dutch and English.*

## Wat zit erin

- **Accounts** met e-mail + wachtwoord (veilig gehasht). Je blijft 60 dagen ingelogd.
- **Wereldkaart** (hoge detail, 1:10m Natural Earth) met zoomen/slepen. Bezochte landen krijgen jouw kleur,
  wensenlijst-landen worden gestreept. Kleine landen (Vaticaanstad, Nauru, …) zijn klikbare rondjes.
- **Moeilijkheid-weergave**: de kaart kleurt alle landen op tier.
- **Alle 195 landen** (193 VN-leden + Vaticaanstad + Palestina), gerangschikt in 5 tiers vanuit Nederland:

  | Tier | Naam | XP | Voorbeelden |
  | --- | --- | --- | --- |
  | 1 | Makkelijk | 50 | België, Duitsland, Spanje, Turkije |
  | 2 | Gemiddeld | 100 | IJsland, Marokko, Thailand, Suriname, VS |
  | 3 | Avontuurlijk | 200 | Japan, Peru, Kenia, Australië |
  | 4 | Uitdagend | 350 | Rusland, Mongolië, Bhutan, Fiji |
  | 5 | Legendarisch | 500 | Noord-Korea, Nauru, Tuvalu, Afghanistan |

  De lijst staat in [`public/countries.js`](public/countries.js) — pas gerust tiers aan.
- **Levels**: van *Thuisblijver* tot *Heeft Alles Gezien* (10 levels), met level-up meldingen.
- **Per land**: jaartal en notitie (optioneel).
- **Wensenlijst**: landen waar je nog heen wilt, met hoeveel XP ze opleveren.
- **Familie-ranglijst**: wie heeft de meeste XP. Iedereen ziet de scores, maar alleen zijn eigen kaart.
- **Host / beheer**: de **eerste** persoon die een account maakt wordt host. De host ziet alle accounts,
  alle landen en kan ieders kaart bekijken, wachtwoorden resetten, andere hosts maken en accounts verwijderen.
- **Nederlands en Engels** (knopje NL/EN rechtsboven).
- Werkt op telefoon en laptop.

## Lokaal draaien

Nodig: **Node.js 22.13 of nieuwer**.

```bash
npm install
npm start
# → http://localhost:3000
```

## Instellingen (environment variables)

| Variabele | Wat | Standaard |
| --- | --- | --- |
| `PORT` | Poort van de webserver | `3000` |
| `DATA_DIR` | Map waar de database (`landen.db`) staat | `./data` |
| `FAMILY_CODE` | Geheime code die nodig is om een account te maken. **Zet dit aan** als de site online staat, anders kan iedereen met de link zich aanmelden. | *(uit)* |
| `ADMIN_EMAIL` | Dit e-mailadres wordt bij aanmelden automatisch host | *(leeg)* |

## Online zetten (hosting)

De app is één Node.js-server met een SQLite-database in één bestand. Belangrijk: de host moet een
**blijvende schijf (volume)** hebben, anders ben je de data kwijt bij een herstart.

**Railway** (makkelijkst)
1. Maak een project → *Deploy from GitHub repo* → kies deze repo.
2. Voeg een **Volume** toe, mount path `/data`.
3. Variables: `DATA_DIR=/data` en `FAMILY_CODE=<jullie code>`.
4. Onder *Networking* → *Generate domain*. Klaar.

**Fly.io / eigen server / NAS** — er zit een `Dockerfile` bij:

```bash
docker build -t landen .
docker run -d -p 3000:3000 -v landen-data:/data -e FAMILY_CODE=geheim landen
```

> Let op: Render's gratis plan heeft géén blijvende schijf — daar verdwijnt de data.

**Backup**: kopieer gewoon `landen.db` uit de data-map.

## Techniek

- Backend: Express + `node:sqlite` (ingebouwd in Node), scrypt-wachtwoorden, sessie-cookies (HttpOnly).
- Frontend: geen build-stap; vanilla JS + d3 (kaart) + topojson + world-atlas + flag-icons.
