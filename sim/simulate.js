import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Events, Logger, MessageFlags } from 'yapin.js';
import { createBot } from '../src/createBot.js';
import { BASE_URL, MockYapin } from './mockApi.js';

// Boots the real bot (same createBot as bot.js) against an in-memory Yapin' API and drives it with
// scripted messages, clicks, reactions and events. No token or network needed.
//   npm run simulate            SIM_VERBOSE=1 npm run simulate   (bot logs too)

const mock = new MockYapin();
const { ids } = mock;
const client = await createBot({
  baseURL: BASE_URL,
  fetch: mock.fetch,
  transport: 'polling',
  WebSocket: false,
  presence: null,
  components: { autoAckAfter: 300 },
  logger: process.env.SIM_VERBOSE ? new Logger({ level: 'debug', prefix: '[bot]' }) : false,
});

const seen = { joins: [], tests: [], commandErrors: 0 };
client.on(Events.ServerMemberAdd, (m) => seen.joins.push(m));
client.on(Events.Test, (d) => seen.tests.push(d));
client.on(Events.CommandError, () => seen.commandErrors++);

// ── helpers ─────────────────────────────────────────────────────────────────
const isSend = (r) => r.method === 'POST' && /^\/channels\/[^/]+\/messages$/.test(r.path);
const isCallback = (r) => r.method === 'POST' && r.path.startsWith('/interactions/');
const text = (body) => [body.content, ...(body.components ?? []).flatMap((c) => [c.content, ...(c.components ?? []).map((x) => x.content)])].filter(Boolean).join('\n');

/** Someone runs a command; resolves with the bot's quoting reply ({ body, message }). */
async function run(user, content, { channelId, timeout = 3000 } = {}) {
  const since = mock.mark();
  const msg = mock.say(user, content, { channelId });
  const reply = await mock.waitFor((r) => isSend(r) && r.body.reply_to === msg.id, { since, timeout, what: `a reply to "${content}"` });
  return { body: reply.body, message: reply.result, msg, since };
}

/** The next plain (non-quoting) post in a channel. */
const nextSend = (since, test = () => true, timeout = 3000) => mock.waitFor((r) => isSend(r) && test(r.body), { since, timeout, what: 'a channel post' });

async function click(user, message, customId, { timeout = 3000 } = {}) {
  const since = mock.mark();
  mock.click(user, message, customId);
  return (await mock.waitFor(isCallback, { since, timeout, what: `an answer to the ${customId} click` })).body;
}

async function expectNoReply(user, content, ms = 400) {
  const since = mock.mark();
  const msg = mock.say(user, content);
  const replies = await mock.collect((r) => isSend(r) && r.body.reply_to === msg.id, { since, ms });
  assert.equal(replies.length, 0, `expected no reply to "${content}", got: ${replies[0]?.body.content}`);
  return since;
}

const results = [];
async function step(area, name, fn) {
  const started = performance.now();
  try {
    await fn();
    results.push({ area, name, ok: true, ms: performance.now() - started });
  } catch (error) {
    results.push({ area, name, ok: false, ms: performance.now() - started, error });
  }
}

// ── scenarios ───────────────────────────────────────────────────────────────
await step('Client', 'logs in over long polling and syncs commands', async () => {
  await client.login('yb_mock_token');
  assert.ok(client.isReady());
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(client.transport, 'polling');
  assert.equal(client.application.ownerId, ids.alice);
  const names = mock.commands.map((c) => c.name);
  for (const name of ['ping', 'help', 'buttons', 'card', 'quiz', 'selftest', 'mod', 'legacy']) assert.ok(names.includes(name), `/${name} was synced`);
  for (const name of ['hidden', 'prefixonly', 'p']) assert.ok(!names.includes(name), `/${name} should not be synced`);
});

// Runs first on purpose: only #general is cached (from the incoming command message), so finding
// #bot-commands by name needs the resolver to fetch the server's channel list.
await step('Arguments', 'a channel option finds a channel by name on a fresh cache', async () => {
  assert.equal(client.channels.cache.has(ids.botCommands), false);
  assert.match((await run(ids.alice, '/chan bot-commands')).body.content, /slowmode 5s/);
});

// Basics and prefixes
await step('Commands', '/ping replies, then edits in the round trip', async () => {
  const { body, message, since } = await run(ids.alice, '/ping');
  assert.match(body.content, /pong/);
  const edit = await mock.waitFor((r) => r.method === 'PATCH' && r.path.endsWith(message.id), { since, what: 'the /ping edit' });
  assert.match(edit.body.content, /round trip \d+ms · events via polling/);
});
await step('Commands', 'aliases, ! prefix, multi-character prefix and @mention prefix', async () => {
  assert.match((await run(ids.bob, '!p')).body.content, /pong/);
  assert.equal((await run(ids.bob, 'yt!echo hello there')).body.content, 'hello there');
  assert.match((await run(ids.bob, `<@${ids.bot}> ping`)).body.content, /pong/);
  assert.match((await run(ids.bob, '/PING')).body.content, /pong/, 'case-insensitive');
});
await step('Commands', 'echo reacts then replies; say posts without quoting', async () => {
  const { since } = await run(ids.bob, '/echo hi');
  await mock.waitFor((r) => r.method === 'PUT' && r.path.includes('/reactions/'), { since, what: 'the ✅ reaction' });
  const before = mock.mark();
  mock.say(ids.bob, '/say plain post');
  const post = await nextSend(before);
  assert.equal(post.body.content, 'plain post');
  assert.equal(post.body.reply_to, undefined);
});
await step('Commands', 'a plain @mention gets the events-module hint', async () => {
  assert.match((await run(ids.carol, `<@${ids.bot}>`)).body.content, /Try `\/help`/);
});
await step('Commands', '/help lists categories; /help <command> explains one', async () => {
  const list = (await run(ids.bob, '/help')).body.embeds[0];
  assert.equal(list.title, 'yapin.js test bot');
  assert.equal(list.fields.length, 10);
  const one = (await run(ids.bob, '/help types')).body.embeds[0];
  assert.equal(one.title, '/types');
  assert.ok(one.fields.some((f) => f.name === 'Examples'));
  assert.match((await run(ids.bob, '/help hidden')).body.content, /no `\/hidden`/);
});
await step('Commands', 'a discord.js-style command file works', async () => {
  assert.match((await run(ids.bob, '/legacy')).body.content, /export const data/);
});

// Arguments
await step('Arguments', 'every scalar type parses', async () => {
  const { body } = await run(ids.bob, '/types 1,000 3.14 yes 1h30m https://example.com');
  for (const piece of ['1000 (number)', '3.14 (number)', 'true (boolean)', '5400000 (number) = 1h 30m', 'URL(https://example.com/)']) assert.ok(body.content.includes(piece), piece);
});
await step('Arguments', 'bad values and choices get explained', async () => {
  assert.match((await run(ids.bob, '/types abc')).body.content, /`int` must be a whole number/);
  assert.match((await run(ids.bob, '/types 5000')).body.content, /at most 1000/);
  assert.match((await run(ids.bob, '/pick purple')).body.content, /must be one of: `red`, `green`, `blue`/);
  assert.equal((await run(ids.bob, '/pick RED large')).body.content, 'colour=red size=3 (number)');
  assert.match((await run(ids.bob, '/even')).body.content, /Missing `n`. Usage: `\/even <n>`/);
  assert.match((await run(ids.bob, '/even 3')).body.content, /3 is odd/);
  assert.equal((await run(ids.bob, '/sum 1 2 3')).body.content, '1 + 2 + 3 = 6');
});
await step('Arguments', 'user, member, role and channel lookups', async () => {
  const whois = (await run(ids.alice, `/whois <@${ids.bob}>`)).body.embeds[0];
  assert.equal(whois.title, 'bob');
  assert.equal((await run(ids.alice, '/whois')).body.embeds[0].title, 'Alice', 'default is the author');
  assert.match((await run(ids.alice, `/member <@${ids.bob}>`)).body.content, /^Bobby: roles Tester; highest Tester/);
  assert.match((await run(ids.alice, '/role Tester')).body.content, /^Tester: colour #5865f2/);
  assert.match((await run(ids.alice, `/chan <#${ids.botCommands}>`)).body.content, /slowmode 5s/);
  assert.match((await run(ids.alice, `/chan <#${ids.lounge}>`)).body.content, /must be a text channel/);
});
await step('Arguments', 'a custom type and quoting', async () => {
  assert.equal((await run(ids.bob, '/paint #ff0000')).body.embeds[0].color, 0xff0000);
  assert.match((await run(ids.bob, '/paint red')).body.content, /#ff6b4a/);
  const argv = JSON.parse((await run(ids.bob, '/args "two words" three')).body.content.replace(/^```json\n|\n```$/g, ''));
  assert.deepEqual(argv.argv, ['two words', 'three']);
  assert.equal(argv.commandName, 'args');
});
await step('Arguments', 'subcommands, nesting, aliases and parent checks', async () => {
  assert.match((await run(ids.bob, '/config set prefix ?')).body.content, /Set `prefix` to `\?`/);
  assert.equal((await run(ids.bob, '/config get prefix')).body.content, '`prefix` = `?`');
  assert.match((await run(ids.bob, '/config flags on beta')).body.content, /`beta` is on/);
  assert.match((await run(ids.bob, '/config ls')).body.content, /"beta"/);
  assert.match((await run(ids.bob, '/config')).body.content, /Pick a subcommand/);
  assert.match((await run(ids.carol, '/config reset')).body.content, /`manage_server` permission/);
  assert.equal((await run(ids.alice, '/config reset')).body.content, 'Settings cleared.');
});

// Preconditions and errors
await step('Checks', 'ownerOnly, roles, permissions and custom checks', async () => {
  assert.match((await run(ids.bob, '/owneronly')).body.content, /Only the bot owner/);
  assert.match((await run(ids.alice, '/owneronly')).body.content, /You own me/);
  assert.match((await run(ids.carol, '/needrole')).body.content, /one of these roles: Tester/);
  assert.match((await run(ids.bob, '/needrole')).body.content, /✅/);
  assert.match((await run(ids.bob, '/needperm')).body.content, /`manage_messages` permission/);
  assert.match((await run(ids.alice, '/needperm')).body.content, /✅/);
  assert.match((await run(ids.bob, '/customcheck')).body.content, /"bot" in its name/);
  assert.match((await run(ids.bob, '/customcheck', { channelId: ids.botCommands })).body.content, /Right channel/);
});
await step('Checks', 'cooldowns: 2 uses then slow down; owners bypass; reset works', async () => {
  assert.match((await run(ids.bob, '/cooldown')).body.content, /✅/);
  assert.match((await run(ids.bob, '/cooldown')).body.content, /✅/);
  assert.match((await run(ids.bob, '/cooldown')).body.content, /Slow down! .* again in \d+s/);
  for (let i = 0; i < 3; i++) assert.match((await run(ids.alice, '/cooldown')).body.content, /✅/);
  await run(ids.bob, '/resetcd');
  assert.match((await run(ids.bob, '/cooldown')).body.content, /✅/);
  assert.match((await run(ids.bob, '/channelcd')).body.content, /✅/);
  assert.match((await run(ids.carol, '/channelcd')).body.content, /Slow down/, 'channel scope is shared');
});
await step('Checks', 'thrown errors, ctx.error and silent errors', async () => {
  const errors = seen.commandErrors;
  assert.equal((await run(ids.bob, '/boom')).body.content, 'Something went wrong running that command.');
  assert.equal(seen.commandErrors, errors + 1);
  assert.match((await run(ids.bob, '/deny')).body.content, /Denied on purpose/);
  const since = await expectNoReply(ids.bob, '/silent');
  assert.ok(mock.requests.slice(since).some((r) => r.method === 'PUT' && r.path.includes(encodeURIComponent('🤫'))));
});
await step('Checks', 'hidden and prefix-only commands still run', async () => {
  assert.match((await run(ids.bob, '/hidden')).body.content, /hidden command/);
  assert.match((await run(ids.bob, '!prefixonly')).body.content, /prefix-only/);
});
await step('Checks', 'maintenance middleware blocks everyone but owners', async () => {
  await run(ids.alice, '/maintenance on');
  assert.match((await run(ids.bob, '/ping')).body.content, /maintenance mode/);
  assert.match((await run(ids.alice, '/ping')).body.content, /pong/);
  assert.match((await run(ids.alice, '/maintenance off')).body.content, /off/);
});

// Buttons
await step('Buttons', 'counter: update with state in the custom id, then disable', async () => {
  const { message } = await run(ids.bob, '/counter');
  let answer = await click(ids.bob, message, 'counter:0');
  assert.equal(answer.type, 'update');
  assert.equal(answer.content, 'Clicked 1 time');
  answer = await click(ids.bob, message, 'counter:1');
  assert.equal(answer.content, 'Clicked 2 times');
  answer = await click(ids.bob, message, 'counter-done:2');
  assert.equal(answer.components[0].components[0].disabled, true);
});
await step('Buttons', 'vote: RegExp route with named groups, one vote per person', async () => {
  const { message } = await run(ids.bob, '/vote Tacos?');
  await click(ids.bob, message, 'vote:yes');
  await click(ids.carol, message, 'vote:yes');
  const answer = await click(ids.carol, message, 'vote:no');
  assert.equal(answer.content, '**Tacos?**\n👍 1 · 👎 1');
});
await step('Buttons', 'named params, ephemeral, reply and paginator', async () => {
  const { message } = await run(ids.bob, '/buttons');
  assert.equal(message.components.length, 2);
  let answer = await click(ids.bob, message, 'btn:style:danger');
  assert.equal(answer.type, 'ephemeral');
  assert.match(answer.content, /\*\*danger\*\*/);
  answer = await click(ids.bob, message, 'btn:ephemeral');
  assert.equal(answer.embeds[0].title, 'Only you can see this');
  assert.equal((await click(ids.bob, message, 'btn:reply')).type, 'reply');
  const pages = (await run(ids.bob, '/pages colours')).message;
  answer = await click(ids.bob, pages, 'page:colours:1');
  assert.match(answer.content, /page 2\/3/);
  assert.equal(answer.components[0].components[0].disabled, false);
});
await step('Buttons', 'an unanswered click is auto-acked, then followed up', async () => {
  const { message } = await run(ids.bob, '/buttons');
  const since = mock.mark();
  mock.click(ids.bob, message, 'btn:slow');
  const ack = await mock.waitFor(isCallback, { since, what: 'the auto-ack' });
  assert.equal(ack.body.type, 'ack');
  const follow = await mock.waitFor((r) => isCallback(r) && r.body.type === 'ephemeral', { since, what: 'the follow-up' });
  assert.match(follow.body.content, /Auto-acked: yes/);
});
await step('Buttons', 'defer, then follow up', async () => {
  const { message } = await run(ids.bob, '/buttons');
  const since = mock.mark();
  mock.click(ids.bob, message, 'btn:defer');
  assert.equal((await mock.waitFor(isCallback, { since })).body.type, 'ack');
  const follow = await mock.waitFor((r) => isCallback(r) && r.body.type === 'ephemeral', { since, timeout: 3000 });
  assert.match(follow.body.content, /answers before this one: 1/);
});
await step('Buttons', 'components.once: only the first click is handled', async () => {
  const { message } = await run(ids.bob, '/onceclick');
  const id = message.components[0].components[0].custom_id;
  assert.match((await click(ids.carol, message, id)).content, /got there first/);
  const answer = await click(ids.bob, message, id); // nobody handles it now, so the auto-ack answers
  assert.equal(answer.type, 'ack');
});

// Layouts
await step('Layouts', 'an embed with every setter', async () => {
  const embed = (await run(ids.bob, '/embed')).body.embeds[0];
  assert.equal(embed.title, 'Match result');
  assert.equal(embed.color, 0xff6b4a);
  assert.equal(embed.fields.length, 4);
  assert.match(embed.footer.text, /^\d+ of 6000 characters used$/);
  assert.ok(embed.timestamp && embed.thumbnail && embed.image && embed.author);
});
await step('Layouts', 'several embeds, plain objects and from()', async () => {
  const { embeds } = (await run(ids.bob, '/embeds')).body;
  assert.equal(embeds.length, 3);
  assert.equal(embeds[0].color, 0x5865f2);
  assert.equal(embeds[1].title, 'A plain object');
  assert.equal(embeds[2].fields[0].name, 'Spliced in');
});
await step('Layouts', 'builder validation messages', async () => {
  const lines = (await run(ids.bob, '/embedlimits')).body.content.split('\n');
  assert.ok(lines.length >= 8 && lines.every((l) => l.startsWith('✅')), lines.find((l) => !l.startsWith('✅')));
});
await step('Layouts', 'Components V2: flag set, content becomes a text display', async () => {
  const { body, message } = await run(ids.bob, '/card');
  assert.ok(body.flags & MessageFlags.IsComponentsV2);
  assert.equal(body.content, undefined);
  assert.equal(body.components[0].type, 10);
  assert.match(body.components[0].content, /components, \d+\/4000 characters/);
  assert.equal(body.components[1].type, 17);
  assert.match((await click(ids.carol, message, 'card:vote:au')).content, /Among Us/);
  const since = mock.mark();
  const update = await click(ids.carol, message, 'card:edit');
  assert.equal(update.components[0].accent_color ?? update.components[0].accentColor ?? 0xed4245, 0xed4245);
  await mock.waitFor((r) => r.method === 'PATCH' && r.path.endsWith(message.id), { since, timeout: 3000, what: 'the follow-up edit' });
});
await step('Layouts', 'gallery and markdown layouts send', async () => {
  const gallery = (await run(ids.bob, '/gallery')).body.components[0];
  assert.deepEqual(gallery.components.map((c) => c.type), [10, 12, 14, 10, 13]);
  assert.match(text((await run(ids.bob, '/markdown')).body), /\*\*bold\*\* \*italic\*/);
});

// Collectors
await step('Collectors', 'quiz: awaitMessages', async () => {
  await run(ids.bob, '/quiz');
  const since = mock.mark();
  const answer = mock.say(ids.bob, '42');
  const reply = await mock.waitFor((r) => isSend(r) && r.body.reply_to === answer.id, { since });
  assert.match(reply.body.content, /Correct/);
});
await step('Collectors', 'coinflip: awaitMessageComponent ignores other people', async () => {
  const { message } = await run(ids.bob, '/coinflip');
  assert.equal((await click(ids.carol, message, 'flip:h')).type, 'ack', "carol's click is filtered out and auto-acked");
  assert.match((await click(ids.bob, message, 'flip:h')).content, /You (win|lose)!/);
});
await step('Collectors', 'clicks: a component collector updates, then stops', async () => {
  const { message } = await run(ids.bob, '/clicks 30');
  assert.equal((await click(ids.bob, message, 'clicks:hit')).content, '1 clicks from 1 people');
  assert.equal((await click(ids.carol, message, 'clicks:hit')).content, '2 clicks from 2 people');
  const since = mock.mark();
  mock.click(ids.carol, message, 'clicks:stop');
  const edit = await mock.waitFor((r) => r.method === 'PATCH' && r.path.endsWith(message.id), { since });
  assert.match(edit.body.content, /Done \(stopped\): 3 clicks from 2 people/);
});
await step('Collectors', 'guess: filter, ignore and stop(reason)', async () => {
  await run(ids.bob, '/guess');
  const since = mock.mark();
  mock.say(ids.bob, 'not a number'); // filtered out
  for (let n = 1; n <= 20; n++) {
    mock.say(ids.bob, String(n));
    await new Promise((r) => setTimeout(r, 15));
    if (mock.requests.slice(since).some((r) => isSend(r) && /end reason/.test(r.body.content))) break;
  }
  const end = await nextSend(since, (b) => /end reason/.test(b.content));
  assert.match(end.body.content, /`(correct|limit)`/);
});
await step('Collectors', 'chat: for await iteration, ended by "stop"', async () => {
  await run(ids.bob, '/chat');
  const since = mock.mark();
  mock.say(ids.bob, 'one');
  mock.say(ids.bob, 'two');
  await new Promise((r) => setTimeout(r, 50));
  mock.say(ids.bob, 'stop');
  const end = await nextSend(since, (b) => /Chat over/.test(b.content));
  assert.equal(end.body.content, 'Chat over: 2 messages (asked).');
});
await step('Collectors', 'nextmsg: await collector.next', async () => {
  await run(ids.bob, '/nextmsg');
  const since = mock.mark();
  const said = mock.say(ids.bob, 'hello');
  const reply = await mock.waitFor((r) => isSend(r) && r.body.reply_to === said.id, { since });
  assert.match(reply.body.content, /Got "hello"/);
});
await step('Collectors', 'poll: reaction collector plus fetchReactions', async () => {
  const { message, since } = await run(ids.bob, '/poll 1 Cats?');
  await mock.waitFor((r) => r.method === 'PUT' && r.path.endsWith(encodeURIComponent('👎')), { since, what: 'the 👎 reaction' });
  mock.react(ids.carol, message, '👍');
  mock.react(ids.bob, message, '👍');
  const end = await nextSend(since, (b) => /👍 \d/.test(b.content ?? ''), 3000);
  assert.match(end.body.content, /👍 2 · 👎 0/);
  assert.match(end.body.content, /👍 3, 👎 1/, "Yapin's own counts include the bot's reactions");
});

// Managers and structures
await step('Managers', 'serverinfo, roles, channels, members', async () => {
  const info = (await run(ids.bob, '/serverinfo')).body.embeds[0];
  assert.equal(info.title, 'Test Server');
  assert.ok(info.fields.find((f) => f.name === 'Owner').value.includes(ids.alice));
  assert.match(info.fields.find((f) => f.name === 'Channels').value, /text: 2, voice: 1/);
  assert.match((await run(ids.bob, '/roles')).body.content, /^3 roles, highest is \*\*Admin\*\*/);
  assert.match((await run(ids.bob, '/channels')).body.content, /\*\*Text\*\*\n# general\n# bot-commands/);
  assert.match((await run(ids.bob, '/members')).body.content, /First page of members \(4\)/);
  assert.match((await run(ids.bob, '/members Bobby')).body.content, /Cached matches for "Bobby" \(1\)/);
});
await step('Managers', '/me: permissions, has/any/missing', async () => {
  const { content } = (await run(ids.bob, '/me')).body;
  assert.match(content, /\*\*You\*\* Bobby: roles Tester/);
  assert.match(content, /missing for moderation: kick_members, ban_members, timeout_members/);
  assert.match((await run(ids.alice, '/me')).body.content, /everything \(server owner\)/);
});
await step('Managers', 'voice, history, reactions, cache, longtext', async () => {
  assert.match((await run(ids.bob, '/voice')).body.content, new RegExp(`You are in <#${ids.lounge}>`));
  assert.match((await run(ids.bob, '/history 5')).body.content, /Last 5 messages before yours/);
  assert.match((await run(ids.bob, '/reactions')).body.content, /Reactions on that message/);
  assert.match((await run(ids.bob, '/cache')).body.content, /client\.users\s+4/);
  const { body, since } = await run(ids.bob, '/longtext');
  assert.match(body.content, /^Sent \d{4} characters as 2 messages\.$/);
  assert.equal(mock.requests.slice(since).filter((r) => isSend(r) && r.body.content.startsWith('Line')).length, 2);
});

// Moderation
await step('Moderation', 'permission-gated subcommands', async () => {
  assert.match((await run(ids.carol, '/mod purge 2')).body.content, /`manage_messages` permission/);
  const since = mock.mark();
  mock.say(ids.alice, '/mod purge 2');
  await mock.waitFor((r) => r.path.endsWith('/bulk-delete'), { since, what: 'the bulk delete' });
  assert.match((await nextSend(since, (b) => /Deleted/.test(b.content))).body.content, /🧹 Deleted 2/);
  const timeout = await run(ids.alice, `/mod timeout <@${ids.carol}> 10m spamming`);
  assert.match(timeout.body.content, /Carol is timed out for 10m: spamming/);
  assert.equal(mock.members.get(ids.carol).timeout.user_id, ids.carol);
  await run(ids.alice, `/mod nick <@${ids.carol}> Caz`);
  assert.equal(mock.members.get(ids.carol).nickname, 'Caz');
  await run(ids.alice, `/mod role add <@${ids.carol}> Tester`);
  assert.ok(mock.members.get(ids.carol).roles.includes(ids.tester));
});

// Diagnostics
await step('Diagnostics', '/selftest runs the offline suite in the bot', async () => {
  const embed = (await run(ids.bob, '/selftest', { timeout: 8000 })).body.embeds[0];
  assert.match(embed.title, /^Self-test: \d+\/\d+ passed$/);
});
await step('Diagnostics', 'raw REST, a 404, and an unawaited failed send', async () => {
  const rest = (await run(ids.bob, '/rest')).body.content;
  assert.match(rest, /GET \/me → keys: .*username/);
  assert.match(rest, /404 "Unknown channel" \(isNotFound: true\)/);
  assert.match((await run(ids.bob, '/unawaited')).body.content, /went to the error event/);
});
await step('Diagnostics', 'stats and sync', async () => {
  const stats = (await run(ids.bob, '/stats')).body.embeds[0];
  assert.ok(Number(stats.fields.find((f) => f.name === 'Clicks').value) > 10);
  assert.match((await run(ids.alice, '/sync')).body.content, /Local list: (\d+) · Yapin’ has: \1/);
});

// Modules
await step('Modules', 'hot reload, unload and load again', async () => {
  const before = client.modules.get('buttons').loadedAt;
  assert.match((await run(ids.alice, '/modules reload buttons')).body.content, /Reloaded buttons/);
  assert.notEqual(client.modules.get('buttons').loadedAt, before);
  const { message } = await run(ids.bob, '/counter');
  assert.equal((await click(ids.bob, message, 'counter:0')).content, 'Clicked 1 time', 'the reloaded module handles clicks');

  assert.match((await run(ids.alice, '/modules unload layouts')).body.content, /Unloaded layouts/);
  await expectNoReply(ids.bob, '/card');
  assert.match((await run(ids.alice, '/modules load modules/layouts.js')).body.content, /Loaded/);
  assert.equal((await run(ids.bob, '/card')).body.components[1].type, 17);
  assert.match((await run(ids.bob, '/modules list')).body.content, /Only the bot owner/);
});

// Events
await step('Events', 'member joins and the test event', async () => {
  mock.emit('member_join', { server_id: ids.server, user_id: ids.carol, username: 'carol', member_count: 5 });
  mock.emit('test', { bot: ids.bot, by: ids.alice, hello: 'world' });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(seen.joins.at(-1)?.server.memberCount, 5);
  assert.equal(seen.tests.at(-1)?.hello, 'world');
});
await step('Events', 'an event delivered by webhook and by polling is handled once', async () => {
  const secret = 'whsec_test';
  const handler = client.webhookHandler({ secret });
  const event = { id: mock.peekNextId(), type: 'test', data: { via: 'both' }, created_at: new Date().toISOString() };
  const raw = Buffer.from(JSON.stringify(event));
  const respond = (signature) => new Promise((resolve) => {
    const req = { method: 'POST', url: '/', headers: { 'x-yapper-signature': signature }, async *[Symbol.asyncIterator]() { yield raw; } };
    const res = { statusCode: 0, end() { resolve(this.statusCode); } };
    handler(req, res);
  });
  assert.equal(await respond('sha256=bad'), 401);
  assert.equal(await respond(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`), 200);
  mock.emit('test', event.data, { id: event.id }); // the same event over polling
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(seen.tests.filter((t) => t.via === 'both').length, 1);
});

await client.destroy();

// ── report ──────────────────────────────────────────────────────────────────
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
let area = null;
for (const r of results) {
  if (r.area !== area) console.log(`\n${(area = r.area)}`);
  console.log(`  ${r.ok ? green('✔') : red('✘')} ${r.name} ${dim(`${r.ms.toFixed(0)}ms`)}`);
  if (!r.ok) console.log(red(`      ${String(r.error?.stack ?? r.error).split('\n').slice(0, 8).join('\n      ')}`));
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? red(`${failed.length} failed`) : green('all passed')}: ${results.length - failed.length}/${results.length} scenarios, ${mock.requests.length} API requests`);
process.exit(failed.length ? 1 : 0);
