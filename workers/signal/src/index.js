// 線上房間的「配對服務」（Cloudflare Workers 免費方案）。
//
// 線上房間是 P2P：開房者的瀏覽器就是伺服器，其他人用 WebRTC 直接連過去。
// 兩邊第一次連線前要交換連線資訊（WebRTC 的 offer / answer / ICE），這個服務只負責轉送這些小訊息，
// 比賽本身完全不經過這裡。每個房號是一個 Durable Object，用 WebSocket（可休眠，沒訊息時不計費）。
//
//   房主：wss://…/r/{房號}/host?key={房主密鑰}   → 收到 join / signal / leave
//   加入：wss://…/r/{房號}/guest                → 收到 welcome / signal / error
//   房主送 { to: 客人id, data }，客人送 { data }，對方收到 { type: 'signal', from?, data }
//
// 免費方案超過每日額度只會報錯，不會收費。
import { DurableObject } from 'cloudflare:workers';

const CODE = /^[A-Z0-9]{5}$/;
const MAX_GUESTS = 12;
const MAX_MESSAGE = 16 * 1024;

const cors = { 'Access-Control-Allow-Origin': '*' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok', { headers: cors });
    const m = /^\/r\/([A-Za-z0-9]{5})\/(host|guest)$/.exec(url.pathname);
    if (!m) return new Response('not found', { status: 404, headers: cors });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('需要 WebSocket', { status: 426, headers: cors });
    const code = m[1].toUpperCase();
    if (!CODE.test(code)) return new Response('房號格式錯誤', { status: 400, headers: cors });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    return stub.fetch(request);
  },
};

export class SignalRoom extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const role = url.pathname.endsWith('/host') ? 'host' : 'guest';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (role === 'host') {
      const key = url.searchParams.get('key') || '';
      if (key.length < 16) return reject(pair, '房主密鑰錯誤');
      const current = this.hosts();
      const owner = await this.ctx.storage.get('key');
      // 房號被別人（不同密鑰）用著：請房主換一個房號
      if (current.length && owner !== key) return reject(pair, 'taken');
      for (const old of current) old.close(4000, '房主從別的地方重新連線');
      await this.ctx.storage.put('key', key);
      this.ctx.acceptWebSocket(server, ['host']);
      server.serializeAttachment({ role: 'host' });
    } else {
      const host = this.hosts()[0];
      if (!host) return reject(pair, 'no_host');
      if (this.ctx.getWebSockets('guest').length >= MAX_GUESTS) return reject(pair, '房間的連線已滿');
      const id = crypto.randomUUID().slice(0, 8);
      this.ctx.acceptWebSocket(server, ['guest', `g:${id}`]);
      server.serializeAttachment({ role: 'guest', id });
      server.send(JSON.stringify({ type: 'welcome', id }));
      host.send(JSON.stringify({ type: 'join', id }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  hosts() {
    return this.ctx.getWebSockets('host');
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    const me = ws.deserializeAttachment() || {};
    if (me.role === 'host') {
      if (typeof m.to !== 'string') return;
      for (const g of this.ctx.getWebSockets(`g:${m.to}`)) g.send(JSON.stringify({ type: 'signal', data: m.data }));
    } else {
      for (const h of this.hosts()) h.send(JSON.stringify({ type: 'signal', from: me.id, data: m.data }));
    }
  }

  async webSocketClose(ws) {
    this.gone(ws);
  }

  async webSocketError(ws) {
    this.gone(ws);
  }

  gone(ws) {
    const me = ws.deserializeAttachment() || {};
    if (me.role === 'guest') {
      for (const h of this.hosts()) h.send(JSON.stringify({ type: 'leave', id: me.id }));
    } else if (me.role === 'host' && !this.hosts().some((h) => h !== ws)) {
      // 房主走了：還在配對中的客人就不用等了
      for (const g of this.ctx.getWebSockets('guest')) {
        g.send(JSON.stringify({ type: 'error', message: 'no_host' }));
        g.close(4001, 'no_host');
      }
    }
  }
}

function reject(pair, message) {
  const [client, server] = Object.values(pair);
  server.accept();
  server.send(JSON.stringify({ type: 'error', message }));
  server.close(4001, message.slice(0, 100));
  return new Response(null, { status: 101, webSocket: client });
}
