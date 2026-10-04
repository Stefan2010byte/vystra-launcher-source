# Vystra Launcher — öffentliche Prüf-Quelle

**Autor:** Stefan Reibnegger (Vystra)  
**Lizenz:** [Polyform Noncommercial 1.0.0](LICENSE) — **keine kommerzielle Nutzung**  
**Offizielle Downloads:** [Releases (viscode-launcher)](https://github.com/Stefan2010byte/viscode-launcher) · [vystra.games](https://vystra.games)

Dieses Repository ist **source-available**, nicht „Open Source“ im OSI-Sinn.  
Du darfst den Code **lesen**, um zu prüfen, dass der Launcher kein Virus ist.  
Du darfst ihn **nicht** für eigene kommerzielle Launcher, Shops oder Kopien nutzen.

## Warum das hier öffentlich ist

Viele Windows-Nutzer sehen bei unsignierten `.exe`-Dateien die Warnung
„unbekannter Herausgeber“ / SmartScreen. Ein bezahltes Authenticode-Zertifikat
ist etwas anderes als Quelltext. Solange die offiziellen Builds das nicht haben,
ist **lesbarer Quelltext** der ehrlichste Vertrauensbeweis:

- kein versteckter Keylogger
- kein Miner
- lokale Scanner lesen nur lokale Dateien / Registry
- keine undurchsichtige Blackbox

Die **fertigen Installer** kommen nur von:

- https://github.com/Stefan2010byte/viscode-launcher/releases
- https://vystra.games

## Was in dieser Kopie bewusst fehlt

Damit niemand den **Vystra-Server**, Konten oder den eigenen Shop angreifen
oder nachbauen kann, ist diese Fassung **beschnitten**:

- alle Adressen und Aufrufe zu den **Vystra-eigenen Servern** sind entfernt
- der **eigene Vystra-Shop** (Kauf, Wallet, Server-Bibliothek, Konto-API) ist entfernt
- interne API-Dokumente, Anti-Crack-Notizen und Website-Backends sind **nicht** enthalten
- eingebaute Drittschlüssel (z. B. Steam-Web-API) sind **leer**

Steam / Epic / Xbox **öffentliche** Store-Seiten und der **lokale** Bibliotheks-Scanner
bleiben sichtbar, damit man die Desktop-App nachvollziehen kann.

Diese Kopie ist **kein vollständiger Klon** der Verkaufsversion und startet
ohne Vystra-Backend nicht als fertiger Store.

## Lizenz — kurz

Erlaubt: lesen, lernen, Sicherheitsprüfung, privates Hobby **ohne** Geschäftsabsicht.  
Verboten: Verkauf, eigener Store, White-Label, SaaS, Werbung damit verdienen,
Weitergabe als eigenes Produkt.

Siehe [LICENSE](LICENSE) und [NOTICE](NOTICE).

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
