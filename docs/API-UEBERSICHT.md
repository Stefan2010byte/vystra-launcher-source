# VisCode-API – Übersicht (was der Launcher nutzt)

Basis-URL: `https://api.vis-code.com`. Angemeldete Aufrufe: `Authorization: Bearer <session_token>`. Identität kommt immer aus dem Token, nie aus dem Body.

## 🔑 Anmeldung / Konto
| Methode | Pfad | Zweck |
|---|---|---|
| POST | /api/login | { username, password } → session_token |
| POST | /api/login/oneclick | { user_id, email } → session_token (Instant/Schnellwechsel) |
| POST | /api/register | Konto anlegen |
| POST | /api/send-code | Bestätigungscode senden |
| POST | /api/auth/steam · /api/auth/epic | Anmeldung/Verknüpfung über Steam/Epic |
| GET | /api/oauth/token · /api/auth/oauth-url | VisCode-OAuth |
| GET | /api/account | eigene Kontodaten (avatar/banner/company) |
| POST | /api/account | Konto speichern (Name, E-Mail, Avatar, Banner …) |
| GET | /api/user/me | Nutzerobjekt (avatar_url, frame, role) |
| GET | /api/user/<id>/balance | Guthaben |
| POST | /api/user/balance/change | Guthaben ändern |
| POST | /api/account/export · /api/account/delete | Daten anfordern / Konto löschen |
| POST | /api/rechner/check-ban | Bann-Status (HWID) |

## 🎮 Laden / Shop (öffentlich, ohne Token)
| Methode | Pfad | Zweck |
|---|---|---|
| GET | /api/games | alle VisCode-Spiele (+ ratingAverage/ratingCount) |
| GET | /api/games/<id> | Spiel-Details |
| GET | /api/games/<id>/platforms | Plattform-Builds (Windows/Android/…) |
| GET | /api/platforms | unterstützte Systeme |
| GET | /api/publishers | alle Herausgeber |
| GET | /api/publishers/<id>/details | Herausgeber-Profil + Spiele |
| GET | /api/publishers/mine | eigener Herausgeber (Token) |
| GET | /api/v1/games | Server-Spiele (Vollfelder) |

> Steam-/Epic-Spiele kommen NICHT von VisCode, sondern von Steams/Epics eigenen APIs (clientseitig).

## ⬇️ Kauf / Download / Bibliothek
| Methode | Pfad | Zweck |
|---|---|---|
| POST | /api/checkout | Kauf { user_id, game_ids, gift?, method:"balance"? } |
| POST | /api/games/<id>/buy | Einzelkauf mit Guthaben |
| POST | /api/activation/create | Aktivierungsschlüssel |
| POST | /api/download/start | Download starten → Manifest-Info |
| GET | /api/games/<id>/manifest?platform= | Dateiliste + Chunks |
| GET | /api/games/<id>/chunk/<hash> | einzelner Chunk |
| GET | /api/launcher/library | eigene Bibliothek (+ executable je Spiel) |
| GET | /api/launcher/status | Wartung / Mindestversion |
| GET | /api/launcher/download-license | Lizenz-Zertifikat |
| POST | /api/keys/redeem | Key einlösen |
| GET | /api/purchases · /api/user/purchases | gekaufte Spiele |

## 💬 Chat (unter Freunden)
| Methode | Pfad | Zweck |
|---|---|---|
| GET | /api/chats | Übersicht + ungelesen + eigene userId |
| GET | /api/chats/with/<user> | Verlauf (1s-Poll bei offenem Chat) |
| POST | /api/chats/send | { toUserId, text } |
| DELETE | /api/chats/messages/<id>[?forEveryone=1] | Nachricht löschen/zurückziehen |
| DELETE | /api/chats/<chatId> | Chat für mich ausblenden |

## 🧑‍🤝‍🧑 Freunde
| Methode | Pfad | Zweck |
|---|---|---|
| GET | /api/friends/public | VisCode-Freunde |
| POST | /api/friends/add | direkt hinzufügen |
| POST | /api/friends/add/request | Anfrage senden |
| POST | /api/friendsrequest/del | Anfrage/Freundschaft entfernen |
| GET | /api/friends/discover · /api/users/online | Nutzer finden / online |
| GET | /api/presence · /api/presence/all | Online-Status |

## 👪 Family
| Methode | Pfad | Zweck |
|---|---|---|
| GET | /api/family/mine · /api/family/<id> | meine Familie(n) / Details (members[]) |
| POST | /api/family/create · /join · /leave · /<id> (rename) | verwalten |
| POST | /api/family/<id>/members · DELETE .../members/<uid> | Mitglied direkt |
| POST | /api/family/<id>/invite | einladen (ausstehend) |
| GET | /api/family/invites · POST .../invites/<id>/accept|decline | meine Einladungen |
| POST | /api/family/<id>/parental | Kindersicherung |
| GET | /api/family/<id>/game/<gid>/status · POST /api/game/launch|close | Concurrency |

## 🎁 Geschenke
| Methode | Pfad | Zweck |
|---|---|---|
| GET | /api/gifts | ausstehende + erhaltene |
| POST | /api/gifts/<id>/accept · /decline | annehmen / ablehnen |
| GET | /api/gifts/sent | verschenkte (needsDecision) |
| POST | /api/gifts/<id>/resolve | { action: regift|keep|refund } |

## ⭐ Bewertungen / Feedback
| Methode | Pfad | Zweck |
|---|---|---|
| GET | /api/games/<id>/reviews | Bewertungen eines Spiels |
| POST | /api/games/<id>/reviews | bewerten { stars, text } (Upsert = 1 pro Konto) |
| DELETE | /api/games/<id>/reviews/<rid> | eigene Bewertung löschen |
| POST | /api/feedback | Launcher bewerten |
| GET | /api/feedback/mine · /api/feedback/summary | eigenes / Schnitt |

## 🧩 Sonstiges
| Methode | Pfad | Zweck |
|---|---|---|
| POST | /api/daily/claim | Tagesbelohnung |
| GET | /api/launcher/version · latest.json (GitHub) | Update-Prüfung |
| POST | /api/presence | Online setzen |

## Noch NICHT gebaut (Specs liegen bereit)
- WebSocket-Chat (WS-CHAT-API.md) · Gruppen-Chat (GRUPPEN-UND-CHAT-API.md) · Anruf-Signaling (Calls) · Avatar/Banner-Upload · Frames-Shop · profileVisibility
