# Server-Aufgaben: Gruppen-Chat + Social-Features (aus der Discord-Liste)

Was in den Launcher passt und was der Server dafür braucht. Alles über den Session-Token (Identität kommt IMMER aus dem Token, nie aus dem Body). Gruppen-Endpunkte gibt's noch nicht (alle 404 geprüft).

---

## 1. GRUPPEN-CHATS (dein Hauptwunsch)

```
POST   /api/groups                         { name, memberIds: ["user_…", …] }   → Gruppe anlegen (Ersteller = Admin)
       → { ok, groupId, name, adminId, memberIds: [...] }
GET    /api/groups                         → meine Gruppen
       → { ok, count, groups: [ { groupId, name, icon, memberCount, memberIds:[...], lastMessage, unread } ] }
GET    /api/groups/<groupId>               → Details MIT allen Mitgliedern
       → { ok, groupId, name, icon, adminId, created,
             members: [ { userId, username, avatar, role } ],   ← alle Mitglieder-IDs + Namen
             memberIds: [ "user_…", … ] }
POST   /api/groups/<groupId>/members       { userId | username }   → Mitglied hinzufügen (Admin)
DELETE /api/groups/<groupId>/members/<userId>                      → entfernen (Admin) / bzw. sich selbst
POST   /api/groups/<groupId>/leave                                 → Gruppe verlassen
POST   /api/groups/<groupId>               { name?, icon? }        → umbenennen / Icon setzen (Admin)
DELETE /api/groups/<groupId>                                       → Gruppe löschen (Admin)
```

**Gruppen-Nachrichten** (gleiches Muster wie 1:1-Chat, damit ich es wiederverwenden kann):
```
GET    /api/groups/<groupId>/messages?limit=&before=
       → { ok, count, messages: [ { messageId, fromUserId, fromUsername, avatar, text, created } ] }   (created = Unix-Sek.)
POST   /api/groups/<groupId>/messages      { text }               → senden
DELETE /api/groups/<groupId>/messages/<msgId>                     → eigene Nachricht löschen
```
Regeln: nur Mitglieder dürfen lesen/schreiben (sonst 403), nur Admin darf Mitglieder verwalten, doppeltes Mitglied → 409. Das 1‑Sekunden‑Polling nutze ich auch hier (kein WebSocket nötig).

---

## 2. Notiz bei Freundschaftsanfrage („warum füge ich dich hinzu")

Bestehende Anfrage nur um ein Feld erweitern:
```
POST /api/friends/add/request   { username, note }     ← note optional, max ~200 Zeichen
GET  (eingehende Anfragen)       … pro Anfrage zusätzlich `note`
```

## 3. Profil auf „privat" (wer darf mein Profil/Bio sehen)

```
POST /api/account   { profileVisibility: "everyone" | "friends" | "nobody" }
GET  /api/account   → liefert `profileVisibility`
```
Der Server sollte bei Profil-Abrufen die Sichtbarkeit respektieren (Nicht-Freunde bekommen ein reduziertes Profil).

## 4. Profil-Rahmen (Frames aus dem Shop)

Es gibt schon `frame` in `/api/user/me`. Damit man Rahmen wählen/kaufen kann:
```
GET  /api/frames                 → verfügbare Rahmen [ { frameId, name, css|imageUrl, rarity, price } ]
POST /api/account   { frameId }  → Rahmen anlegen/wechseln
```

## 5. Formatierte Bio (der „WYSIWYG"-Teil)

```
POST /api/account   { bio }      → Bio speichern (Klartext mit einfachen Markierungen, z. B. **fett**, *kursiv*)
GET  /api/account   → `bio`
```
Reicht simpel: Der Launcher rendert **fett**/*kursiv*/Listen selbst. Kein echtes HTML nötig.

---

## Was NICHT in den Launcher passt (aus der Discord-Liste)
- **Spoiler-Kanäle** – ihr habt keine Server/Kanäle, nur Freundes-DMs + Gruppen. Nicht sinnvoll.
- **Discord auf Meta Quest (VR)** – kein Bezug zum Launcher.

## Was ich OHNE Server sofort baue
- **Spiel im Chat teilen (@game)** – Spiel-Karte direkt in der Nachricht (nutzt die vorhandenen `viscode://game/…`-Links, rein clientseitig, keine API nötig).
