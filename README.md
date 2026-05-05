# ⚔️ Rathering-Game

Echtzeit-Multiplayer-Voting-Spiel im Browser.

## Setup

```bash
npm install
npm run dev      # mit nodemon (auto-restart)
# oder:
npm start        # ohne auto-restart
```

Dann öffne: http://localhost:3000

## Spielablauf

1. **Host** erstellt ein Spiel → bekommt 6-stelligen Code
2. **Spieler** geben Code + Namen ein → landen in der Lobby
3. Host drückt **"Spiel starten"**
4. Alle laden ihr **Foto** hoch + kurze Beschreibung
5. Host startet das **Battle**
6. Alle sehen dasselbe Bilderpaar und klicken auf ihren Favoriten
7. Nach allen Runden: **Siegerpodest** mit Platz 1, 2, 3

## Deployment auf Render.com (kostenlos)

1. Code auf GitHub pushen
2. Render.com → "New Web Service" → GitHub-Repo verbinden
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Done! 🎉

## Dateistruktur

```
rathering-game/
├── server/
│   ├── index.js       ← Express + Socket.io
│   └── gameLogic.js   ← Spiellogik (Rooms, Voting)
├── public/
│   ├── index.html     ← Startseite
│   ├── lobby.html     ← Warteraum
│   ├── upload.html    ← Foto hochladen
│   ├── battle.html    ← Voting
│   ├── results.html   ← Siegerpodest
│   ├── style.css      ← Globale Styles
│   └── shared.js      ← Utilities (Sound, Toast, Session)
└── package.json
```

## Hinweise

- Hochgeladene Bilder liegen in `public/uploads/` (werden nicht automatisch gelöscht)
- Für Production: Bilder auf Cloudinary o.ä. auslagern
- Socket.io hält alle Verbindungen im RAM — bei Server-Neustart gehen laufende Spiele verloren
