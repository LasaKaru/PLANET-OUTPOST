# HELAO2: Planet Outpost

A low-poly sci-fi adventure shooter on a vibrant alien planet — exploration,
missions, base-building, wildlife scanning, secrets, and **co-op multiplayer**.
Built with Three.js (r128) and a tiny Node + `ws` relay server. By **HelaO2 Studio**.

## Play solo (no server needed)

Open `index.html` in any modern browser. Everything except multiplayer works
offline — saves live in your browser's localStorage.

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
| Esc | Pause |

## Project layout

```
index.html      UI markup
css/style.css   HUD + Verdant-style menu
js/game.js      the whole game (world, AI, missions, building, saves)
js/net.js       WebSocket client wrapper
server.js       static file server + co-op relay (ws)
```
