# API: Wer hat wann das neuste Update gemacht?

Der Launcher meldet bei jedem Start seine Version. Ändert sich die Version gegenüber dem
letzten Lauf (= frisch aktualisiert), kommt `updated: true` mit. Damit kann der Server
protokollieren, **welcher User wann auf welche Version aktualisiert hat**.

---

## 1) Was der Launcher sendet (ist bereits eingebaut)

```
POST /api/launcher/version
Authorization: Bearer <sessionToken>
Content-Type: application/json

{
  "userId": "user_000026",
  "username": "znvxx",
  "version": "1.1.3",          // aktuelle Launcher-Version
  "previousVersion": "1.1.2",  // vorher installierte Version (null beim allerersten Mal)
  "updated": true,             // true = seit letztem Start aktualisiert
  "at": "2026-08-03T14:22:05.123Z"  // Zeitpunkt (ISO 8601, UTC)
}
```

**Server-Aufgabe:** Wenn `updated === true`, ein Update-Event speichern:
`{ userId, username, version, previousVersion, updatedAt: at }`
(Bei `updated:false` optional nur „zuletzt gesehen" aktualisieren – kein Update-Event.)

---

## 2) Abfrage-Endpoints (die musst du am Server anlegen)

### Das neuste Update (welcher User zuletzt aktualisiert hat)
```
GET /api/launcher/updates/latest        (Bearer, nur Admin)
→ {
    "userId": "user_000026",
    "username": "znvxx",
    "version": "1.1.3",
    "previousVersion": "1.1.2",
    "updatedAt": "2026-08-03T14:22:05.123Z"
  }
```

### Verlauf aller Updates (neueste zuerst)
```
GET /api/launcher/updates?limit=50      (Bearer, nur Admin)
→ {
    "updates": [
      { "userId":"user_000026","username":"znvxx","version":"1.1.3",
        "previousVersion":"1.1.2","updatedAt":"2026-08-03T14:22:05.123Z" },
      { "userId":"user_000031","username":"maxi","version":"1.1.3",
        "previousVersion":"1.1.1","updatedAt":"2026-08-03T13:05:44.000Z" }
    ]
  }
```

### Optional: pro Version, wer sie schon hat
```
GET /api/launcher/updates?version=1.1.3   → nur Updates auf diese Version
```

---

## Hinweise
- Nur **Admin** darf die Abfrage-Endpoints sehen (Update-Historie ist keine öffentliche Info).
- `updatedAt` kommt vom Client (`at`). Wenn du dem Client nicht traust, nimm stattdessen den
  Empfangszeitpunkt am Server – dann ist der Wert fälschungssicher.
- „Neustes Update" = Event mit dem größten `updatedAt`.
