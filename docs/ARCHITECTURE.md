# Kinora: Architektur

Kinora ist eine selbst gehostete, private Film- und Serienbibliothek. Filme werden nicht gehostet oder abgespielt. TMDB liefert Metadaten, alles Persönliche liegt in der eigenen PostgreSQL-Datenbank.

## Schichten

```
Browser
  │  React Server Components (Seiten), Client Components (Interaktion)
  │  TanStack Query hält den Bibliothekszustand für optimistische Updates
  ▼
src/app            Routen, Layouts, Route Handler (dünn: Validierung, Autorisierung)
  ▼
src/server         Geschäftslogik, nur serverseitig
  ├─ auth/         Better Auth, Session-Helfer
  ├─ http/         API-Wrapper: Session, Origin-Prüfung, Zod, Fehlerabbildung
  ├─ tmdb/         TMDB-Client (Cache, Retry, Rate Limit), Endpunkte, Normalisierung
  ├─ library/      Sehstatus, Watchlist, Bewertungen, Episoden
  ├─ diary/        Filmtagebuch: Sehvorgänge mit Datum, Bewertung und Notiz
  ├─ discovery/    Swipe-Modus: Sessions, Auswahl, Rückgängig
  ├─ recommender/  Empfehlungs-Engine
  ├─ home/         Zusammenstellung der Startseitenreihen
  ├─ stats/        Persönliche Statistiken
  ├─ jobs/         Job-Queue auf PostgreSQL und Worker
  └─ mail/         SMTP-Versand
  ▼
PostgreSQL (Prisma)               TMDB API v3 (nur vom Server aus)
```

Pure Logik liegt getrennt von I/O, damit sie ohne Datenbank testbar ist:

| Modul | Inhalt |
| --- | --- |
| `src/lib/library-transitions.ts` | Regeln für widerspruchsfreie Statusänderungen |
| `src/lib/series-progress.ts` | Episodenfortschritt, ausgestrahlte Folgen, nächste Folge |
| `src/server/recommender/scoring.ts` | Signale und gewichteter Score |
| `src/server/recommender/profile.ts` | Geschmacksprofil aus Nutzersignalen |
| `src/server/recommender/ranking.ts` | MMR-Diversität, Begrenzungen |
| `src/server/recommender/explain.ts` | Begründungen aus echten Signalen |
| `src/lib/diary.ts` | Tagebuchregeln, Gesamtbewertung, Gruppieren, Filtern, Kalender |
| `src/lib/discovery.ts` | Filter und Modi des Swipe-Modus |
| `src/server/discovery/selection.ts` | Session zusammenstellen, Reihenfolge anpassen |

## Datenfluss

### Lesen

Seiten sind Server Components. Sie lesen TMDB über `src/server/tmdb/api.ts` und streamen langsame Reihen über `Suspense`. Der persönliche Status wird nicht in jede Karte gerendert: Das App-Layout lädt einmal die kompakte Bibliothek des Nutzers (`getLibraryState`) und gibt sie als `initialData` an TanStack Query. Jede Karte liest ihren Status daraus. Dadurch stimmt eine Änderung sofort überall auf der Seite.

### Schreiben

`POST /api/library` nimmt eine Aktion entgegen (per Zod als Discriminated Union validiert), `src/server/library/service.ts` führt sie in einer Transaktion aus, protokolliert die Interaktion und markiert die Empfehlungen als veraltet. Der Client aktualisiert optimistisch und rollt bei einem Fehler zurück.

### TMDB-Cache

Zwei Stufen mit Single-Flight: In-Memory-LRU, darunter die Tabelle `tmdb_cache`. Jeder Endpunkt hat eine eigene TTL und ein Stale-Fenster. Abgelaufene Einträge werden sofort ausgeliefert und im Hintergrund erneuert; fällt TMDB aus, bleiben sie bis zum Ende des Fensters nutzbar. Der Client begrenzt Rate und Parallelität, wiederholt 429 und 5xx mit Backoff und respektiert `Retry-After`.

### Empfehlungen

```
Nutzersignale ─▶ Geschmacksprofil ─┐
                                   ├─▶ Scoring ─▶ MMR-Diversität ─▶ Begründungen ─▶ recommendation_cache
Kandidatenquellen ─▶ Features ─────┘
```

Kandidatenquellen und Signale sind als Listen registriert (`sources.ts`, `scoring.ts`). Collaborative Filtering oder Embeddings lassen sich später als weitere Quelle und als weiteres Signal ergänzen, ohne Ranking oder Reihen anzufassen.

Eine Änderung an den Signalen setzt `dirtyAt` und legt einen entprellten Job an. Der Worker läuft im App-Prozess (`src/instrumentation.ts`). Lädt jemand die Startseite, bevor der Job fertig ist, wird in der Anfrage neu berechnet, mit Zeitlimit und Rückfall auf den letzten Stand. Die Reihen bleiben auch ohne Worker aktuell.

### Filmtagebuch

`watch_diary_entries` ist die einzige Quelle für Sehvorgänge. `user_media.watched`, `watchCount` und `lastWatchedAt` sind daraus abgeleitet und werden in derselben Transaktion nachgeführt, damit Tagebuch, Watchlist und Sehstatus nie auseinanderlaufen.

Zwei Bewertungen bedeuten Verschiedenes: `watch_diary_entries.rating` hält fest, wie es bei diesem Sehvorgang war, `ratings.value` ist die heutige Meinung. Nur der jüngste bewertete Sehvorgang bewegt die Gesamtbewertung (`resolveOverallRating`). Ein Eintrag ohne Datum gilt dabei als der älteste. Wer einen Film mit Datum von 2010 nachträgt, ändert also nicht, was die Person heute denkt.

Das Sehdatum ist Ortszeit der Person und wird unverändert als UTC abgelegt (`combineWatchedAt`), die Anzeige liest es in UTC zurück. So bleibt der Tag erhalten, egal in welcher Zeitzone jemand die Seite später öffnet. Ein fehlendes Datum ist immer `NULL`; nur die Oberfläche schlägt das heutige Datum vor, und gespeichert wird es erst nach einer Bestätigung.

Ein Häkchen an einer einzelnen Episode speichert weiterhin den Klickzeitpunkt, weil das Abhaken gerade Gesehenes beschreibt. Ganze Serien und Staffeln, die nachträglich markiert werden, speichern `NULL`.

### Swipe-Modus

```
Modus + Filter ─▶ Quellen und Gewichte ─▶ buildCandidatePool ─▶ selectSessionItems ─▶ discovery_session_items
                                          (geteilt mit der Startseite)
Swipe ─▶ Bibliotheksaktion ─▶ media_swipe_interactions ─▶ Reihenfolge anpassen ─▶ dirtyAt für Empfehlungen
```

- **Eine aktive Session pro Person**, abgesichert durch einen Partial Unique Index. Jede Karte speichert ihre Anzeigedaten als JSON: Die Warteschlange braucht beim Weitermachen keinen TMDB-Aufruf, und die Session überlebt jede Navigation.
- **Media-Einträge entstehen schlank** und mit altem `fetchedAt`. Den vollen Snapshot samt Besetzung holt erst die erste Aktion über `ensureMedia`, damit eine Session nicht 30 Detailabrufe in die Datenbank schreibt.
- **Der Client wartet nicht.** Die Karte fliegt sofort weg, Anfragen laufen strikt nacheinander. Das hält auch sehr schnelles Wischen und Rückgängig eindeutig. Ein doppelt gesendeter Swipe beansprucht die Karte nur einmal.
- **Rückgängig stellt genau wieder her, was der Swipe verändert hat.** In `discovery_session_items.effect` stehen der Stand davor und danach, der angelegte Tagebucheintrag, Episodenstand samt Serienstatus und übersprungene Teile einer Reihe. Was seit dem Swipe anders ist als «danach», hat jemand bewusst geändert und bleibt, etwa ein später erfasster Sehvorgang.
- **Der Ausgangsstand wird gespeichert, bevor etwas passiert.** Die Karte wird zuerst beansprucht, samt Ausgangsstand. Scheitert die Aktion, geht die Karte zurück in den Stapel. Scheitert danach nur noch die Buchführung, gilt der Swipe trotzdem, denn die Aktion ist gespeichert und Rückgängig bleibt möglich.
- **Anderswo entschiedene Karten verschwinden.** Wer auf der Detailseite ablehnt, als gesehen markiert oder vormerkt, sieht den Titel nicht mehr als Karte, soweit die Filter der Session das verlangen.
- **Die Reihenfolge passt sich an** (`adaptPendingOrder`), immer vom Startplatz aus. Sie hängt also nur von den bisherigen Entscheidungen ab, schaukelt sich nicht auf und lässt sich zurücknehmen. Die drei sichtbaren Karten und die Entdeckungen bleiben auf ihrem Platz.

## Entscheidungen

| Thema | Entscheid | Begründung |
| --- | --- | --- |
| Authentifizierung | Better Auth | Auth.js ist im Wartungsmodus. Better Auth bringt widerrufbare DB-Sessions, Rate Limiting und Account-Löschung mit |
| Paketmanager | npm | pnpm-Symlinks und `output: standalone` vertragen sich unter Windows schlecht |
| TMDB-Snapshot | Schmale Spalten in `media` | Filter und Statistiken der Bibliothek brauchen sonst pro Titel einen API-Aufruf |
| Bilder | `next/image` mit TMDB-Loader | Das TMDB-CDN liefert passende Grössen; der eigene Server muss nichts umrechnen |
| Hintergrundjobs | Eigene Tabelle mit `FOR UPDATE SKIP LOCKED` | Kein Redis nötig; läuft mit der vorhandenen Datenbank |
| Sehdatum | `watchedAt` ist nullable | Eine Aussage wie «2026 gesehen» darf nur auf erfassten Zeitpunkten beruhen |
| Bewertungen | Halbe Punkte als `Float`, per CHECK auf 19 Stufen begrenzt | Eine Dezimalzahl wäre für 19 feste Werte zu viel, die Datenbank schliesst alles andere aus |
| Altdaten | `watch_history` geht in `watch_diary_entries` auf | Zwei Tabellen für denselben Sachverhalt könnten sich widersprechen. Die Migration übernimmt alle Zeilen und löscht die alte Tabelle erst danach |
| Discovery-Engine | Teilt den Kandidatenpool mit der Startseite | Zwei Scoring-Wege würden auseinanderlaufen. Modi ändern nur Quellen, Gewichte und Auswahl |
| Seiten | Dynamisch gerendert | Die Inhalte sind personalisiert, und die CSP nutzt pro Anfrage einen Nonce |

## Statusregeln

Festgelegt in `library-transitions.ts`, unit-getestet:

- Film als gesehen markieren entfernt ihn von der Watchlist und hebt «Nicht interessiert» auf.
- Bewerten oder Favorisieren eines Films markiert ihn als gesehen (Datum unbekannt).
- «Gesehen» entfernen löscht Sehvorgänge, Bewertung und Favorit des Titels. Die Oberfläche fragt vorher nach.
- Der letzte Tagebucheintrag eines Films ist sein Sehstatus: Wird er gelöscht, gilt der Film nicht mehr als gesehen.
- Ein neuer Sehvorgang nimmt den Titel von der Watchlist und hebt «Nicht interessiert» auf.
- Watchlist und «Nicht interessiert» schliessen sich gegenseitig aus. «Nicht interessiert» entfernt auch einen Favoriten.
- Ein gesehener Film darf wieder auf die Watchlist (Wiederholung geplant).
- Serienstatus wird aus den Episoden abgeleitet. `PAUSED` bleibt bestehen, bis eine weitere Episode gesehen wird.
- Noch nicht ausgestrahlte Folgen zählen nie als offen und lassen sich nicht als gesehen markieren.

## Sicherheit

- Alle Bibliothekszugriffe filtern nach der `userId` der Session; es gibt keine API, die eine fremde `userId` annimmt. Das gilt auch für Tagebucheinträge und Discovery-Sessions: Eine fremde ID verhält sich wie eine, die es nicht gibt.
- Mutierende API-Routen prüfen den `Origin`-Header; Cookies sind `HttpOnly` und `SameSite=Lax`, in Produktion zusätzlich `Secure`.
- CSP mit Nonce pro Anfrage in `src/proxy.ts`.
- TMDB-Token und SMTP-Daten existieren nur serverseitig. Kein Client-Code importiert aus `src/server` (`server-only`).
- Avatare werden mit `sharp` neu kodiert. Das entfernt Metadaten und schliesst SVG-Skripte aus.
- Teure Routen haben Kontingente pro Nutzer (`src/server/http/rate-limit.ts`), und Request-Bodies werden mit Obergrenze gelesen.
- `/api/auth` lässt nur die genutzten Pfade durch. Das Rate Limiting von Better Auth legt pro Pfad einen Datensatz an.
- Das Löschen eines Kontos verlangt immer das Passwort, auch wenn die Session jung ist.

### Bekannte Grenzen

- Die Registrierung verrät, ob eine E-Mail schon ein Konto hat. Das folgt aus der automatischen Anmeldung ohne E-Mail-Bestätigung und ist für eine private Instanz vertretbar. `ALLOW_SIGNUP=false` schliesst den Weg ganz.
- Die Kontingente pro Nutzer liegen im Speicher und gelten pro Prozess. Bei mehreren App-Instanzen vervielfachen sie sich.
