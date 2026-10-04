# Server-Aufgabe: Teilen-Links (stabil + dedupliziert)

Beim Klick auf „Teilen" holt der Launcher einen kurzen, stabilen Link vom Server. **Gleiches Spiel → immer derselbe Link** (der Server erzeugt keinen zweiten, sondern gibt den vorhandenen zurück).

---

## 1. Link erstellen / holen

```
POST /api/share      { platform, gameId }
```
- `platform` = `"viscode"` | `"steam"` | `"epic"` | `"microsoft"` …
- `gameId`   = die Spiel-ID (bei VisCode z. B. `game_000078`, bei Steam die AppID).
- **Dedup:** Existiert für genau diese `platform`+`gameId` schon ein Link, gib **denselben** `shareId`/`url` zurück (nicht neu anlegen).

**Antwort:**
```json
{ "ok": true,
  "shareId": "s_AB12CD",
  "url": "https://vis-code.com/s/s_AB12CD",
  "platform": "viscode", "gameId": "game_000078",
  "reused": true }
```
`reused` = ob der Link schon existierte (nur Info). `url` ist der kurze, klickbare Link (in Chats/überall teilbar).

> Auth: darf öffentlich sein oder Token verlangen — deine Wahl. Wenn Token, merkt euch optional `createdBy`.

---

## 2. Link auflösen (wenn jemand ihn öffnet)

Zwei Wege, am besten beide:

**a) Der kurze Link selbst leitet weiter** (fürs Anklicken im Browser/Chat):
```
GET https://vis-code.com/s/<shareId>
   → 302 Redirect auf  viscode://game/<platform>/<gameId>   (öffnet den Launcher direkt)
   (optional eine kleine Landing-Seite mit „Im VisCode Launcher öffnen"-Button + Spielname/Bild)
```

**b) JSON-Auflösung für Website UND Launcher (sagt, welches Spiel geöffnet werden soll):**
```
GET /api/share/<shareId>
   → { "ok": true, "shareId": "s_AB12CD",
        "platform": "viscode", "gameId": "game_000078",
        "deepLink": "viscode://game/viscode/game_000078",   ← FERTIGER Link zum Öffnen
        "title": "Russisches Roulette", "image": "https://…/cover.png" }   ← optional, für Vorschau
```
Der **`deepLink`** ist der Kern: exakt `viscode://game/<platform>/<gameId>`. Die Website muss nichts selbst bauen — sie liest `deepLink` und leitet darauf weiter (bzw. zeigt einen „Im Launcher öffnen"-Button darauf). `title`/`image` sind optional für die Vorschau.

Ungültige ID → 404 `{ "ok": false, "error": "…" }`.

---

## Was der Launcher dann macht (mein Teil)

- „Teilen" ruft `POST /api/share { platform, gameId }` → kopiert die zurückgegebene `url` (kurzer https-Link) in die Zwischenablage / hängt sie im Chat an.
- Öffnet jemand den Link, greift der bestehende Deep-Link-Handler: `viscode://game/<platform>/<gameId>` → Spielseite. Für die Chat-Vorschau-Karte löse ich `shareId` per `GET /api/share/<shareId>` auf.
- Fällt `/api/share` aus (offline / Endpunkt noch nicht da), nutze ich weiter den bisherigen `viscode://game/…`-Link als Fallback — nichts bricht.

**Kurz:** Ein `POST /api/share` (mit Dedup) + eine Auflösung (Redirect und/oder `GET /api/share/<id>`). Sag mir den finalen Link-Host (z. B. `https://vis-code.com/s/…`), dann verdrahte ich den Teilen-Button darauf.
