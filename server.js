/* =====================================================================
   HELAO2: Low Poly Wilds — game server
   - Serves the static game files over HTTP
   - Relays co-op presence over WebSocket (join/leave/state/fire)
   Run:  npm install && node server.js   →  http://localhost:3000
   ===================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

let WebSocketServer;
try {
  ({ WebSocketServer } = require('ws'));
} catch (e) {
  console.error('The "ws" package is missing. Run:  npm install');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // resolve inside the project root only
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

/* ---------------- WebSocket relay ---------------- */
const wss = new WebSocketServer({ server });
const players = new Map();   // id → {ws, name, color, state}
let nextId = 1;

// suit colors handed out to joining explorers (player default is teal)
const COLORS = [0xe8b93c, 0xe86a9e, 0x5a8fd9, 0xe07b39, 0xd94f8a, 0x7adfc4, 0x9aa3ad];
let colorIdx = 0;

function broadcast(obj, exceptId) {
  const raw = JSON.stringify(obj);
  for (const [id, p] of players)
    if (id !== exceptId && p.ws.readyState === 1) p.ws.send(raw);
}

wss.on('connection', ws => {
  const id = nextId++;
  let joined = false;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'hello' && !joined) {
      joined = true;
      const name = String(msg.name || 'Explorer').slice(0, 14);
      const color = COLORS[colorIdx++ % COLORS.length];
      players.set(id, { ws, name, color, state: null });
      // current roster for the newcomer
      const roster = [];
      for (const [pid, p] of players)
        if (pid !== id) roster.push({ id: pid, name: p.name, color: p.color, state: p.state });
      ws.send(JSON.stringify({ t: 'welcome', id, players: roster }));
      broadcast({ t: 'join', id, name, color }, id);
      console.log(`[+] #${id} ${name} joined (${players.size} online)`);
    } else if (msg.t === 's' && joined) {
      const p = players.get(id);
      if (p) p.state = { p: msg.p, y: msg.y, mv: msg.mv, wp: msg.wp };
      broadcast({ t: 's', id, p: msg.p, y: msg.y, mv: msg.mv, wp: msg.wp }, id);
    } else if (msg.t === 'fire' && joined) {
      broadcast({ t: 'fire', id, a: msg.a, b: msg.b, c: msg.c }, id);
    }
  });

  ws.on('close', () => {
    if (players.delete(id)) {
      broadcast({ t: 'leave', id });
      console.log(`[-] #${id} left (${players.size} online)`);
    }
  });
  ws.on('error', () => {});
});

// heartbeat keeps half-open sockets from lingering
setInterval(() => {
  for (const [, p] of players)
    if (p.ws.readyState === 1) p.ws.ping();
}, 30000);

server.listen(PORT, () => {
  console.log('HELAO2: Low Poly Wilds server');
  console.log(`  play  → http://localhost:${PORT}`);
  console.log('  co-op → share http://<your-ip>:' + PORT + ' on your network');
});
