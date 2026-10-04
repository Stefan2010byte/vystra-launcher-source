# API-Doku — für die Modder-Community

Copyright (c) 2026 Stefan Reibnegger (Vystra)

Hier liegen die Schnittstellen, die der Launcher spricht.  
Lizenz der Quelle: [FSL-1.1-ALv2](../LICENSE). Mods und Tools sind erlaubt,
ein konkurrierender kommerzieller Launcher/Shop nicht.

| Datei | Inhalt |
|---|---|
| [MODDING.md](MODDING.md) | Lokale IPC: `window.viscode` im Renderer |
| [API-UEBERSICHT.md](API-UEBERSICHT.md) | REST-Übersicht (Konto, Shop, Chat, Family, …) |
| [API_LAUNCHER_KOMPLETT.md](API_LAUNCHER_KOMPLETT.md) | Alle Server-, Fremd- und lokalen APIs |
| [API_WEBSITE.md](API_WEBSITE.md) | Web-Oberfläche |
| [API_AUTO_LOGIN.md](API_AUTO_LOGIN.md) | Spiel-Brücke / Auto-Login |
| [API_USER_PROFILE.md](API_USER_PROFILE.md) | Profil |
| [API_ONLINE_USERS.md](API_ONLINE_USERS.md) | Online-Nutzer |
| [API_UPDATE_TRACKING.md](API_UPDATE_TRACKING.md) | Versionsmeldung |
| [API_MIN_VERSION.md](API_MIN_VERSION.md) | Mindestversion (HTTP 426) |
| [SHARE-API.md](SHARE-API.md) | Teilen-Links |
| [CHAT-IMAGE-API.md](CHAT-IMAGE-API.md) | Chat-Bilder |
| [WS-CHAT-API.md](WS-CHAT-API.md) | WebSocket-Chat |
| [GRUPPEN-UND-CHAT-API.md](GRUPPEN-UND-CHAT-API.md) | Gruppen & Social |

Basis der eigenen REST-API: `https://api.vis-code.com`  
Angemeldete Aufrufe: `Authorization: Bearer <session_token>`  
Launcher-Header: `X-Launcher-Version: <version>`

Offizielle Builds bleiben https://vystra.games und die viscode-launcher-Releases.
Diese Doku ist zum Bauen von Mods und Integrationen, nicht zum Nachbau des Shops.
