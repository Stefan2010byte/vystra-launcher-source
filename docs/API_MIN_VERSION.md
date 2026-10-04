# Server: Mindestversion-Sperre (alte Launcher aussperren)

Ziel: Nur die aktuellste Launcher-Version darf kaufen/herunterladen. Ältere werden abgelehnt,
damit z. B. der alte (kaputte) Kauf-Flow nicht mehr benutzt werden kann.

## So macht es der Launcher (ab v1.1.4 eingebaut)
Jeder API-Request schickt einen Header mit:
```
X-Launcher-Version: 1.1.4
```
Bekommt er **HTTP 426** zurück, zeigt er automatisch den Pflicht-Update-Screen.

## Was der Server tun muss

1. **Konfig:** `MIN_LAUNCHER_VERSION = "1.1.4"`

2. **Middleware** auf den geschützten Endpoints: Header `X-Launcher-Version` lesen und mit
   Semver vergleichen. Ist er **kleiner** als das Minimum **oder fehlt er komplett** → ablehnen:
   ```
   HTTP 426 Upgrade Required
   { "ok": false, "error": "Launcher veraltet – bitte aktualisieren.",
     "minVersion": "1.1.4" }
   ```

3. **Geschützt** (426 bei zu alt/fehlend) – alles Wertige:
   - `POST /api/checkout`
   - `POST /api/games/<id>/buy`  (+ Alias /api/purchase, /api/buy, /api/order, /api/games/buy)
   - `POST /api/activation/create`
   - `POST /api/download/start`

4. **NICHT sperren** (sonst kommt ein alter Client nie zum Update-Screen bzw. meldet seine Version nicht):
   - `POST /api/auth/steam`, `/api/auth/epic`, alle `/api/auth/*`
   - `POST /api/launcher/version`
   - `GET  /api/v1/games` (oeffentlicher Katalog)

## Semver-Vergleich (Beispiel Node/Express)
```js
const MIN = "1.1.4";
function cmp(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i]||0) - (pb[i]||0); if (d) return d; }
  return 0;
}
function requireMinVersion(req, res, next) {
  const v = req.get('X-Launcher-Version');
  if (!v || cmp(v, MIN) < 0) {
    return res.status(426).json({ ok:false, error:"Launcher veraltet – bitte aktualisieren.", minVersion: MIN });
  }
  next();
}
// z.B.: app.post('/api/checkout', requireMinVersion, checkoutHandler)
```

## Warum zusaetzlich zur `mandatory`-Flag in latest.json?
- `latest.json mandatory:true` sperrt den Launcher schon **beim Start** (clientseitig) – deckt die
  allermeisten Faelle ab.
- Diese Server-Sperre ist der **Backstop**: selbst wenn ein alter/modifizierter Client den
  Start-Check umgeht, kann er serverseitig **nicht kaufen/laden**.

## Wenn du spaeter eine neue Version rausbringst
Einfach `MIN_LAUNCHER_VERSION` auf die neue Nummer setzen – der Launcher meldet ab dann 426 fuer
alles Aeltere und zwingt zum Update.
