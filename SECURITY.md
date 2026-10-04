# Sicherheit & Vertrauenshinweise

Copyright (c) 2026 Stefan Reibnegger (Vystra)

## Offizielle Builds

Nur diese Quellen sind offiziell:

- https://vystra.games
- https://github.com/Stefan2010byte/viscode-launcher/releases

Andere Websites, „Repacks“ oder weitergeleitete EXEs sind nicht von Stefan Reibnegger.

## Was diese öffentliche Quelle beweist

Du kannst selbst nachlesen:

- Fenster, Glas-Effekt, Bibliothek, lokale Scanner
- keine versteckte Payload in den hier liegenden Dateien
- die API-Verträge in [docs/](docs/README.md)

Die Verkaufsversion spricht mit einem privaten Backend. Login, Shop und
Wallet sind in **dieser** Code-Kopie absichtlich nicht als fertiger Server
enthalten. Die Doku beschreibt die Verträge für Mods und Integrationen.

## Fund einer Schwachstelle

Bitte **nicht** öffentlich exploit-bereit beschreiben, wenn sie den Live-Server
oder Nutzerkonten betrifft. Melden an den Kontakt auf https://vystra.games
bzw. die im Launcher genannte Support-Adresse.

## Windows SmartScreen

Eine unsignierte EXE kann SmartScreen auslösen, auch wenn der Code sauber ist.
Das liegt am fehlenden Authenticode-Zertifikat, nicht daran, dass der
Quelltext „nicht signiert“ wäre. Der Quelltext ist durch Copyright-Köpfe
und dieses Repository Stefan Reibnegger zugeordnet.
