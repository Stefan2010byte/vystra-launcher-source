# Alle APIs des VisCode Launchers

Drei Ebenen:

1. **VisCode-Server** — `https://api.vis-code.com` (eigene REST-API, ~60 Endpunkte)
2. **Fremdanbieter** — Steam, Epic, Xbox, Microsoft u. a. (33 Hosts)
3. **Lokal** — IPC-Brücke (99 Handler) und Spiel-Brücke (WebSocket)

Alle Server-Aufrufe senden:

```
Authorization: Bearer <sessionToken>
X-Launcher-Version: <version>        # zu alt -> HTTP 426
Content-Type: application/json       # nur bei POST
```

---

# 1. VisCode-Server (`api.vis-code.com`)

## Anmeldung & Konto-Zugang
| Methode | Endpunkt | Zweck |
|---|---|---|
| `POST` | `/api/login` | Anmelden (Benutzername oder E-Mail + Passwort) |
| `POST` | `/api/login/oneclick` | 1-Klick-Anmeldung (user_id + E-Mail, kein Passwort) |
| `POST` | `/api/register` | Konto anlegen |
| `POST` | `/api/auth/steam` | Anmelden/Verknüpfen über Steam |
| `POST` | `/api/auth/epic` | Anmelden/Verknüpfen über Epic |
| `GET`  | `/api/auth/oauth-url` | OAuth-Startadresse holen |
| `POST` | `/api/oauth/token` | OAuth-Code gegen Token tauschen |
| `POST` | `/api/auth/set-password` | Passwort setzen (nach Social-Login) |
| `POST` | `/api/send-code` | Bestätigungscode per E-Mail |
| `GET`  | `/api/user/me` | Ist das Token noch gültig? |
| `POST` | `/api/rechner/check-ban` | Sperre prüfen (HWID/Konto/IP) |

## Konto & Profil
| Methode | Endpunkt | Zweck |
|---|---|---|
| `GET`  | `/api/account` | Kontodaten laden |
| `POST` | `/api/account` | Kontodaten speichern (Name, E-Mail, Adresse, Firma, Bild, Banner) |
| `POST` | `/api/account/export` | Datenexport anfordern |
| `POST` | `/api/account/delete` | Konto löschen (30-Tage-Frist) |
| `POST` | `/api/user/update` | Einzelne Felder ändern |
| `POST` | `/api/profile` | Profil-Board (Lieblingsspiel, „Spiele die ich mag") |
| `GET`  | `/api/me` | Kurzprofil (Fallback) |

## Shop & Katalog
| Methode | Endpunkt | Zweck |
|---|---|---|
| `GET` | `/api/v1/games` | Spiele-Katalog (öffentlich, kein Token) |
| `GET` | `/api/games/<gameId>` | Einzelnes Spiel |
| `GET` | `/api/publishers` | Alle Herausgeber |
| `GET` | `/api/publishers/<id>/info` | Herausgeber inkl. Spiele |
| `GET` | `/api/publishers/<id>/details` | Herausgeber-Details |

## Kauf, Guthaben & Zahlung
| Methode | Endpunkt | Zweck |
|---|---|---|
| `POST` | `/api/checkout` | Kauf abschließen |
| `GET`  | `/api/purchases?userId=<id>` | Kaufhistorie |
| `GET` / `POST` | `/api/cart`, `/api/cart/<id>` | Server-Warenkorb |
| `POST` | `/api/gifts`, `/api/gifts/<id>` | Geschenke |
| `GET`  | `/api/user/<id>/balance` | Guthaben |
| `POST` | `/api/user/balance/change` | Guthaben ändern |
| `POST` | `/api/wallet/topup` | Guthaben aufladen |
| `POST` | `/api/stripe/connect` | Stripe-Konto verbinden |
| `POST` | `/api/stripe/portal` | Stripe-Kundenportal |

## Download & Aktivierung
| Methode | Endpunkt | Zweck |
|---|---|---|
| `POST` | `/api/activation/create` | Aktivierungsschlüssel erzeugen (Auto-Login für Spiele) |
| `GET`  | `/api/activation/get` | Schlüssel abrufen |
| `POST` | `/api/download/start` | Download starten |
| `GET`  | `/api/games/<id>/manifest` | Datei-Manifest (Chunks + SHA256) |
| `GET`  | `/api/launcher/library` | Eigene Bibliothek (inkl. Startdatei) |
| `GET`  | `/api/library` | Bibliothek (Alternative) |
| `POST` | `/api/launcher/download-license` | Lizenzdatei (.vis) |
| `POST` | `/api/keys/redeem` | Key einlösen |

## Freunde & Chat
| Methode | Endpunkt | Zweck |
|---|---|---|
| `GET`  | `/api/friends` | Freunde + `pendingIncoming` / `pendingOutgoing` |
| `POST` | `/api/friends/add/request` | Freundschaftsanfrage senden |
| `POST` | `/api/friends/add` | Anfrage annehmen |
| `POST` | `/api/friendsrequest/del` | Ablehnen / zurückziehen / entfreunden |
| `GET`  | `/api/friends/discover` | Vorschläge |
| `POST` | `/api/friends/resolve` | Steam-/Epic-/Xbox-IDs zu VisCode-Konten auflösen |
| `GET`  | `/api/users` | Alle Nutzer (online + aktuelles Spiel) |
| `GET`  | `/api/users/<id>` | Nutzerprofil |
| `GET`  | `/api/users/online` | Nur Online-Nutzer |
| `GET`  | `/api/chat/<freund>` | Chatverlauf |
| `POST` | `/api/chat/set/<freund>/to/<name>` | Spitzname setzen |
| `POST` | `/api/chat/delete/<freund>` | Chat löschen |
| `POST` | `/api/chat/report/<freund>` | Melden |

## Präsenz (online / aktuelles Spiel)
| Methode | Endpunkt | Zweck |
|---|---|---|
| `POST` | `/api/presence` | Status melden: `{ online, game: { title, platform } }` |
| `GET`  | `/api/presence/all` | Alle Präsenzen |

## Family (Bibliothek teilen)
| Methode | Endpunkt | Zweck |
|---|---|---|
| `POST` | `/api/family/create` · `/join` · `/leave` | Familie verwalten |
| `GET`  | `/api/family/mine` · `/api/family/<id>` | Familie abrufen |
| `POST` | `/api/game/launch` · `/api/game/close` | Gleichzeitige Nutzung melden |

## Launcher-Verwaltung
| Methode | Endpunkt | Zweck |
|---|---|---|
| `GET`  | `/api/launcher/status` | Wartung, Mindest-/Neueste-Version |
| `POST` | `/api/launcher/version` | Eigene Version melden (Update-Tracking) |
| `GET`  | `/api/admin/data` | Admin-Daten |
| `POST` | `/api/generate` | Server-Generator |

## Medien (statisch)
```
GET /media/Games/<n>/<gameId>/Media/banner.png · cover.png · mini_banner.png · logo.png
GET /media/Puplisher/<n>/<pubId>/Assets/avatar.png · banner.png
```

---

# 2. Fremdanbieter

## Steam
| Host | Zweck |
|---|---|
| `api.steampowered.com` | Besitz, Freunde, Profile, Spielzeit, Erfolge |
| `store.steampowered.com` | Katalog-Suche, `appdetails`, Bewertungen |
| `steamcommunity.com` | Profilseiten |
| `cdn.cloudflare.steamstatic.com` · `steamcdn-a.akamaihd.net` · `avatars.steamstatic.com` | Bilder |

## Epic Games
| Host | Zweck |
|---|---|
| `account-public-service-prod.ol.epicgames.com` | OAuth / Token |
| `library-service.live.use1a.on.epicgames.com` | Gekaufte Bibliothek |
| `catalog-public-service-prod06.ol.epicgames.com` | Katalog-Metadaten |
| `friends-public-service-prod.ol.epicgames.com` | Freundesliste |
| `store-site-backend-static.ak.epicgames.com` | Gratis-Aktionen |
| `egs-platform-service.store.epicgames.com` | Store-Katalog (Cloudflare-geschützt) |
| `graphql.epicgames.com` · `api.epicgames.dev` | GraphQL / EOS |

## Xbox / Microsoft
| Host | Zweck |
|---|---|
| `login.live.com` | Microsoft-Anmeldung |
| `user.auth.xboxlive.com` · `xsts.auth.xboxlive.com` | Xbox-Token |
| `profile.xboxlive.com` | Profil, Gamerscore |
| `peoplehub.xboxlive.com` · `social.xboxlive.com` | Freunde |
| `titlehub.xboxlive.com` | Gespielte Titel |
| `userpresence.xboxlive.com` | Online-Status |
| `displaycatalog.mp.microsoft.com` | Xbox-Store-Katalog |

## Sonstige
| Host | Zweck |
|---|---|
| `www.gamerpower.com/api` | Gratis-Aktionen & Giveaways |
| `tenor.com` | GIF-Memes (per Web-Abruf, kein Schlüssel) |
| `github.com` | Auto-Updates (`latest.json`, Setup.exe, ZIP) |
| `www.minecraft.net` | Minecraft-Erkennung |
| `ubistatic3-a.akamaihd.net` · `eaassets-a.akamaihd.net` | Ubisoft-/EA-Bilder |

---

# 3. Lokale Schnittstellen

## IPC-Brücke (Renderer ↔ Hauptprozess)
99 Handler, im Renderer als `window.viscode.*` (108 Methoden) erreichbar.
Beispiele: `scanPlatforms`, `steamOwnedMulti`, `epicLogin`, `xboxLibrary`,
`gameDetails`, `checkUpdate`, `socialApi`, `tenorSearch`, `betaNotice`.

## Spiel-Brücke (WebSocket)
```
ws://127.0.0.1:8448
```
Nur lokale Verbindungen ohne `Origin`-Header.

| Richtung | Nachricht | Zweck |
|---|---|---|
| ← | `hello` | Launcher-Version, angemeldeter Nutzer, TURN-Zugangsdaten |
| → | `requestAuth` / `requestLicense` | Aktivierungsschlüssel anfordern |
| ← | `auth` | `{ gameId, userId, username, key }` |
| → | `ping` / ← `pong` | Verbindung halten |
| → | beliebig | Status ans Freunde-/Aktivitätsfenster |

Details: `API_AUTO_LOGIN.md`

---

# Statuscodes

| Code | Bedeutung |
|---|---|
| `200` | ok |
| `401` / `403` | nicht angemeldet oder gesperrt |
| `404` | nicht gefunden (auch bei falscher HTTP-Methode) |
| `426` | Launcher zu alt → Pflichtupdate |
| `500` | Serverfehler |
