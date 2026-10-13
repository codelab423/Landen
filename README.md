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
- **Badges**: 22 prestaties om vrij te spelen (Benelux, G7, alle werelddelen, heel Europa, …).
- **Familiekaart**: hoe meer familieleden in een land zijn geweest, hoe donkerder het land. De host ziet ook wíe.
- **🎲 Verras me**: kiest een willekeurig land waar je nog niet bent geweest (wensenlijst-landen vaker).
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
| `DATABASE_URL` | Postgres-verbinding (bv. van Neon). Als dit leeg is, gebruikt de app een lokaal SQLite-bestand. | *(leeg)* |
| `DATA_DIR` | Map voor het SQLite-bestand (`landen.db`), alleen zonder `DATABASE_URL` | `./data` |
| `FAMILY_CODE` | Geheime code die nodig is om een account te maken. **Zet dit aan** als de site online staat, anders kan iedereen met de link zich aanmelden. | *(uit)* |
| `ADMIN_EMAIL` | Dit e-mailadres wordt bij aanmelden automatisch host | *(leeg)* |

## Gratis online zetten: Render + Neon

Render draait de website gratis, Neon bewaart de data gratis (Render's gratis schijf wordt bij elke herstart gewist,
daarom staat de data in Neon).

**1. Database maken bij Neon**
1. Ga naar [neon.com](https://neon.com) en maak een gratis account (inloggen met GitHub kan).
2. Maak een project, regio **Europe (Frankfurt)**.
3. Klik op **Connect** en kopieer de *connection string* (begint met `postgresql://…`).

**2. Website op Render**
1. Ga naar [render.com](https://render.com) en log in met GitHub.
2. **New → Blueprint** → kies de repo `Landen`. Render leest `render.yaml` en maakt een gratis web service.
3. Vul in als erom gevraagd wordt:
   - `DATABASE_URL` = de connection string van Neon
   - `FAMILY_CODE` = jullie geheime familiecode
4. Klik **Apply**. Na een paar minuten krijg je een link zoals `https://landen-xxxx.onrender.com`.
5. Open de link en **maak als eerste je eigen account** — dan ben jij de host.

**Goed om te weten**
- Op het gratis plan valt de website na 15 minuten zonder bezoekers in slaap. De eerstvolgende bezoeker wacht
  dan ongeveer een minuut. Wil je dat niet: maak een gratis taak op [cron-job.org](https://cron-job.org) die elke
  10 minuten `https://<jouw-link>/healthz` opent. Het gratis plan heeft 750 uur per maand, genoeg om 24/7 aan te staan.
- Nieuwe versies van de code (push naar `main`) worden automatisch online gezet.

## Zelf hosten (eigen pc, NAS, Raspberry Pi)

Zonder `DATABASE_URL` slaat de app alles op in één SQLite-bestand. Er zit een `Dockerfile` bij:

```bash
docker build -t landen .
docker run -d -p 3000:3000 -v landen-data:/data -e FAMILY_CODE=geheim landen
```

**Backup**: kopieer `landen.db` uit de data-map (of maak een backup in Neon).

## Techniek

- Backend: Express + Postgres (`pg`) of `node:sqlite`, scrypt-wachtwoorden, sessie-cookies (HttpOnly).
- Frontend: geen build-stap; vanilla JS + d3 (kaart) + topojson + world-atlas + flag-icons.
