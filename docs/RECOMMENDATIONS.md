# Empfehlungs-Engine

Klassischer, deterministischer Ansatz ohne LLM: gleiche Daten, gleiche Reihenfolge. Der Code liegt in [src/server/recommender](../src/server/recommender).

## Ablauf

1. **Signale** (`signals.ts`, `profile.ts`): Jeder Titel der Bibliothek erhält ein Gewicht von -1 bis +1.
2. **Profil** (`profile.ts`): Daraus entstehen Affinitäten zu Genres, Keywords, Personen, Jahrzehnten und Filmreihen.
3. **Kandidaten** (`sources.ts`): Mehrere Quellen liefern Titel samt Herkunft.
4. **Scoring** (`scoring.ts`): Acht normierte Signale ergeben einen Score.
5. **Diversität** (`ranking.ts`): MMR verhindert zehn fast gleiche Titel nebeneinander.
6. **Begründung** (`explain.ts`): Texte entstehen nur aus vorhandenen Signalen.
7. **Reihen** (`sections.ts`): Jeder Titel erscheint nur einmal. Reicht es nicht, entfällt die Reihe.
8. **Speichern** (`service.ts`): Ergebnis samt Aufschlüsselung in `recommendation_cache`.

## Gewichte

| Signal | Gewicht | Berechnung |
| --- | --- | --- |
| Ähnlichkeit zu hoch bewerteten Titeln | 30 % | Jaccard über Genres, Keywords, Besetzung und Regie, die drei nächsten Seeds |
| Genre | 20 % | Mittlere Affinität, ohne Datenlage neutral 0,5 |
| TMDB-Empfehlungen | 15 % | Gewichtet mit Listenplatz und Stärke des Seeds, gesättigt |
| Besetzung | 10 % | Summe positiver Affinitäten, gesättigt |
| Regie und Crew | 10 % | Summe positiver Affinitäten, gesättigt |
| Keywords | 5 % | Mittel der fünf stärksten |
| Qualität | 5 % | 80 % Bayes-Bewertung, 20 % logarithmische Popularität |
| Neuheit | 5 % | Erscheinungsjahr und geringe Bekanntheit |

Die Werte stehen in `DEFAULT_WEIGHTS`. Pro Nutzer lassen sie sich über `user_preferences.recommendationWeights` überschreiben und werden danach neu normiert. Eine Oberfläche dafür gibt es bewusst noch nicht.

Abgelehnte Titel wirken als Abzug: Der Score wird mit `1 - penalty` multipliziert, wobei `penalty` höchstens 0,6 erreicht.

## Schutz vor Verzerrungen

- **Viele Metadaten:** Jaccard normiert auf die Grösse der Mengen. Bei Keywords zählen nur die fünf stärksten, sodass lange Listen weder helfen noch schaden.
- **Popularität:** Fliesst logarithmisch und nur zu 1 % des Gesamtscores ein (20 % von 5 %).
- **Wenige Stimmen:** Bayes-Mittel mit `m = 500` und `C = 6,6`. Ein Film mit 10,0 aus drei Stimmen landet nahe beim Mittel.
- **Dünne Evidenz:** Affinitäten erhalten Pseudo-Beobachtungen, ein einzelner Film macht also niemanden zum Genre-Fan.
- **Alte Signale:** Halbwertszeit drei Jahre, jedoch nie unter 60 %.

## Signalgewichte

Ausdrückliche Aussagen schlagen implizite Interaktionen. Gesehen heisst nicht gemocht: Ohne Bewertung bleibt das Gewicht so klein, dass der Titel nicht als Vorbild für Empfehlungen dient (Schwelle 0,15).

| Ereignis | Gewicht |
| --- | --- |
| Bewertung 9 bis 10 | 0,8 bis 1 (stark positiv) |
| Bewertung 7 bis 8,5 | 0,4 bis 0,66 (positiv) |
| Bewertung 5 bis 6,5 | 0 bis 0,11 (neutral bis leicht positiv) |
| Bewertung 1 bis 4,5 | -1 bis -0,25 (negativ) |
| Favorit | mindestens 0,8 |
| Nicht interessiert oder links gewischt, ohne Bewertung | -0,5 |
| Serie abgeschlossen, ohne Bewertung | 0,25 |
| Serie läuft, ohne Bewertung | 0,15 (pausiert 0,05) |
| Auf der Watchlist oder rechts gewischt, ohne Bewertung | 0,15 |
| Gesehen, ohne Bewertung | 0,1 |
| Wiederholtes Ansehen | je +0,1, höchstens +0,2, nicht bei einer Bewertung unter 5 |

Pro Titel zählt nur die letzte Swipe-Entscheidung, Watchlist und Rechtswischen zählen nicht doppelt. Detailseitenaufrufe sind kein Signal. Eine zurückgenommene Ablehnung wirkt sofort, auch wenn der alte Swipe noch gespeichert ist.

## Kandidatenquellen

| Quelle | Inhalt |
| --- | --- |
| `seed_recommendations` | TMDB-Empfehlungen und ähnliche Titel der acht stärksten Seeds |
| `genre_discover` | Gut bewertete Titel der Lieblingsgenres |
| `people_credits` | Weitere Arbeiten von Personen mit mindestens zwei Belegen |
| `collection_parts` | Weitere Teile begonnener Filmreihen |
| `trending` | Aktuelle Trends |
| `hidden_gems` | Wenige Stimmen, hohe Bewertung, passendes Genre |
| `nostalgia` | Mindestens 20 Jahre alt, gut bewertet |
| `new_genres` | Starke Filme aus Genres, die im Profil kaum vorkommen |

Zuerst werden alle Kandidaten grob anhand der Listendaten bewertet, danach holt die Engine für die besten 140 vollständige Merkmale (je eine gecachte Anfrage).

## Begründungen

Jede Regel prüft einen Beleg:

| Aussage | Bedingung |
| --- | --- |
| «Weil du X mit 9/10 bewertet hast.» | X ist ein Seed mit Bewertung, die Ähnlichkeit erreicht mindestens 0,12 oder TMDB empfiehlt den Titel direkt zu X |
| «Weil du X und Y hoch bewertet hast.» | Dasselbe für mehrere Seeds |
| «Passt zu deinen Lieblingsgenres Fantasy und Abenteuer.» | Affinität mindestens 0,12, gestützt durch mindestens zwei Titel |
| «Mit Daniel Radcliffe aus deinen Lieblingstiteln.» | Affinität mindestens 0,2, mindestens zwei Titel |
| «Aus einer Reihe, die du begonnen hast.» | Ein Teil der Reihe ist ein Seed |

Ohne Beleg bleibt die Begründung leer, und der Titel erscheint ohne Erklärung.

## Swipe-Modus

Der Modus nutzt denselben Kandidatenpool (`buildCandidatePool`) und dasselbe Scoring wie die Startseite. Modi unterscheiden sich nur in Quellen, Gewichten und Auswahl:

| Modus | Quellen | Auswahl |
| --- | --- | --- |
| Für dich | Alle Quellen, dazu gefiltertes Discover | Profilgewichte, etwa 15 % Entdeckungen |
| Überrasch mich | Neue Genres, verborgene Titel, Trends, Discover nach wenigen Stimmen | Mehr Qualität und Neuheit, etwa 45 % Entdeckungen, höchstens ein Teil pro Reihe |
| Top bewertet | TMDB-Bestenlisten, Discover ab 2000 Stimmen | Qualität zählt am stärksten |
| Verborgene Schätze | Discover mit 150 bis 3000 Stimmen und mindestens 7 Punkten | Bayes-Bewertung sichert kleine Stichproben ab |
| Filmreihen entdecken | Reihen, die sich aus dem Pool ergeben | Nur nicht begonnene Reihen, Teile in Veröffentlichungsreihenfolge. Eine Ablehnung überspringt den Rest der Reihe |

Gesehenes und Vorgemerktes bleiben standardmässig draussen, beides lässt sich in den Filtern zulassen. Abgelehntes bleibt immer draussen, bis es im Profil zurückgesetzt wird. Filter, die ein Titel mangels Angabe nicht belegen kann, gelten als nicht erfüllt.

Während einer Session verschieben Entscheidungen die offenen Karten: Ein Genre, das oft gemocht wird, rückt nach vorne, ein abgelehntes nach hinten. Jede Entscheidung zählt gedämpft, Entdeckungen behalten ihren Platz, und höchstens drei Karten desselben Hauptgenres folgen aufeinander. Horror verschwindet also nach zwei Absagen nicht, kommt aber später.

Dauerhaft fliessen Swipes über die Signalgewichte oben in das Profil ein.

## Aktualität

Eine Änderung an den Signalen setzt `dirtyAt` und legt einen entprellten Job an. Der Worker rechnet in der Regel innerhalb weniger Sekunden neu. Ruft jemand die Startseite früher auf, rechnet die Anfrage selbst, höchstens 5 Sekunden lang, und zeigt notfalls den letzten Stand. Ohne vorhandene Ergebnisse wartet sie bis zu 25 Sekunden. Einträge gelten 24 Stunden, weil sich Trends ändern.

## Erweiterungen

Neue Verfahren lassen sich ohne Umbau ergänzen:

- **Collaborative Filtering oder Embeddings als Kandidatenquelle:** ein weiterer Eintrag in `CANDIDATE_SOURCES`.
- **Als Scoring-Signal:** ein weiteres Feld in `SignalScores` und `DEFAULT_WEIGHTS`. Ranking und Reihen arbeiten nur mit dem Gesamtscore.
- **Eigene Begründung:** eine weitere Regel in `buildReasons`.
