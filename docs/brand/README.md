# Kinora: Logo

Das Logo heisst **Blende**. Es ist ein K, aus der runden Blende eines Projektors geschnitten. Der Lichtkegel zwischen den Armen nimmt in der App die Farbe des aktuellen Films an.

Die Präsentation mit Anwendungsbeispielen liegt in [presentation/board.html](presentation/board.html).

## Welche Datei wofür?

Alle Dateien liegen in [svg/](svg/) und enthalten reine Vektorformen ohne Schrift. Die Wortmarke ist in Umrisse umgewandelt.

| Version | Dateien | Einsatz |
| --- | --- | --- |
| Quer | `kinora-horizontal-*.svg` | Erste Wahl, wo genug Breite da ist |
| Gestapelt | `kinora-stacked-*.svg` | Quadratische oder hohe Flächen |
| Symbol | `kinora-symbol-*.svg` | Ab 24 px, wo der Name schon danebensteht |
| Symbol klein | `kinora-symbol-small-*.svg` | 16 bis 24 px |
| Wortmarke | `kinora-wordmark-*.svg` | Wo das Symbol nicht passt oder schon vorkommt |

Die Endung sagt, wofür die Datei gedacht ist:

| Endung | Grund | Farben |
| --- | --- | --- |
| `-dark` | Dunkel, der Normalfall in Kinora | Leinwand und Glühfaden |
| `-light` | Hell | Tinte und Glühfaden tief |
| `-white` | Dunkel oder farbig, wenn nur eine Farbe geht | Weiss |
| `-black` | Hell, wenn nur eine Farbe geht | Schwarz |

Die Fassung `-dark` ist minimal dünner gezeichnet als `-light`, weil helle Flächen auf dunklem Grund grösser wirken. Darum die beiden nicht einfach umfärben.

Fertige Icons liegen in [icons/](icons/): Favicon als ICO, SVG und PNG, Apple-Touch-Icon, App-Icons mit 192 und 512 px und ein Maskable-Icon für Android.

## In der App

| Ort | Datei |
| --- | --- |
| Kopfzeile, Fusszeile, Anmeldeseiten | `src/components/brand/logo.tsx` |
| Browser-Tab | `src/app/icon.svg`, `src/app/favicon.ico` |
| Home-Bildschirm auf iOS | `src/app/apple-icon.png` |

In `logo.tsx` folgt der Lichtkegel der CSS-Variable `--ambient`, also dem aktuellen Film. Ohne Film leuchtet er im Glühfaden-Ton. Die Grösse setzt du über die Schriftgrösse, zum Beispiel `<Logo className="text-[1.2rem]" />`. So bleiben die Verhältnisse immer gleich.

## Schutzraum

Halte rund um das Logo mindestens **die Höhe des K im Schriftzug** frei, beim Symbol allein **einen Viertel seines Durchmessers**. Der Abstand wächst mit dem Logo.

## Mindestgrössen

| Version | Bildschirm | Druck |
| --- | --- | --- |
| Quer | 96 px breit | 25 mm breit |
| Gestapelt | 48 px breit | 15 mm breit |
| Symbol | 24 px | 8 mm |
| Symbol klein | 16 px | 5 mm |

## Farben

| Name | HEX | RGB | CMYK (Näherung) | Rolle |
| --- | --- | --- | --- | --- |
| Tinte | `#0e0c12` | 14, 12, 18 | 22, 33, 0, 93 | Dunkler Grund, Zeichen auf hellem Grund |
| Leinwand | `#f3efe8` | 243, 239, 232 | 0, 2, 5, 5 | Zeichen auf dunklem Grund |
| Glühfaden | `#f2be7e` | 242, 190, 126 | 0, 21, 48, 5 | Lichtkegel auf dunklem Grund |
| Glühfaden tief | `#b86f14` | 184, 111, 20 | 0, 40, 89, 28 | Lichtkegel auf hellem Grund |

Kontraste: Leinwand auf Tinte 17:1, Glühfaden auf Tinte 11,5:1, Glühfaden tief auf Weiss 3,95:1. Die CMYK-Werte sind rechnerisch umgesetzt. Prüfe sie vor einem Druck mit einem Andruck. Pantone-Farben sind nicht festgelegt.

Nur der Lichtkegel darf die Farbe wechseln. Das K bleibt immer Leinwand oder Tinte.

## Schrift

Titel und Wortmarke stehen in **Mona Sans**, Schnitt 600, Breite 112 %, Laufweite -0,02 em. Für Fliesstext gilt Mona Sans in normaler Breite. Die Schrift steht unter der SIL Open Font License und ist über `@fontsource-variable/mona-sans` eingebunden.

## Bitte nicht

- Das Logo verzerren, drehen oder spiegeln
- Den Lichtkegel weglassen oder das K einfärben
- Schatten, Verläufe oder Konturen hinzufügen
- Symbol und Schriftzug neu anordnen oder ihre Grössen ändern
- Den Schriftzug neu tippen: In SVG-Dateien immer die Umrisse verwenden
- Das Logo direkt auf eine unruhige Bildstelle setzen

## Aufbau des Zeichens

Alle Formen liegen auf einem Kreis. Die Arme gehen unter 30° und 60° von einer Nabe im Stamm ab, der Keil zwischen ihnen misst damit 60°. Der Lichtkegel misst 30°, also genau die Hälfte. Einzig die Fassung für kleine Grössen weicht ab: Die Arme sind tiefer verankert, die Schlitze breiter und der Lichtkegel misst 45°, sonst würde das K in 16 px zerfallen.

## Stand der Prüfung

Geprüft sind die Lesbarkeit in echten 16, 24 und 32 px, helle und dunkle Gründe, die einfarbigen Versionen und der Lichtkegel in mehreren Filmfarben. Das Audit der SVG-Dateien meldet beim Symbol keine Mängel. Beim Schriftzug weist es auf fast runde Winkel im K hin. Sie stammen aus der Schrift und sind gewollt.

**Noch offen:**

- Eine Markenrecherche ist nicht gemacht. Sie ist vor einer öffentlichen Nutzung sinnvoll, auch für den Namen Kinora.
- Die Formen liegen als Volltonflächen vor. Für Schneideplotter oder Stickerei lohnt sich eine Prüfung in einem Vektorprogramm.
