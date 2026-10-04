# API: User-Profil (Board-Ansicht)

Das Profil-Fenster (Klick auf einen Freund) zeigt jetzt eine Board-Ansicht wie im Screenshot:
großes Banner + runder Avatar, Bio-Zeilen, „Mitglied/Befreundet seit", Verknüpfungen,
und rechts „Lieblingsspiel" + „Spiele, die ich mag". Für VisCode-User zieht der Launcher
diese Daten vom Server.

## Was der Launcher aufruft (erster Treffer gewinnt)
```
GET /api/users/<id>            (bevorzugt)
GET /api/profile?username=<name>
GET /api/user/<id>/profile
```
Alle mit `Authorization: Bearer <token>`.

## Erwartete Felder (alle optional – fehlt was, wird es weggelassen)
```json
{
  "username": "keextherobot",
  "displayName": "Keex",
  "avatar": "https://…",
  "banner": "https://…",                         // großes Kopf-Banner
  "role": "Content Creator",                      // kleine Zeile neben dem Namen
  "bio": ["🇩🇪 German", "👑 Owner of KeexCord",
          "📺 Fortnite & Minecraft YouTuber (27k+)"],  // Array ODER String mit \n
  "createdAt": "2022-08-17",                       // „Mitglied seit"
  "friendsSince": "2026-07-27",                    // „Befreundet seit"
  "connections": [                                 // „Verknüpfungen"
    { "platform": "steam", "name": "KEEXTHEROBOT", "url": "https://steamcommunity.com/id/…" },
    { "platform": "epic",  "name": "KEEXTHEROBOT", "url": "https://…" }
  ],
  "favoriteGame": { "title": "Geometry Dash", "image": "https://…", "note": "Cataclysm Grind" },
  "likedGames": [ { "title": "Roblox", "image": "https://…" },
                  { "title": "Fortnite", "image": "https://…" } ],
  "online": true,
  "game": "Geometry Dash"                          // aktuelles Spiel (für „Spielt X")
}
```

## Hinweise
- `platform` bei connections: `steam`/`epic`/`xbox`/`youtube`/… → passendes Icon; `url` macht die Zeile klickbar (öffnet extern).
- Fehlt der Endpoint (404), zeigt der Launcher für Steam-Freunde weiterhin die öffentlichen Steam-Daten (Level, Land, zuletzt gespielt → Lieblingsspiel). Für VisCode-User bleibt das Board dann leer mit Hinweis.
- **Privat/Öffentlich:** bei privatem Konto einfach `favoriteGame`/`likedGames`/`game`/Spielzeit/XP weglassen (oder `"private": true`) – der Launcher zeigt dann nur Name/Avatar/Status.
