/* =====================================================================
   HELAO2: Low Poly Wilds — WebSocket client wrapper
   Tiny relay protocol (JSON messages, each with a `t` type field):
     hello   client → server  { t:'hello', name }
     welcome server → client  { t:'welcome', id, players:[{id,name,color,state}] }
     join    server → all     { t:'join', id, name, color }
     leave   server → all     { t:'leave', id }
     s       relayed state    { t:'s', id, p:[x,y,z], y, mv, wp }
     fire    relayed tracer   { t:'fire', id, a:[..], b:[..], c }
   The game registers handlers with Net.on(type, fn). `_close` fires on
   disconnect. Net is a no-op while offline, so solo play never breaks.
   ===================================================================== */
window.Net = (function () {
  'use strict';
  let ws = null, isOpen = false;
  const handlers = {};

  function connect(url, onOpen, onError) {
    close();
    try { ws = new WebSocket(url); }
    catch (e) { if (onError) onError(e); return; }
    let settled = false;
    ws.onopen = () => { isOpen = true; settled = true; if (onOpen) onOpen(); };
    ws.onerror = () => { if (!settled) { settled = true; if (onError) onError(); } };
    ws.onclose = () => {
      const wasOpen = isOpen;
      isOpen = false; ws = null;
      if (!settled) { settled = true; if (onError) onError(); }
      else if (wasOpen && handlers['_close']) handlers['_close']({});
    };
    ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg && msg.t && handlers[msg.t]) handlers[msg.t](msg);
    };
  }
  function on(type, fn) { handlers[type] = fn; }
  function send(obj) {
    if (isOpen && ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }
  function close() {
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    isOpen = false;
  }
  return { connect, on, send, close, get connected() { return isOpen; } };
})();
