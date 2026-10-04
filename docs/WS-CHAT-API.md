# Server-Aufgabe: Echtzeit-Chat per WebSocket

Damit Freundes-Nachrichten sofort ankommen (statt alle 30 s Polling) + „schreibt gerade …" + Gelesen-Häkchen. Der Launcher öffnet **eine** dauerhafte WebSocket-Verbindung im Hauptprozess (das `ws`-Paket ist schon drin, wie bei der Spiel-Brücke). Senden/Speichern der Nachrichten läuft weiter über die bestehende REST-API — der WebSocket ist nur für **Empfangen + Live-Signale**.

---

## 1. Verbindung + Authentifizierung

```
wss://api.vis-code.com/ws/chat
```
(oder ein Pfad deiner Wahl – sag ihn mir.)

WebSocket kann keinen `Authorization`-Header setzen. Deshalb: **erste Nachricht nach dem Verbinden = Auth** (Token NICHT als Query-Parameter – der landet in Logs).

Client → Server (sofort nach Connect):
```json
{ "type": "auth", "token": "<session_token>" }
```
Server → Client:
```json
{ "type": "auth_ok", "userId": "user_000026" }
```
Bei ungültigem Token: `{ "type": "auth_error" }` und Verbindung schließen.

**Heartbeat:** Server schickt alle ~30 s `{ "type": "ping" }`, Client antwortet `{ "type": "pong" }` (oder WS-Ping/Pong-Frames). Der Client baut bei Abbruch automatisch neu auf (Reconnect + erneutes Auth). Nichts Besonderes nötig, nur nicht nach 60 s Stille die Verbindung hart killen.

---

## 2. Server → Client (Push-Events)

**Neue Nachricht** (an den Empfänger pushen, sobald jemand über `POST /api/chats/send` schreibt):
```json
{ "type": "message",
  "chatId": "chat_000001", "messageId": "msg_000042",
  "fromUserId": "user_000081", "fromUsername": "feiwi2",
  "toUserId": "user_000026", "text": "Hey!", "created": 1786310000 }
```
(`created` = Unix-Sekunden, wie überall.)

**Schreibt gerade** (an den Gesprächspartner relayen):
```json
{ "type": "typing", "chatId": "chat_000001", "fromUserId": "user_000081" }
```

**Gelesen** (wenn der Partner die Nachrichten gelesen hat → an den Absender pushen):
```json
{ "type": "read", "chatId": "chat_000001", "userId": "user_000081", "messageId": "msg_000042" }
```
(`messageId` = bis einschließlich dieser Nachricht gelesen. Alternativ `upTo`.)

**Optional – Präsenz** (online/offline eines Freundes):
```json
{ "type": "presence", "userId": "user_000081", "online": true }
```

**Optional – Nachricht gelöscht/zurückgezogen** (damit offene Chats synchron bleiben):
```json
{ "type": "message_deleted", "chatId": "chat_000001", "messageId": "msg_000042", "forEveryone": true }
```

---

## 3. Client → Server

**Ich tippe gerade** (Client sendet höchstens alle ~2–3 s, während getippt wird):
```json
{ "type": "typing", "toUserId": "user_000081" }
```
Server relayt es als `typing`-Event an den Empfänger (siehe oben).

**Ich habe gelesen** (Client sendet, wenn ein Chat geöffnet/fokussiert wird):
```json
{ "type": "read", "chatId": "chat_000001", "messageId": "msg_000042" }
```
Server merkt sich das und pusht ein `read`-Event an den Absender.

> Das eigentliche **Senden** einer Nachricht bleibt REST: `POST /api/chats/send { toUserId, text }`. Der Server schreibt sie in die DB (wie bisher) UND pusht sie als `message`-Event an den Empfänger, falls dieser per WS verbunden ist. So geht keine Nachricht verloren, auch wenn der Empfänger offline ist (er holt sie beim nächsten `GET /api/chats/with/…`).

---

## 4. Gelesen-Häkchen: was der Server dafür braucht

Damit der Absender sieht „gelesen", muss der Server pro Nachricht (oder pro Chat) einen Lesestand führen und:
- beim `read`-Event des Empfängers ein `read`-Event an den Absender pushen (Punkt 2),
- optional im REST-Verlauf (`GET /api/chats/with/…`) pro Nachricht ein Feld `readAt` (oder `read: true`) mitliefern, damit der Anfangszustand nach dem Öffnen stimmt (ohne WS-Event).

---

## Was der Launcher dann macht (mein Teil, sobald der Endpunkt steht)

- Hauptprozess hält die WS-Verbindung (Token bleibt im Hauptprozess), reicht Events per IPC an die Oberfläche.
- `message` → Nachricht sofort im offenen Chat anhängen, sonst ungelesen-Badge + **Desktop-Benachrichtigung + In-App-Popup** (wie bei Freundschaftsanfragen).
- `typing` → „schreibt gerade …" im Chat für ~4 s.
- `read` → Gelesen-Häkchen an den eigenen Nachrichten.
- Tippen im Eingabefeld → gedrosseltes `typing` senden; Chat öffnen → `read` senden.
- Fällt der WS aus, bleibt das bestehende 30-s-Polling als Fallback aktiv.

**Sag mir nur den finalen WS-Pfad** (z. B. `/ws/chat`), dann verdrahte und teste ich den Client live.
