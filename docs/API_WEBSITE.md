# API-Referenz der VisCode-Web-Oberfläche

Alle Endpunkte, die `viscode-web.html` nutzt. Basis-Adresse (**Base URL**):

```
https://api.vis-code.com
```

## Übersicht

| # | Methode | Endpunkt (Endpoint) | Zweck | Token nötig |
|---|---------|---------------------|-------|-------------|
| 1 | `POST` | `/api/login` | Anmelden | nein |
| 2 | `GET`  | `/api/user/me` | Token noch gültig? | ja |
| 3 | `GET`  | `/api/account` | Kontodaten laden | ja |
| 4 | `GET`  | `/api/user/<id>/balance` | Guthaben | ja |
| 5 | `GET`  | `/api/v1/games` | Spiele-Katalog | nein |
| 6 | `GET`  | `/api/games/<gameId>` | Einzelnes Spiel | nein |
| 7 | `POST` | `/api/checkout` | Kauf abschließen | ja |
| 8 | `GET`  | `/api/launcher/library` | Eigene Bibliothek | ja |
| 9 | `GET`  | `/api/purchases?userId=<id>` | Kaufhistorie | ja |
| 10 | `POST` | `/api/keys/redeem` | Key einlösen | ja |
| 11 | `GET`  | `/api/friends` | Freunde + offene Anfragen | ja |
| 12 | `GET`  | `/api/users` | Alle Nutzer (online/game) | ja |
| 13 | `POST` | `/api/presence` | Online-Status melden | ja |

## Der zentrale Aufruf-Helfer

Jeder Aufruf läuft über **eine** Funktion. Das nennt man einen
**API-Client** oder **Wrapper** (hier: `apiCall`):

```js
const API = 'https://api.vis-code.com';
const VER = '1.1.6';

async function apiCall(path, { method = 'GET', body = null, auth = true } = {}) {
  const headers = { 'X-Launcher-Version': VER };
  if (body) headers['Content-Type'] = 'application/json';
  if (auth && state.token) headers['Authorization'] = 'Bearer ' + state.token;

  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    return { ok: false, network: true, error: 'Server nicht erreichbar (evtl. CORS).' };
  }
  if (res.status === 426) return { ok: false, status: 426, error: 'Client zu alt.' };
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}
```

---

## 1) Anmeldung

```js
const body = { password: pass };
if (user.includes('@')) body.email = user; else body.username = user;

const r = await apiCall('/api/login', { method: 'POST', body, auth: false });
// Antwort: { ok: true, user: {...}, token: "SES-..." }
state.token = r.data.token;
```

Das zurückgegebene `token` ist ein **Session-Token** (Sitzungsschlüssel).
Es wird danach bei jedem Aufruf im **Authorization-Header** als
**Bearer-Token** mitgeschickt.

## 2) Sitzung prüfen

```js
const r = await apiCall('/api/user/me');
// 200 = Token gültig · 401/403/404 = abgelaufen -> neu anmelden
```

## 3) Kontodaten

```js
const r = await apiCall('/api/account');
// { ok, id, username, displayName, email, personal:{...}, company:{...} }
```

## 4) Guthaben

```js
const r = await apiCall(`/api/user/${encodeURIComponent(id)}/balance`);
// { ok: true, balance: 49.5, balance_cents: 4950 }
```

`<id>` steckt direkt im Pfad — das nennt man **Pfad-Parameter** (Path Parameter).

## 5) Spiele-Katalog

```js
const r = await apiCall('/api/v1/games', { auth: false });   // öffentlich
// { version: "1", count: 5, games: [ { id, title, description, status,
//   price, current_price, is_free, downloadAvailable,
//   media: { banner, miniBanner, cover, logo } } ] }
```

## 6) Einzelnes Spiel

```js
const r = await apiCall(`/api/games/${encodeURIComponent(gameId)}`, { auth: false });
```

## 7) Kauf

```js
const r = await apiCall('/api/checkout', {
  method: 'POST',
  body: { userId: uid, game_ids: [gameId] }
});
```

Der mitgeschickte JSON-Körper heißt **Request Body** oder **Payload** (Nutzlast).

## 8) Bibliothek

```js
const r = await apiCall('/api/launcher/library');
// { ok, userId, count, games: [ { id, name, cover, executable, downloadUrl } ] }
```

## 9) Kaufhistorie

```js
const r = await apiCall(`/api/purchases?userId=${encodeURIComponent(uid)}`);
// { count, purchases: [ { purchase_id, user_id, game_ids, total_amount } ] }
```

`?userId=…` hängt hinten am Pfad — das ist ein **Query-Parameter**.

## 10) Key einlösen

```js
const r = await apiCall('/api/keys/redeem', { method: 'POST', body: { key } });
// Erfolg: { ok: true, game_name: "..." }
// Fehler: { ok: false, error: "Schlüssel ungültig oder bereits benutzt." }
```

## 11) Freunde

```js
const r = await apiCall('/api/friends');
// { ok, userId, friends: [...], pendingIncoming: [...], pendingOutgoing: [...] }
```

## 12) Alle Nutzer

```js
const r = await apiCall('/api/users');
// { ok, online_count, count, users: [ { id, username, displayName,
//   avatar, online, game: { title, platform } } ] }
```

## 13) Online-Status

```js
await apiCall('/api/presence', { method: 'POST', body: { online: true, game: null } });
```

---

## Begriffe (so nennt man das)

| Begriff | Bedeutung |
|---|---|
| **REST-API** | Bauart der Schnittstelle: Adressen + HTTP-Methoden, Daten als JSON |
| **Endpoint / Endpunkt** | Eine einzelne Adresse, z. B. `/api/friends` |
| **Base URL** | Die gemeinsame Basis-Adresse, hier `https://api.vis-code.com` |
| **HTTP-Methode** | `GET` = lesen, `POST` = senden/ändern, `DELETE` = löschen |
| **Header** | Zusatzinfos neben den Daten (z. B. `Authorization`, `Content-Type`) |
| **Bearer-Token** | Sitzungsschlüssel im Header: `Authorization: Bearer <token>` |
| **Request Body / Payload** | Die mitgeschickten Daten (bei uns JSON) |
| **Response** | Die Antwort des Servers |
| **Statuscode** | `200` ok · `401` nicht angemeldet · `404` nicht gefunden · `426` Client zu alt · `500` Serverfehler |
| **Query-Parameter** | Angaben hinter `?`, z. B. `?userId=user_000026` |
| **Pfad-Parameter** | Angaben im Pfad, z. B. `/api/games/<gameId>` |
| **Öffentlicher Endpunkt** | Braucht kein Token (hier `/api/v1/games`, `/api/login`) |
| **Geschützter Endpunkt** | Braucht ein gültiges Token |
| **CORS** | Erlaubnis des Servers, dass eine fremde Webseite ihn aufrufen darf |
| **API-Client / Wrapper** | Eigene Funktion, die alle Aufrufe bündelt (hier `apiCall`) |

## Statuscodes richtig behandeln

```js
if (r.status === 401 || r.status === 403) logout();        // Token ungültig
if (r.status === 426) alert('Bitte aktualisieren.');       // Client zu alt
if (r.network)        alert('Server nicht erreichbar.');   // Netz/CORS
```
