# API: Auto-Anmeldung für Spiele (Spiel-Brücke)

Ein über den Launcher gestartetes Spiel meldet den Spieler **automatisch** an –
ohne Login-Maske. Dafür verbindet sich das Spiel mit der lokalen Brücke des Launchers.

## 1) Verbindung

```
ws://127.0.0.1:8448
```
(Port änderbar über `gameBridgePort` in den Launcher-Einstellungen.)

**Sicherheitsregeln der Brücke:**
- Nur Verbindungen von `127.0.0.1` / `::1` werden angenommen.
- Verbindungen **mit** `Origin`-Header werden abgelehnt → Webseiten im Browser kommen nicht dran,
  native Spiele auf demselben PC schon.

## 2) Begrüßung (kommt sofort, ungefragt)

Direkt nach dem Verbinden schickt der Launcher:

```json
{
  "type": "hello",
  "launcher": "VisCode Launcher",
  "version": "1.1.6",
  "user": {
    "id": "user_000026",
    "username": "znvxx",
    "displayName": "VisCode Offical",
    "avatar": "https://…",
    "provider": null
  },
  "turn": { "urls": "…", "username": "…", "credential": "…" }
}
```

- `user` ist `null`, wenn niemand im Launcher angemeldet ist.
- `turn` enthält die TURN-Zugangsdaten für P2P/Multiplayer.
- **Bewusst OHNE Session-Token** (siehe Sicherheitshinweis unten).

Damit allein kann das Spiel den Spieler schon anzeigen/anmelden.

## 3) Lizenz / Auth-Schlüssel anfordern (optional)

Braucht das Spiel einen Nachweis für den **eigenen** Server:

```json
→ { "type": "requestAuth", "gameId": "game_000077" }
```
(`requestLicense` funktioniert identisch.)

Antwort:

```json
← {
  "type": "auth",
  "gameId": "game_000077",
  "userId": "user_000026",
  "username": "znvxx",
  "key": "AKTIVIERUNGSSCHLUESSEL"
}
```

Der Launcher holt diesen Schlüssel im Hintergrund vom Server:

```
POST /api/activation/create
Authorization: Bearer <Launcher-Token>
Body: { "userId": "...", "game_id": "..." }
→ { "key": "..." }
```

Dein Spiel-Server kann den Schlüssel dann beim VisCode-Server prüfen und weiß:
Dieser Spieler besitzt das Spiel wirklich.

## 4) Verbindung halten & Status melden

```json
→ { "type": "ping" }          ← { "type": "pong" }
```

Jede andere Nachricht wird an den Launcher weitergereicht und erscheint in der
Freunde-/Aktivitätsanzeige, z. B.:

```json
→ { "type": "status", "state": "lobby", "detail": "Warte auf Mitspieler" }
```

## 5) Guthaben

Das Guthaben liegt **nicht** in der Brücke, sondern am Server:

```
GET /api/user/<userId>/balance
Authorization: Bearer <Token>
→ { "ok": true, "balance": 49.5, "balance_cents": 4950 }
```

## ⚠️ Sicherheitshinweis (wichtig)

Die Brücke gibt **absichtlich kein Session-Token** heraus. Ein Spiel kann damit also
**nicht** im Namen des Nutzers Guthaben ausgeben, kaufen oder das Konto ändern –
es erfährt nur, *wer* angemeldet ist, und bekommt auf Wunsch einen
spielgebundenen Aktivierungsschlüssel.

Soll ein Spiel künftig Guthaben abbuchen dürfen (z. B. In-Game-Käufe), darf dafür
**nicht** das Launcher-Token weitergereicht werden. Richtig wäre ein eigener Server-Flow:
Das Spiel schickt seinen Aktivierungsschlüssel an den VisCode-Server, der die Zahlung
bestätigt bzw. ablehnt. Der Schlüssel gilt nur für dieses eine Spiel.
