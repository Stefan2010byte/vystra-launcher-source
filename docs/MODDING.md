# Modding: lokale Launcher-API

Copyright (c) 2026 Stefan Reibnegger (Vystra)

Der Renderer spricht mit dem Hauptprozess über `window.viscode`
(siehe `preload.js`). Das ist die Stelle für Themes, Overlays, Tools
und eigene UI-Erweiterungen.

Vollständige Server- und Fremdhost-Liste: [API_LAUNCHER_KOMPLETT.md](API_LAUNCHER_KOMPLETT.md).

## Deep-Links

```
viscode://game/<platform>/<gameId>
```

Beispiel: `viscode://game/viscode/game_000078`

## Spiel-Brücke (lokal)

```
ws://127.0.0.1:8448
```

Nur lokale Verbindungen. Nachrichten: `hello`, `requestAuth`, `requestLicense`,
`ping`/`pong`. Details: [API_AUTO_LOGIN.md](API_AUTO_LOGIN.md).

VR-Discovery: UDP 8450 · VR-LAN-Brücke: 8451 · Launch-Handshake: `127.0.0.1:8449`

## `window.viscode` (Auszug)

Die Namen sind die öffentlichen Methoden aus `preload.js`.
Aufruf ist immer `await window.viscode.<name>(…)` bzw. ein Listener.

### Fenster & App
`getVersion` · `windowControl` (`minimize` / `maximize` / `close`) ·
`setWindowGlass` · `setWindowOpacity` · `onWindowMaximized` ·
`setFullscreen` · `isFullscreen` · `onFullscreenChanged`

### Bibliothek & Plattformen
`scanPlatforms` · `launcherScan` · `steamLibraries` · `steamOwned` ·
`steamOwnedMulti` · `epicOwned` · `xboxLibrary` · `gogOwned` ·
`pickGameFolder` · `setGameMeta` · `hideManualGame`

### Starten
`launchGame` · `launchGameUri` · `gameRunning` · `killGame` ·
`startPlatform` · `createGameShortcut`

### Shop / Katalog (öffentlich wo möglich)
`loadShop` · `shopSearch` · `gameDetails` · `serverGames` ·
`dealsList` · `preiseVergleich`

### Social (über dokumentierte REST-Pfade)
`socialApi(method, path, body)` · `loadSocial` · `saveSocial` ·
`setPresence` · `familyMine`

### VR
`vrStatus` · `vrScan` · `vrPairCode` · `questDetect` · `questInstall`

## Regeln für Mods

1. Copyright-Hinweis von Stefan Reibnegger behalten.
2. FSL einhalten: kein konkurrierender kommerzieller Launcher/Shop.
3. Keine Secrets aus offiziellen Builds hierher kopieren.
4. Live-Server nicht mit fertigen Angriffen dokumentieren — Funde privat
   an den Kontakt auf https://vystra.games.
