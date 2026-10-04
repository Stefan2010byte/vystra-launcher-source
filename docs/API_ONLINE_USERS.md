# API: Online-User für „Freund hinzufügen"

Der „Freund hinzufügen"-Dialog zeigt eine Liste der **aktuell online** Nutzer und oben rechts
die **Anzahl online**. Dafür braucht der Server einen Endpoint.

## Was der Launcher aufruft
Er probiert der Reihe nach (nimm einen davon):
```
GET /api/users/online     (bevorzugt)
GET /api/users?online=1
GET /api/users
```
Alle mit `Authorization: Bearer <token>`.

## Erwartete Antwort
```json
{
  "online_count": 12,
  "users": [
    { "id": "user_000031", "username": "maxi",  "displayName": "Maxi",  "avatar": "https://…", "online": true },
    { "id": "user_000044", "username": "lena99", "displayName": "Lena",  "avatar": null,        "online": true }
  ]
}
```

- `online_count` (optional) = Zahl fürs Badge oben rechts. Fehlt sie, zählt der Launcher die Liste.
- `users` = Array. Felder tolerant: `username` (nötig), `displayName`/`avatar`/`id` optional.
- **Nur online:** Entweder der Server liefert direkt nur Online-User, ODER er setzt pro User
  `online: true` (auch `is_online`, `status:"online"`, `online:1` werden erkannt) – der Launcher
  filtert dann selbst auf online.
- Der eigene Account + bereits bestehende Freunde werden im Launcher automatisch rausgefiltert.

## Presence (online/offline) tracken – wie?
Der Launcher/das Spiel meldet sich eh regelmäßig (z. B. `/api/launcher/version`, `/api/friends`).
Einfachste Variante am Server: `last_seen`-Zeitstempel pro User bei jedem authentifizierten Request
aktualisieren → **online = last_seen < 2 Minuten her**. Für `/api/users/online` dann alle mit
frischem `last_seen` zurückgeben.

## Fallback
Fehlt der Endpoint (404), zeigt der Dialog einen Hinweis und man kann den Namen wie bisher
manuell eintippen – nichts bricht.
