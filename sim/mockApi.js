import { randomUUID } from 'node:crypto';

export const BASE_URL = 'https://mock.yapin.test/api/bot/v1';

const json = (status, body) => new Response(JSON.stringify(body ?? {}), { status, headers: { 'content-type': 'application/json' } });
const now = () => new Date().toISOString();

/**
 * An in-memory stand-in for Yapin's Bot API: one server, a few people, channels and roles.
 * Pass `mock.fetch` as the Client's `fetch`; push events with `emit()`; inspect `requests`.
 */
export class MockYapin {
  constructor() {
    this.ids = {
      bot: randomUUID(), alice: randomUUID(), bob: randomUUID(), carol: randomUUID(),
      server: randomUUID(), general: randomUUID(), botCommands: randomUUID(), lounge: randomUUID(),
      catText: randomUUID(), catVoice: randomUUID(), admin: randomUUID(), tester: randomUUID(), memberRole: randomUUID(),
    };
    const { ids } = this;
    this.users = new Map([
      [ids.bot, { id: ids.bot, username: 'test-bot', display_name: 'Test Bot', bot: true }],
      [ids.alice, { id: ids.alice, username: 'alice', display_name: 'Alice', bot: false, badges: ['early'] }],
      [ids.bob, { id: ids.bob, username: 'bob', display_name: null, bot: false }],
      [ids.carol, { id: ids.carol, username: 'carol', display_name: 'Carol', bot: false }],
    ]);
    this.server = { id: ids.server, name: 'Test Server', owner_id: ids.alice, member_count: 4, icon_path: null };
    this.categories = [
      { id: ids.catText, name: 'Text', position: 0 },
      { id: ids.catVoice, name: 'Voice', position: 1 },
    ];
    this.channels = new Map([
      [ids.general, { id: ids.general, name: 'general', type: 'text', kind: 'text', position: 0, category_id: ids.catText, server_id: ids.server, slowmode: 0 }],
      [ids.botCommands, { id: ids.botCommands, name: 'bot-commands', type: 'text', kind: 'text', position: 1, category_id: ids.catText, server_id: ids.server, slowmode: 5 }],
      [ids.lounge, { id: ids.lounge, name: 'Lounge', type: 'voice', kind: 'voice', position: 2, category_id: ids.catVoice, server_id: ids.server }],
    ]);
    this.roles = [
      { id: ids.admin, name: 'Admin', color: 'ed4245', position: 3, manage_server: true, manage_messages: true, perms: { kick_members: true, ban_members: true, timeout_members: true, manage_roles: true, manage_nicknames: true } },
      { id: ids.tester, name: 'Tester', color: '5865f2', position: 2, manage_server: false, manage_messages: false, perms: {} },
      { id: ids.memberRole, name: 'Member', color: null, position: 1, manage_server: false, manage_messages: false, perms: {} },
    ];
    this.members = new Map([
      [ids.bot, { roles: [ids.admin], nickname: null }],
      [ids.alice, { roles: [ids.admin], nickname: null }],
      [ids.bob, { roles: [ids.tester], nickname: 'Bobby' }],
      [ids.carol, { roles: [ids.memberRole], nickname: null }],
    ]);
    this.voice = [{ channel_id: ids.lounge, user_ids: [ids.bob] }];
    /** channel id → message[] */
    this.messages = new Map([...this.channels.keys()].map((id) => [id, []]));
    /** message id → [{ emoji, user_id }] */
    this.reactions = new Map();
    this.commands = [];

    this.seq = 1000;
    this.events = [];
    this.wake = new Set();
    /** Every request: { method, path, query, body, at } */
    this.requests = [];
    this.waiters = new Set();
  }

  // ── Driving it ────────────────────────────────────────────────────────────

  /** Queues an event for the bot's long poll. Returns the event. */
  emit(type, data, { id = ++this.seq } = {}) {
    this.seq = Math.max(this.seq, id);
    const event = { id, type, data, created_at: now() };
    this.events.push(event);
    for (const wake of this.wake) wake();
    return event;
  }

  /** The id the next emit() will get, for delivering the same event another way (webhooks). */
  peekNextId() {
    return this.seq + 1;
  }

  /** Someone posts a message. Returns the message data (as the bot will see it). */
  say(userId, content, { channelId = this.ids.general, replyTo = null } = {}) {
    const user = this.users.get(userId);
    const message = {
      id: randomUUID(), channel_id: channelId, server_id: this.server.id, channel_name: this.channels.get(channelId)?.name,
      author_id: userId, author: { id: userId, username: user.username, display_name: user.display_name }, author_bot: false,
      content, created_at: now(), edited_at: null, reply_to_id: replyTo, embeds: [], components: [],
      mentioned: content.includes(`<@${this.ids.bot}>`),
    };
    this.messages.get(channelId)?.push(message);
    this.emit('message', message);
    return message;
  }

  /** Someone clicks a button on a bot message. */
  click(userId, message, customId) {
    const user = this.users.get(userId);
    return this.emit('interaction', {
      id: randomUUID(), token: `itok_${randomUUID()}`, type: 'button', custom_id: customId,
      message_id: message.id, channel_id: message.channel_id, server_id: this.server.id,
      user_id: userId, username: user.username, expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
  }

  react(userId, message, emoji) {
    this.#reactionsOf(message.id).push({ emoji, user_id: userId });
    return this.emit('reaction_add', {
      emoji, message_id: message.id, channel_id: message.channel_id, server_id: this.server.id,
      user_id: userId, username: this.users.get(userId).username, message_author_id: message.author_id,
    });
  }

  /** The index to pass as `since` so waitFor only looks at requests made after now. */
  mark() {
    return this.requests.length;
  }

  /** Resolves with the first request (since `since`) matching `test`, or rejects after `timeout` ms. */
  waitFor(test, { since = 0, timeout = 3000, what = 'a matching request' } = {}) {
    const hit = this.requests.slice(since).find(test);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const waiter = {
        check: (request, index) => {
          if (index < since || !test(request)) return;
          clearTimeout(timer);
          this.waiters.delete(waiter);
          resolve(request);
        },
      };
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`Timed out after ${timeout}ms waiting for ${what}`));
      }, timeout);
      this.waiters.add(waiter);
    });
  }

  /** Requests since `since` that match `test`, after letting things settle for `ms`. */
  async collect(test, { since = 0, ms = 300 } = {}) {
    await new Promise((r) => setTimeout(r, ms));
    return this.requests.slice(since).filter(test);
  }

  // ── The fake API ──────────────────────────────────────────────────────────

  fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(new URL(BASE_URL).pathname, '');
    const method = (init.method ?? 'GET').toUpperCase();
    const query = Object.fromEntries(parsed.searchParams);
    let body;
    if (typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    if (!/^Bot yb_/.test(init.headers?.authorization ?? '')) return json(401, { error: 'Missing or bad token' });

    if (method === 'GET' && path === '/events') return this.#events(query, init.signal);

    const request = { method, path, query, body, at: Date.now() };
    const index = this.requests.push(request) - 1;
    const response = this.#route(method, path, query, body);
    queueMicrotask(() => { for (const w of [...this.waiters]) w.check(request, index); });
    return response;
  };

  async #events(query, signal) {
    const after = Number(query.after ?? 0);
    const pending = () => this.events.filter((e) => e.id > after);
    if (Number(query.wait ?? 0) > 0 && !pending().length) {
      await new Promise((resolve, reject) => {
        const done = () => { clearTimeout(timer); this.wake.delete(done); signal?.removeEventListener('abort', onAbort); resolve(); };
        const onAbort = () => { done(); reject(signal.reason ?? new Error('aborted')); };
        const timer = setTimeout(done, 200);
        this.wake.add(done);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
    const events = pending();
    return json(200, { events, last: events.at(-1)?.id ?? Math.max(after, this.seq) });
  }

  #member(userId) {
    const m = this.members.get(userId);
    if (!m) return null;
    return { user: this.users.get(userId), roles: m.roles, nickname: m.nickname, joined_at: '2026-01-01T00:00:00.000Z', timeout: m.timeout ?? null };
  }

  #reactionsOf(messageId) {
    if (!this.reactions.has(messageId)) this.reactions.set(messageId, []);
    return this.reactions.get(messageId);
  }

  #findMessage(channelId, messageId) {
    return this.messages.get(channelId)?.find((m) => m.id === messageId) ?? null;
  }

  #route(method, path, query, body) {
    const { ids } = this;
    const m = (pattern) => {
      const match = new RegExp(`^${pattern.replace(/:\w+/g, '([^/]+)')}$`).exec(path);
      return match ? match.slice(1).map(decodeURIComponent) : null;
    };
    let p;

    if (path === '/me' && method === 'GET') return json(200, { ...this.users.get(ids.bot), bot: { name: 'Test Bot', public: false, owner_id: ids.alice } });
    if (path === '/me/status' && method === 'PUT') return json(200, {});
    if (path === '/commands' && method === 'PUT') { this.commands = body.commands; return json(200, { commands: this.commands }); }
    if (path === '/commands' && method === 'GET') return json(200, { commands: this.commands });

    if (path === '/servers' && method === 'GET') return json(200, { servers: [this.server] });
    if ((p = m('/servers/:id')) && method === 'GET') return p[0] === ids.server ? json(200, { server: this.server }) : json(404, { error: 'Unknown server' });
    if ((p = m('/servers/:id/channels')) && method === 'GET') {
      const channels = [...this.channels.values()].filter((c) => !query.type || c.type === query.type);
      return json(200, { channels, categories: query.type ? [] : this.categories });
    }
    if ((p = m('/servers/:id/roles')) && method === 'GET') return json(200, { roles: this.roles });
    if ((p = m('/servers/:id/members')) && method === 'GET') return json(200, { members: [...this.members.keys()].map((id) => this.#member(id)) });
    if ((p = m('/servers/:id/members/:user')) && method === 'GET') {
      const member = this.#member(p[1]);
      return member ? json(200, { member }) : json(404, { error: 'Not a member' });
    }
    if ((p = m('/servers/:id/members/:user')) && method === 'PATCH') {
      this.members.get(p[1]).nickname = body.nickname ?? null;
      return json(200, {});
    }
    if ((p = m('/servers/:id/members/:user/roles/:role')) && (method === 'PUT' || method === 'DELETE')) {
      const member = this.members.get(p[1]);
      member.roles = method === 'PUT' ? [...new Set([...member.roles, p[2]])] : member.roles.filter((r) => r !== p[2]);
      return json(200, {});
    }
    if ((p = m('/servers/:id/timeouts')) && method === 'POST') {
      this.members.get(body.user_id).timeout = body;
      return json(200, {});
    }
    if ((p = m('/servers/:id/voice')) && method === 'GET') return json(200, { voice: this.voice });
    if ((p = m('/servers/:id/bans')) && method === 'GET') return json(200, { bans: [] });

    if ((p = m('/channels/:id')) && method === 'GET') {
      const channel = this.channels.get(p[0]);
      return channel ? json(200, { channel }) : json(404, { error: 'Unknown channel' });
    }
    if ((p = m('/channels/:id/messages')) && method === 'POST') {
      if (!this.channels.has(p[0])) return json(404, { error: 'Unknown channel' });
      const message = {
        id: randomUUID(), channel_id: p[0], server_id: ids.server, author_id: ids.bot, content: body.content ?? '',
        embeds: body.embeds ?? [], components: body.components ?? [], flags: body.flags ?? 0,
        reply_to_id: body.reply_to ?? null, created_at: now(), edited_at: null,
      };
      this.messages.get(p[0]).push(message);
      return json(200, { message });
    }
    if ((p = m('/channels/:id/messages')) && method === 'GET') {
      let list = this.messages.get(p[0]) ?? [];
      if (query.before) list = list.filter((x) => x.created_at < query.before);
      return json(200, { messages: list.slice(-Number(query.limit ?? 50)), authors: [...this.users.values()] });
    }
    if ((p = m('/channels/:id/messages/bulk-delete')) && method === 'POST') {
      const list = this.messages.get(p[0]) ?? [];
      this.messages.set(p[0], list.filter((x) => !body.ids.includes(x.id)));
      return json(200, { deleted: body.ids, skipped: [] });
    }
    if ((p = m('/channels/:id/messages/:mid')) && method === 'GET') {
      const message = this.#findMessage(p[0], p[1]);
      return message ? json(200, { message, author: this.users.get(message.author_id) }) : json(404, { error: 'Unknown message' });
    }
    if ((p = m('/channels/:id/messages/:mid')) && method === 'PATCH') {
      const message = this.#findMessage(p[0], p[1]);
      if (!message) return json(404, { error: 'Unknown message' });
      for (const key of ['content', 'embeds', 'components']) if (key in body) message[key] = body[key] ?? (key === 'content' ? '' : []);
      if ('flags' in body) message.flags = body.flags;
      message.edited_at = now();
      return json(200, { message });
    }
    if ((p = m('/channels/:id/messages/:mid')) && method === 'DELETE') {
      this.messages.set(p[0], (this.messages.get(p[0]) ?? []).filter((x) => x.id !== p[1]));
      return json(200, {});
    }
    if ((p = m('/channels/:id/messages/:mid/pin')) && (method === 'PUT' || method === 'DELETE')) {
      const message = this.#findMessage(p[0], p[1]);
      if (message) message.pinned_at = method === 'PUT' ? now() : null;
      return json(200, {});
    }
    if ((p = m('/channels/:id/messages/:mid/reactions')) && method === 'GET') return json(200, { reactions: this.#reactionsOf(p[1]) });
    if ((p = m('/channels/:id/messages/:mid/reactions/:emoji')) && method === 'PUT') {
      this.#reactionsOf(p[1]).push({ emoji: p[2], user_id: ids.bot });
      return json(200, {});
    }
    if ((p = m('/channels/:id/messages/:mid/reactions/:emoji')) && method === 'DELETE') {
      this.reactions.set(p[1], this.#reactionsOf(p[1]).filter((r) => !(r.emoji === p[2] && r.user_id === ids.bot)));
      return json(200, {});
    }

    if ((p = m('/users/:id')) && method === 'GET') {
      const user = this.users.get(p[0]);
      return user ? json(200, { user }) : json(404, { error: 'Unknown user' });
    }
    if ((p = m('/interactions/:id/:token/callback')) && method === 'POST') {
      if (body.type === 'update') {
        const message = [...this.messages.values()].flat().find((x) => x.id === this.#interactionMessage(p[0]));
        if (message) for (const key of ['content', 'embeds', 'components']) if (key in body) message[key] = body[key] ?? (key === 'content' ? '' : []);
      }
      return json(200, {});
    }

    return json(404, { error: `The mock has no ${method} ${path}` });
  }

  #interactionMessage(interactionId) {
    return this.events.find((e) => e.type === 'interaction' && e.data.id === interactionId)?.data.message_id ?? null;
  }
}
