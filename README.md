# Vystra Launcher — öffentliche Quelle

**Autor:** Stefan Reibnegger (Vystra)  
**Lizenz:** [Functional Source License 1.1](LICENSE) (FSL-1.1-ALv2) — nach zwei Jahren Apache 2.0  
**Offizielle Downloads:** [Releases (viscode-launcher)](https://github.com/Stefan2010byte/viscode-launcher) · [vystra.games](https://vystra.games)  
**API-Doku für Modder:** [docs/](docs/README.md)

Dieses Repository ist **source-available** unter FSL, nicht „Open Source“ im OSI-Sinn
(erst nach zwei Jahren wird es Apache 2.0).  
Du darfst den Code **lesen**, **lernen**, **ändern** und **Mods** bauen.  
Du darfst **keinen** konkurrierenden kommerziellen Launcher, Shop oder Klon verkaufen.

## Für die Modder-Community

Die API-Verträge sind wieder öffentlich, damit ihr Plugins, Themes, Tools und
Spiel-Brücken bauen könnt:

- [docs/README.md](docs/README.md) — Übersicht
- [docs/API-UEBERSICHT.md](docs/API-UEBERSICHT.md) — REST-Server
- [docs/API_LAUNCHER_KOMPLETT.md](docs/API_LAUNCHER_KOMPLETT.md) — Server + Fremdhosts + lokale IPC
- [docs/MODDING.md](docs/MODDING.md) — `window.viscode` (Renderer ↔ Hauptprozess)

Shop-Kauf, Wallet und Login sind in **dieser** Code-Kopie weiterhin nur als
Schnittstelle dokumentiert, nicht als fertiger Server zum Nachbauen.

## Warum das hier öffentlich ist

Viele Windows-Nutzer sehen bei unsignierten `.exe`-Dateien die Warnung
„unbekannter Herausgeber“ / SmartScreen. Lesbarer Quelltext ist der
ehrlichste Vertrauensbeweis:

- kein versteckter Keylogger
- kein Miner
- lokale Scanner lesen nur lokale Dateien / Registry
- keine undurchsichtige Blackbox

Die **fertigen Installer** kommen nur von:

- https://github.com/Stefan2010byte/viscode-launcher/releases
- https://vystra.games

## Lizenz — kurz (FSL)

Erlaubt: lesen, lernen, Mods, interne Nutzung, Bildung, Forschung,
Dienstleistungen für einen Lizenznehmer.  
Verboten: ein kommerzielles Produkt, das den Vystra Launcher, den Shop
oder eine wesentlich gleiche Funktion ersetzt.

Nach zwei Jahren gilt zusätzlich Apache 2.0.  
Siehe [LICENSE](LICENSE) und [NOTICE](NOTICE).  
Lizenztext: [fsl.software](https://fsl.software/)

## Autor / Signatur im Code

Die Quelldateien tragen den Vermerk:

`Copyright (c) 2026 Stefan Reibnegger (Vystra)`

Wer den Code kopiert und die Hinweise entfernt, verletzt die Lizenz.

## Hinweis zu „nicht signiert / Virus“

- **Quelltext hier** = prüfbar, Vertrauensbasis
- **Code Signing (Authenticode)** = gekauftes Windows-Zertifikat für die `.exe`  
  Das ist unabhängig vom GitHub-Repo. Offizielle Builds kommen nur aus den
  oben genannten Quellen.

## Marken

Steam, Epic, Xbox, Ubisoft, EA, GOG und andere Marken gehören ihren Eigentümern.  
Vystra ist damit nicht offiziell verbunden.
