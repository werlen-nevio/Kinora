# Kinora

Eine private, selbst gehostete Film- und Serienbibliothek: Watchlist, Filmtagebuch, Bewertungen in halben Punkten, Episodentracking, Statistiken, ein Swipe-Modus zum Entdecken und erklärbare Empfehlungen. Die Filmdaten kommen von [TMDB](https://www.themoviedb.org). Kinora spielt keine Filme ab und bietet keine Inhalte zum Streamen an.

<a href="https://www.themoviedb.org"><img src="public/tmdb-logo.svg" alt="TMDB" width="64"></a>

This product uses the TMDB API but is not endorsed or certified by TMDB.

## Inhalt

- [Schnellstart mit Docker](#schnellstart-mit-docker)
- [Entwicklung](#entwicklung)
- [Betrieb mit HTTPS](#betrieb-mit-https)
- [Konfiguration](#konfiguration)
- [Tests](#tests)
- [Aufbau](#aufbau)

## Schnellstart mit Docker

Voraussetzung: Docker mit Compose und ein [TMDB-Konto](https://www.themoviedb.org/settings/api) für den *API Read Access Token*.

```bash
cp .env.example .env
```

Trage in `.env` mindestens ein:

| Variable | Wert |
| --- | --- |
| `TMDB_READ_ACCESS_TOKEN` | API Read Access Token von TMDB |
| `BETTER_AUTH_SECRET` | Zufallswert, z. B. `openssl rand -base64 48` |
| `POSTGRES_PASSWORD` | Passwort der Datenbank |
| `BETTER_AUTH_URL` | Adresse, unter der Kinora erreichbar ist, z. B. `http://localhost:3000` |

Danach:

```bash
docker compose up -d --build
```

Compose startet die Datenbank, führt die Migrationen aus und startet danach die Anwendung. Sie läuft auf [http://localhost:3000](http://localhost:3000), die Daten liegen im Volume `postgres-data`.

Ist Port 3000 belegt, setze `KINORA_PORT` in der `.env`, und passe `BETTER_AUTH_URL` entsprechend an.

So gestartet ist Kinora nur auf diesem Rechner erreichbar. Für den Zugriff aus dem Netzwerk gibt es das Profil `proxy`, siehe [Betrieb mit HTTPS](#betrieb-mit-https).

Sind alle Konten angelegt, verhindert `ALLOW_SIGNUP=false` weitere Registrierungen.

### Das TMDB-Token prüfen

```bash
npm install
npm run tmdb:check
```

Das Skript prüft Token, Filmdetails, die Harry-Potter-Filmreihe, die kuratierten Universen, Serien, Personen und die Suche gegen die echte API.

### Aktualisieren

```bash
docker compose up -d --build
```

Neue Migrationen laufen dabei automatisch, bevor die Anwendung startet.

### Datensicherung

```bash
docker compose exec db pg_dump -U kinora kinora > kinora-backup.sql
```

## Entwicklung

Voraussetzung: Node.js ab 22.18.

```bash
npm install
cp .env.example .env              # Werte eintragen
docker compose up -d db           # nur die Datenbank
npx prisma migrate deploy
npm run dev
```

Ohne SMTP-Konfiguration erscheint der Link zum Zurücksetzen des Passworts im Server-Log.

## Betrieb mit HTTPS

`docker compose --profile proxy up -d --build` startet zusätzlich Nginx mit der Konfiguration aus [docker/nginx/kinora.conf.template](docker/nginx/kinora.conf.template). Nötig sind:

1. In der `.env`: `KINORA_DOMAIN=kino.example.ch` und `BETTER_AUTH_URL=https://kino.example.ch`.
2. Die Zertifikate `fullchain.pem` und `privkey.pem` in `docker/certs/`, oder ein anderer Pfad über `KINORA_CERT_DIR`, zum Beispiel von Let's Encrypt.

Mit einer `https://`-Adresse setzt Kinora die Session-Cookies automatisch als `Secure`.

Wichtig für das Rate Limiting: Kinora liest die Client-Adresse aus `X-Forwarded-For`. Der mitgelieferte Nginx überschreibt den Header. Ein anderer Proxy muss das genauso tun, sonst lässt sich das Limit umgehen. Deshalb bindet Compose die Anwendung fest an `127.0.0.1`: Sie darf nie ohne Proxy aus dem Netzwerk erreichbar sein.

## Konfiguration

Alle Variablen stehen mit Erklärung in [.env.example](.env.example).

| Variable | Pflicht | Zweck |
| --- | --- | --- |
| `TMDB_READ_ACCESS_TOKEN` | ja | Zugang zur TMDB-API, bleibt auf dem Server |
| `BETTER_AUTH_SECRET` | ja | Signiert Sessions |
| `BETTER_AUTH_URL` | ja | Öffentliche Adresse, zugleich erlaubte Origin |
| `DATABASE_URL` | ja | Nur ausserhalb von Docker; Compose setzt den Wert selbst |
| `POSTGRES_PASSWORD` | ja | Datenbankpasswort in Compose |
| `SMTP_*` | nein | E-Mail für das Zurücksetzen von Passwörtern. TLS ist Pflicht, ausser mit `SMTP_ALLOW_PLAINTEXT=true` |
| `LOG_RESET_LINKS` | nein | Ohne SMTP die Links ins Log schreiben. Wer die Logs lesen kann, kann dann Konten übernehmen |
| `ALLOW_SIGNUP` | nein | `false` schliesst die Registrierung |
| `TRUSTED_ORIGINS` | nein | Weitere erlaubte Origins |
| `DISABLE_WORKER` | nein | Hintergrundjobs in diesem Prozess abschalten |
| `KINORA_PORT`, `KINORA_DB_PORT` | nein | Lokale Ports in Compose |
| `KINORA_DOMAIN`, `KINORA_CERT_DIR` | nein | Domain und Zertifikate für das Profil `proxy` |

## Tests

```bash
npm run test:unit         # Logik: Scoring, Ranking, Statusregeln, TMDB-Client
npm run test:integration  # Echte PostgreSQL-Instanz, API-Routen, Datentrennung
npm run test:e2e          # Produktions-Build im Browser, inklusive Mobilansicht
npm run test:all          # Alles, dazu Typecheck und Lint
```

Für Integrations- und End-to-End-Tests ist kein Docker nötig: Sie starten eine eingebettete PostgreSQL-Instanz und den TMDB-Testserver aus [tests/mock-tmdb](tests/mock-tmdb). Dessen Daten existieren nur in den Tests. Die Anwendung erreicht ihn nur, wenn `TMDB_API_BASE_URL` ausdrücklich auf ihn zeigt.

Vor dem ersten End-to-End-Test: `npx playwright install chromium`.

## Aufbau

Die Architektur, der Datenfluss und die wichtigsten Entscheide stehen in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Die Empfehlungs-Engine ist in [docs/RECOMMENDATIONS.md](docs/RECOMMENDATIONS.md) beschrieben.

| Pfad | Inhalt |
| --- | --- |
| `src/app` | Seiten und API-Routen |
| `src/components` | Oberfläche |
| `src/server` | Geschäftslogik, nur serverseitig |
| `src/lib` | Gemeinsamer Code für Server und Client |
| `prisma` | Datenmodell und Migrationen |
| `tests` | Unit-, Integrations- und End-to-End-Tests |
| `docs/brand` | Logo, Icons und Nutzungsregeln |

## Rechtliches

Kinora nutzt die TMDB-API gemäss den [Nutzungsbedingungen](https://www.themoviedb.org/api-terms-of-use). Die Angaben zu Streaming-, Kauf- und Leihanbietern stammen von JustWatch und werden über TMDB bezogen.

`public/tmdb-logo.svg` stammt von Wikimedia Commons, weil die Logo-Seite von TMDB beim Erstellen automatisierte Abrufe ablehnte. Gleiche die Datei vor einer Veröffentlichung mit dem offiziellen Download unter [Logos & Attribution](https://www.themoviedb.org/about/logos-attribution) ab.
