# Urban Explorer

Find, markér og gem forladte steder på et satellitkort.

## Funktioner

- Satellitkort (MapTiler Satellite via MapLibre GL JS) — tryk på kortet for at placere en pin
- Pins gemmes persistent pr. bruger med koordinater, rating (1-5 stjerner) og billeder
- "Åbn i Google Maps" i satellitvisning direkte fra en pin
- "Mine pins"-liste med redigering, sletning og centrering på kortet
- Mobilvenlig bundnavigation (Kort / Mine pins / Profil)
- Sikker login: Argon2id password-hashing, JWT-session i httpOnly cookie, AES-256-GCM kryptering af personfølsomme felter, login-lockout efter gentagne fejlforsøg
- Første gang appen startes, oprettes der automatisk en admin-konto via opsætningsguiden

## Kom i gang

### 1. Generér secrets

```powershell
scripts\generate-secrets.ps1
```

(eller `scripts/generate-secrets.sh` på Linux/Mac). Dette opretter en `.env`-fil med `DB_PASSWORD`, `JWT_SECRET` og `ENCRYPTION_KEY`.

### 2. Indsæt MapTiler API-nøgle

Opret en gratis konto på [cloud.maptiler.com](https://cloud.maptiler.com/), find din API-nøgle, og indsæt den i `.env`:

```
MAPTILER_KEY=din_rigtige_maptiler_key
```

### 3. Start appen

```
docker compose up -d
```

Appen kører nu på [http://localhost:3000](http://localhost:3000).

### 4. Første gang opsætning

Første gang du åbner appen, bliver du automatisk sendt til `/setup`, hvor du opretter den første konto. Denne konto oprettes altid som admin. Herefter er opsætningssiden lukket, og alle skal logge ind via `/login`.

## Arkitektur

- **Frontend/backend**: Next.js 15 (App Router) + TypeScript
- **Database**: PostgreSQL 16 med PostGIS (koordinater gemmes både som `latitude`/`longitude` og som `geography(point)`)
- **Billeder**: valideres på filtype (magic bytes, kun JPG/PNG/WebP) og størrelse (maks 8 MB), gemmes i en Docker volume (`uploads_data`) og serveres via en auth-gated API-rute, så kun ejeren af en pin kan se dens billeder
- **Auth**: samme mønster som appens søsterprojekter — Argon2id, JWT (`jose`), httpOnly + `SameSite=strict` cookie, DB-baseret rate limiting på login (5 forsøg, 15 minutters lås)

## Struktur

```
urban-explorer/
  docker-compose.yml
  db/init.sql              # databaseskema (users, pins, pin_images)
  scripts/                 # secret-generering
  app/                     # Next.js app
    src/lib/                # db, crypto, auth, uploads
    src/middleware.ts       # ruter kræver login pr. default
    src/app/                # sider + API-ruter
    src/components/         # MapView, PinModal, PinsList, nav mv.
```

## Miljøvariabler

Se `.env.example` for den fulde liste. Alle secrets læses fra miljøvariabler — ingen secrets er hardcodet i koden.
