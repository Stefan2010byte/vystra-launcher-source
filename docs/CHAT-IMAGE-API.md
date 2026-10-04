# Chat-Bilder: Server ist bereit – Client-Teil fehlt noch

**Befund:** Bilder im Freundes-Chat blieben auf „nicht gesendet", weil es sie **nirgends** gab –
weder Server (kein Bild-Feld) noch Client (`send()` ist text-only, `_mapMsg()` liest kein Bild).
Der Server-Teil ist jetzt gebaut. Der Client muss noch senden + rendern.

> ⚠️ **Geht erst nach dem nächsten Server-Neustart live** (Stefan gibt frei / 00:00-Neustart).

---

## Server – was jetzt geht (REST, wie gehabt)

**Senden:** `POST /api/chats/send` (angemeldet, Session-Header)
```json
{ "toUserId": "user_000081", "text": "optional", "image": "data:image/png;base64,iVBORw0KGgo…" }
```
- **`image`** darf eine **Data-URL** (`data:image/png;base64,…`) **oder** rohes Base64 sein.
  Akzeptierte Feldnamen (Alias): `image` · `imageDataUrl` · `dataUrl` · `attachment`.
- Erlaubte Typen: **PNG / JPG / JPEG / WEBP / GIF**. Anderes → `400`.
- **`text` darf leer sein**, wenn ein Bild dabei ist (reine Bildnachricht). Beides zusammen geht auch.
- Bild wird als Datei gespeichert (unter `/media/…`), **nicht** als Riesen-Base64 in der DB.

**Antwort** (und **jeder** Verlauf-Load: `GET /api/chats`, `/api/chats/<id>/messages`,
`/api/chats/with/<user>`) enthält pro Nachricht jetzt:
```json
{ "messageId": "msg_000042", "text": "", "image": "https://api.vis-code.com/media/User/…/chat_msg_000042.png",
  "imageUrl": "https://api.vis-code.com/media/User/…/chat_msg_000042.png", "created": 1786310000, … }
```
- `image` = **volle URL** (oder `null`, wenn kein Bild). `imageUrl` ist derselbe Wert (Alias).
- Gelöschte Nachrichten liefern `image: null` (wie beim Text).
- Gilt auch für **Gruppen** (`/api/groups/<id>/messages`) – gleicher Handler.

---

## Client – dein Teil (`renderer/app.js`)

1. **Senden mit Bild** – der `send()`-Pfad verweigert aktuell leeren Text und schickt nur `{toUserId,text}`.
   Für Bilder: erlaube leeren Text, wenn ein Bild da ist, und häng `image` an:
   ```js
   await this._srv("POST", "/api/chats/send", { toUserId: uname, text: text || "", image: dataUrl });
   ```
   Die optimistische lokale Nachricht darf das lokale `dataUrl` als Vorschau behalten; nach der Antwort
   kannst du auf `resp.data.image` (die echte URL) umstellen – musst du aber nicht.

2. **Empfangen/Rendern** – `_mapMsg()` liest bisher kein Bild. Ergänze:
   ```js
   image: _0x42050c.image || _0x42050c.imageUrl || null,
   ```
   und im Nachrichten-Renderer: wenn `msg.image`, ein `<img class="chat-img" src=msg.image>` in die Blase
   (Text darunter/darüber, falls beides). Klick → großes Vorschaubild (wie sonst).

3. **Verfassen-UI** – der Bild-Anhang existiert schon (Vorschau-Blase war ja da), er muss nur den
   Send-Pfad mit `image` treffen statt lokal hängen zu bleiben.

4. **WS `message`-Event** (falls schon verdrahtet) trägt künftig `image` mit – optional gleich mitrendern.

**Tipp:** Bilder client-seitig runterrechnen (z. B. max ~1600 px Kante / < ~2 MB) bevor du sie schickst –
schneller und schont die DB/Bandbreite. Das JSON-Limit liegt bei 200 MB, das ist nicht die Grenze.
