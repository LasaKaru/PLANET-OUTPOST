# HELAO2: Planet Outpost

A low-poly sci-fi adventure shooter on a vibrant alien planet — exploration,
missions, base-building, weapon mods, day/night, a boss & settlements,
wildlife scanning, secrets, New Game+, and **co-op multiplayer**.
Built with Three.js (r128) and a tiny Node + `ws` relay server. By **HelaO2 Studio**.

## Play solo (no server needed)

Open `index.html` in any modern browser. Everything except multiplayer works
offline — saves live in your browser's localStorage.

## Play on mobile (Android / iOS)

Serve the game over http (`node server.js`) and open it in the phone's browser,
then **Add to Home Screen** — it installs as a fullscreen app (PWA) and works
offline after the first load.

On touch devices the game shows on-screen controls automatically:

- **Left thumb** — virtual joystick to move (push to the edge to sprint)
- **Right thumb** — drag anywhere to aim/look
- **FIRE** button, plus **E** interact, **↑** jump / ship-up, **↓** ship-down,
  **⟳** reload, and **B / Q / V** for build / scan / camera
- Top toolbar: journal, inventory, cheat console, pause
- Tap the ammo slots (1–4) to switch weapons

Landscape orientation is recommended (a hint appears in portrait).

## Play multiplayer (co-op)

```bash
npm install
node server.js        # or: npm start
```

Open `http://localhost:3000`, pick **MULTIPLAYER** in the menu, choose a name,
and connect. Friends on your network join via `http://<your-ip>:3000`.

Co-op is *shared-world presence*: every client generates the identical world
from the same seed, and players see each other move and shoot in realtime.
Enemies, missions, and loot are simulated per player.

## Controls

| Key | Action |
| --- | --- |
| WASD / Mouse | Move / Aim |
| Left click | Fire |
| 1–4 / Wheel | Switch weapon |
| R | Reload |
| Space / Shift | Jump / Sprint |
| B | Build mode (1–8 select, scroll rotates) |
| V | Toggle first-person / third-person camera |
| I | Inventory & crafting (H medkit, G ammo pack) |
| P | Photo mode (free camera, F saves a screenshot) |
| E | Interact (camper, pylons, bridge, cache) |
| Q | Scan wildlife |
| Tab / J | Field journal (missions, upgrades, lore) |
| Enter or / | Cheat console (type a code) |
| E | Also boards/exits a nearby rover or spaceship |
| Esc | Pause |

**Vehicles:** a drivable **rover** is parked by the outpost camper and a
**spaceship** sits on the landing pad — press **E** to board, **WASD** to
drive/fly (Space/C raise & lower the ship), **E** to exit.

**Cheat codes** (open the console with **Enter** or **/**): `rover`, `flyme`,
`loaded`, `arsenal`, `boom`, `tank`, `heal`, `sunny`, `spooky`, `horde` (summon an infected horde).

## Project layout

```
index.html      UI markup
css/style.css   HUD + Verdant-style menu
js/game.js      the whole game (world, AI, missions, building, saves)
js/net.js       WebSocket client wrapper
server.js       static file server + co-op relay (ws)
```
