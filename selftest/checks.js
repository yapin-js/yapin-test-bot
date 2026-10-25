import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import {
  ActionRowBuilder,
  ArgumentError,
  ArgumentTypeRegistry,
  ButtonBuilder,
  ButtonStyle,
  CDN,
  Client,
  Collection,
  Command,
  ComponentType,
  ContainerBuilder,
  CooldownError,
  CooldownManager,
  EmbedBuilder,
  ErrorCodes,
  Events,
  Intents,
  LimitedCollection,
  Limits,
  MediaGalleryBuilder,
  MemorySequenceStore,
  MessageFlags,
  MentionPatterns,
  OAuth2Client,
  Permissions,
  PreconditionError,
  REST,
  RateLimitError,
  Routes,
  SectionBuilder,
  UserError,
  WebhookClient,
  YapinAPIError,
  YapinError,
  bold,
  cdn,
  codeBlock,
  compilePattern,
  defineModule,
  disableValidators,
  enableValidators,
  escapeMarkdown,
  formatDuration,
  heading,
  isComponentsV2,
  measureLayout,
  parseArguments,
  parseDuration,
  quote,
  resolveColor,
  resolvePayload,
  splitMessage,
  tokenize,
  userMention,
  verifyWebhookSignature,
  version,
} from 'yapin.js';

const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof YapinError && e.code === code, `expected YapinError ${code}`);
const rejectsCode = (promise, code) => assert.rejects(promise, (e) => e instanceof YapinError && e.code === code, `expected YapinError ${code}`);

/** A client that never touches the network: no token, no login, a silent logger. */
const offlineClient = (options = {}) => new Client({ logger: false, WebSocket: false, commands: { autoSync: false }, ...options });

/** Just enough of a CommandContext for parseArguments with the built-in, non-lookup types. */
const fakeCtx = (args) => ({ args, argv: [], prefix: '/', client: null, server: null });

/**
 * Every check is { area, name, fn }. They run offline in a few milliseconds: no token, no network.
 * `npm run selftest` runs them from the terminal, and /selftest runs them inside the bot.
 */
export const checks = [
  // ── Embeds ────────────────────────────────────────────────────────────────
  {
    area: 'Embeds',
    name: 'EmbedBuilder builds the API shape',
    fn() {
      const json = new EmbedBuilder()
        .setTitle('T').setDescription('D').setURL('https://example.com').setColor('Blurple')
        .setAuthor({ name: 'A', iconURL: 'https://i.imgur.com/a.png' })
        .addFields({ name: 'f1', value: 'v1', inline: true }).addField('f2', 'v2')
        .setFooter({ text: 'F' }).setTimestamp(new Date(0))
        .toJSON();
      assert.equal(json.title, 'T');
      assert.equal(json.color, 0x5865f2);
      assert.equal(json.fields.length, 2);
      assert.equal(json.fields[0].inline, true);
      assert.equal(json.fields[1].inline, false);
      assert.equal(json.footer.text, 'F');
      assert.equal(new Date(json.timestamp).getTime(), 0);
    },
  },
  {
    area: 'Embeds',
    name: 'null removes a part, embed.length counts text',
    fn() {
      const embed = new EmbedBuilder().setTitle('12345').setDescription('abc');
      assert.equal(embed.length, 8);
      embed.setTitle(null);
      assert.equal(embed.toJSON().title, undefined);
      assert.equal(embed.length, 3);
    },
  },
  {
    area: 'Embeds',
    name: 'EmbedBuilder.from copies without sharing fields',
    fn() {
      const original = new EmbedBuilder().addFields({ name: 'a', value: 'b' });
      const copy = EmbedBuilder.from(original).setColor('Red').addFields({ name: 'c', value: 'd' });
      assert.equal(original.toJSON().fields.length, 1);
      assert.equal(copy.toJSON().fields.length, 2);
      assert.equal(copy.toJSON().color, 0xed4245);
    },
  },
  {
    area: 'Embeds',
    name: 'resolveColor accepts every documented format',
    fn() {
      assert.equal(resolveColor(0xff6b4a), 0xff6b4a);
      assert.equal(resolveColor('#ff6b4a'), 0xff6b4a);
      assert.equal(resolveColor('ff6b4a'), 0xff6b4a);
      assert.equal(resolveColor('yapin'), 0xff6b4a);
      assert.equal(resolveColor([255, 107, 74]), 0xff6b4a);
      assert.equal(resolveColor(null), null);
      const random = resolveColor('Random');
      assert.ok(Number.isInteger(random) && random >= 0 && random <= 0xffffff);
      throwsCode(() => resolveColor('nope'), ErrorCodes.ValidationError);
    },
  },
  {
    area: 'Embeds',
    name: 'validation catches broken limits',
    fn() {
      throwsCode(() => new EmbedBuilder().setTitle('x'.repeat(Limits.EmbedTitle + 1)), ErrorCodes.ValidationError);
      throwsCode(() => new EmbedBuilder().setDescription('x'.repeat(Limits.EmbedDescription + 1)), ErrorCodes.ValidationError);
      throwsCode(() => new EmbedBuilder().addFields(...Array.from({ length: Limits.EmbedFields + 1 }, (_, i) => ({ name: `${i}`, value: 'v' }))), ErrorCodes.ValidationError);
      throwsCode(() => new EmbedBuilder().setImage('http://i.imgur.com/a.png'), ErrorCodes.ValidationError);
    },
  },
  {
    area: 'Embeds',
    name: 'disableValidators skips checks, enableValidators restores them',
    fn() {
      disableValidators();
      try {
        new EmbedBuilder().setTitle('x'.repeat(Limits.EmbedTitle + 1));
      } finally {
        enableValidators();
      }
      throwsCode(() => new EmbedBuilder().setTitle('x'.repeat(Limits.EmbedTitle + 1)), ErrorCodes.ValidationError);
    },
  },

  // ── Buttons ───────────────────────────────────────────────────────────────
  {
    area: 'Buttons',
    name: 'shortcuts set style, label and custom id',
    fn() {
      for (const [make, style] of [[ButtonBuilder.primary, 'primary'], [ButtonBuilder.secondary, 'secondary'], [ButtonBuilder.success, 'success'], [ButtonBuilder.danger, 'danger']]) {
        const json = make('Go', `id:${style}`).toJSON();
        assert.equal(json.style, style);
        assert.equal(json.label, 'Go');
        assert.equal(json.custom_id, `id:${style}`);
      }
      const link = ButtonBuilder.link('Docs', 'https://example.com').toJSON();
      assert.equal(link.style, ButtonStyle.Link);
      assert.equal(link.url, 'https://example.com');
      assert.equal(link.custom_id, undefined);
    },
  },
  {
    area: 'Buttons',
    name: 'button rules: label or emoji, id length, https links',
    fn() {
      throwsCode(() => ButtonBuilder.primary('x', 'a'.repeat(Limits.CustomId + 1)), ErrorCodes.ValidationError);
      throwsCode(() => ButtonBuilder.link('x', 'http://example.com'), ErrorCodes.ValidationError);
      throwsCode(() => new ButtonBuilder().setStyle('primary').setCustomId('x').toJSON(), ErrorCodes.ValidationError);
      const emojiOnly = new ButtonBuilder().setStyle('primary').setCustomId('e').setEmoji('🔥').toJSON();
      assert.ok(emojiOnly.emoji);
      assert.equal(ButtonBuilder.primary('x', 'y').setDisabled().toJSON().disabled, true);
    },
  },
  {
    area: 'Buttons',
    name: 'ActionRowBuilder holds up to 5 buttons',
    fn() {
      const row = new ActionRowBuilder(...Array.from({ length: 5 }, (_, i) => ButtonBuilder.primary(`${i}`, `b${i}`))).toJSON();
      // Rows and buttons use Yapin's string types, also inside V2 layouts (docs/components.md lists 1 and 2).
      assert.equal(row.type, 'row');
      assert.equal(row.components[0].type, 'button');
      assert.equal(row.components.length, 5);
      throwsCode(() => new ActionRowBuilder(...Array.from({ length: 6 }, (_, i) => ButtonBuilder.primary(`${i}`, `b${i}`))), ErrorCodes.ValidationError);
    },
  },

  // ── Components V2 ─────────────────────────────────────────────────────────
  {
    area: 'Components V2',
    name: 'a container nests sections, accessories and galleries',
    fn() {
      const card = new ContainerBuilder()
        .setAccentColor('Blurple')
        .addTextDisplayComponents('## Hello')
        .addSectionComponents((s) => s.addTextDisplayComponents('text').setButtonAccessory(ButtonBuilder.primary('Go', 'go')))
        .addSeparatorComponents()
        .addMediaGalleryComponents(new MediaGalleryBuilder().addItems('https://i.imgur.com/a.png', { url: 'https://i.imgur.com/b.png', spoiler: true }))
        .toJSON();
      assert.equal(card.type, ComponentType.Container);
      assert.deepEqual(card.components.map((c) => c.type), [ComponentType.TextDisplay, ComponentType.Section, ComponentType.Separator, ComponentType.MediaGallery]);
      assert.equal(card.components[1].accessory.type, 'button');
      assert.equal(card.components[3].items[1].spoiler, true);
    },
  },
  {
    area: 'Components V2',
    name: 'measureLayout counts nested components and text',
    fn() {
      const card = new ContainerBuilder().add('abc', new SectionBuilder().addTextDisplayComponents('de').setButtonAccessory(ButtonBuilder.primary('x', 'x'))).toJSON();
      // container + text + section + section text + accessory
      assert.deepEqual(measureLayout([card]), { count: 5, text: 5 });
    },
  },
  {
    area: 'Components V2',
    name: 'nesting rules: no container in a container, max 3 texts per section',
    fn() {
      throwsCode(() => new ContainerBuilder().add(new ContainerBuilder()), ErrorCodes.ValidationError);
      throwsCode(() => new SectionBuilder().addTextDisplayComponents('1', '2', '3', '4'), ErrorCodes.ValidationError);
    },
  },
  {
    area: 'Components V2',
    name: 'resolvePayload sets the V2 flag and moves content into a text display',
    fn() {
      const body = resolvePayload({ content: 'top', components: [new ContainerBuilder().add('inside')] });
      assert.ok(body.flags & MessageFlags.IsComponentsV2);
      assert.equal(body.content, undefined);
      assert.equal(body.components[0].type, ComponentType.TextDisplay);
      assert.equal(body.components[0].content, 'top');
      assert.ok(isComponentsV2(body.components));
      assert.ok(!isComponentsV2([new ActionRowBuilder(ButtonBuilder.primary('x', 'x')).toJSON()]));
      throwsCode(() => resolvePayload({ components: [new ContainerBuilder().add('x')], embeds: [{ title: 'no' }] }), ErrorCodes.ValidationError);
    },
  },

  // ── Payloads ──────────────────────────────────────────────────────────────
  {
    area: 'Payloads',
    name: 'strings, embeds, arrays and replies resolve to API bodies',
    fn() {
      assert.deepEqual(resolvePayload('hi'), { content: 'hi' });
      assert.equal(resolvePayload(new EmbedBuilder().setTitle('e')).embeds[0].title, 'e');
      assert.equal(resolvePayload([new EmbedBuilder().setTitle('a'), { title: 'b' }]).embeds.length, 2);
      assert.equal(resolvePayload({ content: 'x', replyTo: { id: 'm1' } }).reply_to, 'm1');
      assert.equal(resolvePayload({ content: 'x', replyTo: 'm1' }, { edit: true }).reply_to, undefined);
      assert.equal(resolvePayload({ components: null }, { edit: true }).components, null);
      throwsCode(() => resolvePayload('x'.repeat(Limits.MessageContent + 1)), ErrorCodes.ValidationError);
      throwsCode(() => resolvePayload({ embeds: Array.from({ length: 6 }, () => ({ title: 'x' })) }), ErrorCodes.ValidationError);
    },
  },

  // ── Commands ──────────────────────────────────────────────────────────────
  {
    area: 'Commands',
    name: 'tokenize respects quotes and escapes',
    fn() {
      assert.deepEqual(tokenize('a "b c" \'d e\' f\\ g “h i”').map((t) => t.value), ['a', 'b c', 'd e', 'f g', 'h i']);
      assert.deepEqual(tokenize('   '), []);
    },
  },
  {
    area: 'Commands',
    name: 'Command builds usage lines and validates names',
    fn() {
      const cmd = new Command({ name: 'Ban', options: [{ name: 'member', required: true }, { name: 'mode', choices: ['soft', 'hard'] }, { name: 'reason', rest: true }], run() {} });
      assert.equal(cmd.name, 'ban');
      assert.equal(cmd.usage('!'), '!ban <member> [soft|hard] [reason...]');
      throwsCode(() => new Command({ name: 'has space', run() {} }), ErrorCodes.ValidationError);
      throwsCode(() => new Command({ name: 'norun' }), ErrorCodes.ValidationError);
      throwsCode(() => new Command({ name: 'x', options: [{ name: 'a', rest: true }, { name: 'b' }], run() {} }), ErrorCodes.ValidationError);
    },
  },
  {
    area: 'Commands',
    name: 'subcommands nest and have paths',
    fn() {
      const cmd = new Command({ name: 'config', subcommands: [{ name: 'flags', subcommands: [{ name: 'on', aliases: ['enable'], run() {} }] }] });
      const on = cmd.findSubcommand('flags').findSubcommand('enable');
      assert.equal(on.path, 'config flags on');
      assert.equal(cmd.usage(), '/config <flags>');
    },
  },
  {
    area: 'Commands',
    name: 'parseArguments reads every scalar type',
    async fn() {
      const cmd = new Command({
        name: 't',
        options: [
          { name: 'i', type: 'integer' }, { name: 'n', type: 'number' }, { name: 'b', type: 'boolean' },
          { name: 'd', type: 'duration' }, { name: 'u', type: 'url' }, { name: 'c', choices: [{ name: 'big', value: 3 }] },
          { name: 'rest', rest: true },
        ],
        run() {},
      });
      const values = await parseArguments(fakeCtx('1,000 3.5 off 1h30m https://example.com BIG the "rest" of it'), cmd, new ArgumentTypeRegistry());
      assert.deepEqual({ ...values, u: values.u.href }, { i: 1000, n: 3.5, b: false, d: 5_400_000, u: 'https://example.com/', c: 3, rest: 'the "rest" of it' });
    },
  },
  {
    area: 'Commands',
    name: 'parseArguments: defaults, required, min/max, validate',
    async fn() {
      const types = new ArgumentTypeRegistry();
      const cmd = new Command({
        name: 't',
        options: [{ name: 'a', type: 'integer', min: 1, max: 10, required: true, validate: (n) => n !== 7 || 'not 7' }, { name: 'b', default: (ctx) => `d:${ctx.prefix}` }],
        run() {},
      });
      assert.deepEqual(await parseArguments(fakeCtx('5'), cmd, types), { a: 5, b: 'd:/' });
      await assert.rejects(parseArguments(fakeCtx(''), cmd, types), (e) => e instanceof ArgumentError && e.reason === 'missing' && e.option === 'a');
      await assert.rejects(parseArguments(fakeCtx('11'), cmd, types), (e) => e instanceof ArgumentError && /at most 10/.test(e.message));
      await assert.rejects(parseArguments(fakeCtx('7'), cmd, types), (e) => e instanceof ArgumentError && e.message === 'not 7');
      await assert.rejects(parseArguments(fakeCtx('x'), cmd, types), (e) => e instanceof ArgumentError && /whole number/.test(e.message));
    },
  },
  {
    area: 'Commands',
    name: 'custom option types resolve and reject',
    async fn() {
      const types = new ArgumentTypeRegistry();
      types.register('hex', (text) => (/^#?[0-9a-f]{6}$/i.test(text) ? parseInt(text.replace('#', ''), 16) : undefined), { message: 'bad hex' });
      const cmd = new Command({ name: 'paint', options: [{ name: 'c', type: 'hex', required: true }], run() {} });
      assert.deepEqual(await parseArguments(fakeCtx('#ff0000'), cmd, types), { c: 0xff0000 });
      await assert.rejects(parseArguments(fakeCtx('red'), cmd, types), (e) => e instanceof ArgumentError && e.message.includes('bad hex'));
    },
  },
  {
    area: 'Commands',
    name: 'CooldownManager counts uses per scope and resets',
    fn() {
      const cooldowns = new CooldownManager();
      try {
        const cmd = new Command({ name: 'c', cooldown: { seconds: 10, uses: 2 }, run() {} });
        const alice = { authorId: 'a', channelId: 'c1', serverId: 's1' };
        const bob = { authorId: 'b', channelId: 'c1', serverId: 's1' };
        assert.equal(cooldowns.take(cmd, alice), 0);
        assert.equal(cooldowns.take(cmd, alice), 0);
        assert.ok(cooldowns.take(cmd, alice) > 9000);
        assert.equal(cooldowns.take(cmd, bob), 0, 'user scope is per person');
        cooldowns.reset(cmd, alice);
        assert.equal(cooldowns.take(cmd, alice), 0);
        const perChannel = new Command({ name: 'ch', cooldown: { seconds: 5, scope: 'channel' }, run() {} });
        assert.equal(cooldowns.take(perChannel, alice), 0);
        assert.ok(cooldowns.take(perChannel, bob) > 0, 'channel scope is shared');
      } finally {
        cooldowns.destroy();
      }
    },
  },
  {
    area: 'Commands',
    name: 'the handler registers, aliases, conflicts and unregisters',
    fn() {
      const client = offlineClient({ commands: { autoSync: false, help: true } });
      client.command('ping', 'Pong', () => {});
      client.commands.register({ name: 'roll', aliases: ['r'], run() {} });
      client.commands.register({ name: 'secret', hidden: true, run() {} });
      assert.equal(client.commands.get('/R').name, 'roll');
      assert.equal(client.commands.size, 4);
      assert.deepEqual(client.commands.toJSON().map((c) => c.name).sort(), ['help', 'ping', 'roll'], 'hidden commands and aliases are not synced');
      // The same name from somewhere else (a module) is a conflict.
      const record = { name: 'mod', label: 'modules/mod.js' };
      throwsCode(() => client.commands.register({ name: 'ping', run() {} }, { owner: record }), ErrorCodes.CommandConflict);
      throwsCode(() => client.commands.register({ name: 'x', aliases: ['r'], run() {} }), ErrorCodes.CommandConflict);
      // Replacing the built-in /help is allowed.
      client.commands.register({ name: 'help', run() {} }, { owner: record });
      assert.ok(client.commands.unregister('roll'));
      assert.equal(client.commands.get('r'), null);
      client.commands.cooldowns.destroy();
    },
  },
  {
    area: 'Commands',
    name: 'the 100 command limit is enforced, register:false is exempt',
    fn() {
      const client = offlineClient();
      for (let i = 0; i < Limits.Commands; i++) client.command(`c${i}`, '', () => {});
      throwsCode(() => client.command('one-too-many', '', () => {}), ErrorCodes.CommandLimit);
      client.commands.register({ name: 'prefix-only', register: false, run() {} });
      assert.equal(client.commands.size, Limits.Commands + 1);
      client.commands.cooldowns.destroy();
    },
  },

  // ── Buttons routing ───────────────────────────────────────────────────────
  {
    area: 'Routing',
    name: 'compilePattern: exact, wildcard, named parts, RegExp',
    fn() {
      assert.deepEqual(compilePattern('vote:yes')('vote:yes'), {});
      assert.equal(compilePattern('vote:yes')('vote:no'), null);
      assert.deepEqual(compilePattern('vote:*')('vote:anything:at:all'), {});
      assert.deepEqual(compilePattern('page:{list}:{n}')('page:planets:3'), { list: 'planets', n: '3' });
      assert.equal(compilePattern('page:{list}:{n}')('page:planets'), null);
      const { _match, ...params } = compilePattern(/^role:(?<roleId>.+)$/)('role:abc');
      assert.deepEqual(params, { roleId: 'abc' });
      assert.ok(_match);
    },
  },
  {
    area: 'Routing',
    name: 'the router runs every match and once() handlers once',
    async fn() {
      const client = offlineClient({ components: { autoAck: false } });
      const seen = [];
      client.button('a:{x}', () => seen.push('named'));
      client.button('a:*', () => seen.push('wildcard'));
      client.components.once('a:1', () => seen.push('once'));
      const remove = client.button('a:1', () => seen.push('removed'));
      remove();
      const click = (customId) => client.components._handle({ customId, responded: false, isExpired: () => false });
      assert.equal(click('a:1'), 3);
      assert.equal(click('a:1'), 2);
      await new Promise((r) => setImmediate(r));
      assert.deepEqual(seen, ['named', 'wildcard', 'once', 'named', 'wildcard']);
    },
  },
  {
    area: 'Routing',
    name: 'each matching handler sees its own pattern params',
    async fn() {
      // Two patterns match one click. Handlers run after the routing loop, so if params are stored on
      // the shared interaction, the first handler sees the second pattern's params.
      const client = offlineClient({ components: { autoAck: false } });
      const seen = [];
      client.button('shop:{item}', (i) => seen.push(i.params.item));
      client.button('shop:*', () => {});
      client.components._handle({ customId: 'shop:apple', responded: false, isExpired: () => false });
      await new Promise((r) => setImmediate(r));
      assert.deepEqual(seen, ['apple'], 'shop:{item} saw the params of the shop:* route');
    },
  },

  // ── Modules ───────────────────────────────────────────────────────────────
  {
    area: 'Modules',
    name: 'add() registers a module and unload() takes it all out',
    async fn() {
      const client = offlineClient();
      let unloaded = false;
      let ticks = 0;
      await client.modules.add(defineModule({
        name: 'probe',
        commands: [{ name: 'probe', run() {} }],
        buttons: { 'probe:*': () => {} },
        events: { [Events.Test]: () => {} },
        setup(ctx) {
          ctx.setInterval(() => ticks++, 5);
          ctx.onUnload(() => { unloaded = true; });
        },
      }));
      assert.ok(client.modules.has('probe'));
      assert.equal(client.commands.get('probe').owner.name, 'probe');
      assert.equal(client.commands.get('probe').category, 'probe', 'category defaults to the module name');
      assert.equal(client.listenerCount(Events.Test), 1);
      assert.equal(client.components.routes.length, 1);
      await client.modules.unload('probe');
      const after = ticks;
      await new Promise((r) => setTimeout(r, 20));
      assert.ok(unloaded, 'onUnload ran');
      assert.equal(ticks, after, 'intervals were cleared');
      assert.equal(client.commands.get('probe'), null);
      assert.equal(client.listenerCount(Events.Test), 0);
      assert.equal(client.components.routes.length, 0);
      client.commands.cooldowns.destroy();
    },
  },
  {
    area: 'Modules',
    name: 'module errors are tagged with the module name',
    async fn() {
      const client = offlineClient();
      const errors = [];
      client.on(Events.Error, (e) => errors.push(e));
      await client.modules.add(defineModule({ name: 'broken', events: { [Events.Test]: () => { throw new Error('boom'); } } }));
      client.emit(Events.Test, {});
      assert.equal(errors.length, 1);
      assert.equal(errors[0].module, 'broken');
      assert.equal(errors[0].where, Events.Test);
      client.commands.cooldowns.destroy();
    },
  },

  // ── Collection ────────────────────────────────────────────────────────────
  {
    area: 'Collection',
    name: 'array-style helpers',
    fn() {
      const c = new Collection([['a', 1], ['b', 2], ['c', 3], ['d', 4]]);
      assert.equal(c.first(), 1);
      assert.deepEqual(c.first(2), [1, 2]);
      assert.equal(c.last(), 4);
      assert.deepEqual(c.last(2), [3, 4]);
      assert.equal(c.at(-1), 4);
      assert.deepEqual([...c.filter((v) => v % 2).keys()], ['a', 'c']);
      assert.ok(c.filter(() => true) instanceof Collection);
      assert.deepEqual(c.map((v, k) => `${k}${v}`), ['a1', 'b2', 'c3', 'd4']);
      assert.equal(c.find((v) => v > 2), 3);
      assert.equal(c.findKey((v) => v > 2), 'c');
      assert.equal(c.reduce((a, v) => a + v, 0), 10);
      assert.ok(c.some((v) => v === 4) && c.every((v) => v > 0));
      const [odd, even] = c.partition((v) => v % 2);
      assert.deepEqual([[...odd.values()], [...even.values()]], [[1, 3], [2, 4]]);
      assert.ok(c.hasAll('a', 'b') && c.hasAny('z', 'a') && !c.hasAll('a', 'z'));
      assert.ok(c.random() >= 1);
    },
  },
  {
    area: 'Collection',
    name: 'set operations, sort, sweep, ensure',
    fn() {
      const a = new Collection([['x', 1], ['y', 2]]);
      const b = new Collection([['y', 2], ['z', 3]]);
      assert.deepEqual([...a.concat(b).keys()], ['x', 'y', 'z']);
      assert.deepEqual([...a.intersect(b).keys()], ['y']);
      assert.deepEqual([...a.difference(b).keys()].sort(), ['x', 'z']);
      assert.ok(a.equals(a.clone()) && !a.equals(b));
      const s = new Collection([['k1', 3], ['k2', 1], ['k3', 2]]);
      assert.deepEqual([...s.toSorted((x, y) => x - y).values()], [1, 2, 3]);
      assert.deepEqual([...s.values()], [3, 1, 2], 'toSorted copies');
      s.sort((x, y) => x - y);
      assert.deepEqual([...s.values()], [1, 2, 3], 'sort is in place');
      assert.equal(s.sweep((v) => v > 1), 2);
      assert.equal(s.ensure('new', () => 9), 9);
      assert.equal(s.ensure('new', () => 0), 9);
    },
  },
  {
    area: 'Collection',
    name: 'LimitedCollection forgets the oldest entries',
    fn() {
      const c = new LimitedCollection(2);
      c.set('a', 1).set('b', 2).set('c', 3);
      assert.deepEqual([...c.keys()], ['b', 'c']);
    },
  },

  // ── Utilities ─────────────────────────────────────────────────────────────
  {
    area: 'Utilities',
    name: 'parseDuration and formatDuration',
    fn() {
      assert.equal(parseDuration('1h30m'), 5_400_000);
      assert.equal(parseDuration('2 days'), 172_800_000);
      assert.equal(parseDuration('1w'), 604_800_000);
      assert.equal(parseDuration('500'), 500);
      assert.equal(parseDuration('soon'), null);
      assert.equal(parseDuration('5 parsecs'), null);
      assert.equal(formatDuration(5_400_000), '1h 30m');
      assert.equal(formatDuration(90_061_000), '1d 1h 1m 1s');
      assert.equal(formatDuration(250), '250ms');
      assert.equal(formatDuration(0), '0s');
    },
  },
  {
    area: 'Utilities',
    name: 'splitMessage keeps parts under the limit, on line breaks',
    fn() {
      const text = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n');
      const parts = splitMessage(text);
      assert.ok(parts.length > 1);
      assert.ok(parts.every((p) => p.length <= Limits.MessageContent));
      assert.equal(parts.join('\n'), text);
      assert.deepEqual(splitMessage('abcdef', { max: 2 }), ['ab', 'cd', 'ef']);
    },
  },
  {
    area: 'Utilities',
    name: 'formatters and mention patterns',
    fn() {
      assert.equal(bold('x'), '**x**');
      assert.equal(codeBlock('js', 'a'), '```js\na\n```');
      assert.equal(quote('a\nb'), '> a\n> b');
      assert.equal(heading('T', 9), '### T');
      assert.equal(userMention({ id: 'u1' }), '<@u1>');
      assert.equal(escapeMarkdown('*hi*'), '\\*hi\\*');
      const ids = [...'hey <@a-1> and <@!b-2> in <#c-3>'.matchAll(MentionPatterns.User)].map((m) => m[1]);
      assert.deepEqual(ids, ['a-1', 'b-2']);
    },
  },
  {
    area: 'Utilities',
    name: 'CDN links from API paths',
    fn() {
      assert.equal(cdn('icons', 'abc.png'), 'https://files.yapper.website/icons/abc.png');
      assert.equal(CDN.avatar('/default.png'), 'https://www.yapin.gg/default.png');
      assert.equal(CDN.banner('https://x.test/a.png'), 'https://x.test/a.png');
      assert.equal(CDN.attachment(null), null);
    },
  },
  {
    area: 'Utilities',
    name: 'constants: intents, limits, routes, version',
    fn() {
      assert.equal(Intents.All.length, 9);
      assert.deepEqual([...Intents.Members], ['member_join', 'member_leave']);
      assert.equal(Limits.MessageContent, 2000);
      assert.equal(Routes.serverMember('s 1', 'u/2'), '/servers/s%201/members/u%2F2');
      assert.match(version, /^\d+\.\d+\.\d+/);
    },
  },

  // ── Permissions ───────────────────────────────────────────────────────────
  {
    area: 'Permissions',
    name: 'has, any, missing with loose names',
    fn() {
      const roles = [{ manageMessages: true, perms: { kick_members: true, ban_members: false } }, { perms: { timeout_members: true } }];
      const p = Permissions.fromRoles(roles);
      assert.ok(p.has('KickMembers', 'manage_messages', 'timeoutmembers'));
      assert.ok(!p.has('ban_members'));
      assert.ok(p.any('ban_members', 'kick_members'));
      assert.deepEqual(p.missing(['ban_members', 'kick_members']), ['ban_members']);
      const owner = Permissions.fromRoles([], { owner: true });
      assert.ok(owner.has('anything_at_all'));
      assert.deepEqual(owner.missing('ban_members'), []);
    },
  },

  // ── Errors ────────────────────────────────────────────────────────────────
  {
    area: 'Errors',
    name: 'the error hierarchy and API error helpers',
    fn() {
      const cd = new CooldownError('slow', { remaining: 1500 });
      assert.ok(cd instanceof PreconditionError && cd instanceof UserError);
      assert.equal(cd.precondition, 'cooldown');
      assert.equal(cd.remaining, 1500);
      assert.ok(new ArgumentError('x', { option: 'o' }) instanceof UserError);
      const api = new YapinAPIError({ status: 403, method: 'POST', path: '/x', body: { error: 'Missing permission' } });
      assert.equal(api.message, 'Missing permission');
      assert.ok(api.isMissingPermissions && !api.isNotFound && !api.isRateLimit);
      const rl = new RateLimitError({ method: 'POST', path: '/x', body: { error: '30 messages a minute overall' }, retryAfter: 2 });
      assert.ok(rl instanceof YapinAPIError && rl.isRateLimit && rl.global);
    },
  },

  // ── Client ────────────────────────────────────────────────────────────────
  {
    area: 'Client',
    name: 'login refuses a missing or malformed token without a request',
    async fn() {
      const saved = [process.env.YAPIN_TOKEN, process.env.YAPPER_BOT_TOKEN];
      delete process.env.YAPIN_TOKEN;
      delete process.env.YAPPER_BOT_TOKEN;
      let requests = 0;
      const client = offlineClient({ fetch: () => { requests++; throw new Error('no network in tests'); } });
      try {
        await rejectsCode(client.login(), ErrorCodes.TokenMissing);
        await rejectsCode(client.login('not-a-bot-token'), ErrorCodes.TokenInvalid);
        assert.equal(requests, 0);
        assert.ok(!client.isReady());
      } finally {
        [process.env.YAPIN_TOKEN, process.env.YAPPER_BOT_TOKEN] = saved;
        if (saved[0] === undefined) delete process.env.YAPIN_TOKEN;
        if (saved[1] === undefined) delete process.env.YAPPER_BOT_TOKEN;
        client.commands.cooldowns.destroy();
      }
    },
  },
  {
    area: 'Client',
    name: 'options merge with defaults; prefix shorthand works',
    fn() {
      const client = offlineClient({ prefix: '?', cache: { messages: 5 } });
      assert.deepEqual(client.options.prefixes, ['?']);
      assert.equal(client.options.cache.messages, 5);
      assert.equal(client.options.cache.users, Infinity, 'nested defaults are kept');
      assert.equal(client.options.rest.retries, 3);
      assert.equal(client.guilds, client.servers);
      client.commands.cooldowns.destroy();
    },
  },
  {
    area: 'Client',
    name: 'raw events become structures and client events, deduplicated by id',
    async fn() {
      const client = offlineClient();
      const joined = [];
      const tests = [];
      client.on(Events.ServerMemberAdd, (m) => joined.push(m));
      client.on(Events.Test, (d) => tests.push(d));
      const join = { id: 1, type: 'member_join', data: { server_id: 's1', user_id: 'u1', username: 'alice', member_count: 7 } };
      client._dispatch(join);
      client._dispatch(join);
      client._dispatch({ id: 2, type: 'test', data: { hello: 'world' } });
      assert.equal(joined.length, 1, 'the same event id is handled once');
      assert.equal(joined[0].user.username, 'alice');
      assert.equal(joined[0].server.memberCount, 7);
      assert.deepEqual(tests, [{ hello: 'world' }]);
      client.commands.cooldowns.destroy();
    },
  },
  {
    area: 'Client',
    name: 'intents filter events locally',
    fn() {
      const client = offlineClient({ intents: [Intents.Messages] });
      let tests = 0;
      client.on(Events.Test, () => tests++);
      client._dispatch({ id: 1, type: 'test', data: {} });
      assert.equal(tests, 0);
      client.commands.cooldowns.destroy();
    },
  },

  // ── REST ──────────────────────────────────────────────────────────────────
  {
    area: 'REST',
    name: 'requests carry the token, query and JSON body',
    async fn() {
      const calls = [];
      const rest = new REST({ token: 'yb_test', fetch: async (url, init) => { calls.push({ url, init }); return new Response('{"ok":true}', { status: 200 }); } });
      assert.deepEqual(await rest.post(Routes.channelMessages('c1'), { body: { content: 'hi' }, query: { a: 1, skip: undefined, at: new Date(0) } }), { ok: true });
      const [{ url, init }] = calls;
      assert.equal(url, 'https://www.yapin.gg/api/bot/v1/channels/c1/messages?a=1&at=1970-01-01T00%3A00%3A00.000Z');
      assert.equal(init.headers.authorization, 'Bot yb_test');
      assert.equal(init.headers['content-type'], 'application/json');
      assert.equal(init.body, '{"content":"hi"}');
    },
  },
  {
    area: 'REST',
    name: 'a 429 with Retry-After is waited out and retried',
    async fn() {
      let n = 0;
      const limited = [];
      const rest = new REST({
        token: 'yb_test',
        fetch: async () => (++n === 1
          ? new Response('{"error":"Slow down"}', { status: 429, headers: { 'retry-after': '0.05' } })
          : new Response('{"done":true}', { status: 200 })),
      });
      rest.on('rateLimited', (info) => limited.push(info));
      assert.deepEqual(await rest.get('/x'), { done: true });
      assert.equal(n, 2);
      assert.equal(limited.length, 1);
      assert.equal(limited[0].retryAfter, 0.05);
    },
  },
  {
    area: 'REST',
    name: 'errors: 429 without Retry-After throws, 404 is a YapinAPIError, no token throws',
    async fn() {
      const rest = new REST({ token: 'yb_test', fetch: async (url) => new Response('{"error":"nope"}', { status: url.endsWith('/rl') ? 429 : 404 }) });
      await assert.rejects(rest.post('/rl'), (e) => e instanceof RateLimitError && e.retryAfter === null);
      await assert.rejects(rest.get('/missing'), (e) => e instanceof YapinAPIError && e.isNotFound && e.message === 'nope');
      await rejectsCode(new REST().get('/me'), ErrorCodes.TokenMissing);
    },
  },
  {
    area: 'REST',
    name: 'network errors retry GETs but never POSTs',
    async fn() {
      let gets = 0;
      let posts = 0;
      const rest = new REST({
        token: 'yb_test',
        retries: 1,
        fetch: async (_url, init) => {
          if (init.method === 'GET' && ++gets === 1) throw new TypeError('socket hang up');
          if (init.method === 'POST') { posts++; throw new TypeError('socket hang up'); }
          return new Response('{}', { status: 200 });
        },
      });
      await rest.get('/x');
      assert.equal(gets, 2);
      await rejectsCode(rest.post('/x'), ErrorCodes.NetworkError);
      assert.equal(posts, 1);
    },
  },

  // ── Gateway ───────────────────────────────────────────────────────────────
  {
    area: 'Gateway',
    name: 'MemorySequenceStore keeps the cursor',
    fn() {
      const store = new MemorySequenceStore(5);
      assert.equal(store.get(), 5);
      store.set(9);
      assert.equal(store.get(), 9);
    },
  },

  // ── Webhooks ──────────────────────────────────────────────────────────────
  {
    area: 'Webhooks',
    name: 'verifyWebhookSignature accepts good HMACs and rejects others',
    fn() {
      const body = '{"id":1,"type":"test"}';
      const sig = createHmac('sha256', 'shh').update(body).digest('hex');
      assert.ok(verifyWebhookSignature(body, `sha256=${sig}`, 'shh'));
      assert.ok(verifyWebhookSignature(Buffer.from(body), sig.toUpperCase(), 'shh'));
      assert.ok(!verifyWebhookSignature(body, `sha256=${sig}`, 'other'));
      assert.ok(!verifyWebhookSignature(body, 'sha256=short', 'shh'));
      assert.ok(!verifyWebhookSignature(body, undefined, 'shh'));
    },
  },
  {
    area: 'Webhooks',
    name: 'WebhookClient parses URLs, hides the token and posts',
    async fn() {
      const calls = [];
      const hook = new WebhookClient(
        { url: 'https://www.yapin.gg/api/webhooks/123/secret-token' },
        { fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response('{"id":"m1"}', { status: 200 }); } },
      );
      assert.equal(hook.id, '123');
      assert.ok(!JSON.stringify(hook).includes('secret-token'));
      await hook.send({ content: 'deployed', username: 'CI', embeds: [new EmbedBuilder().setTitle('Build')] });
      assert.match(calls[0].url, /\/webhooks\/123\/secret-token/);
      assert.equal(calls[0].body.username, 'CI');
      assert.equal(calls[0].body.embeds[0].title, 'Build');
      throwsCode(() => new WebhookClient({ url: 'https://example.com/nope' }), ErrorCodes.InvalidPayload);
    },
  },

  // ── OAuth2 ────────────────────────────────────────────────────────────────
  {
    area: 'OAuth2',
    name: 'PKCE challenge is the S256 of the verifier; auth URL has every param',
    fn() {
      const pkce = OAuth2Client.generatePKCE();
      const expected = createHash('sha256').update(pkce.verifier).digest('base64url');
      assert.equal(pkce.challenge, expected);
      assert.equal(pkce.method, 'S256');
      const state = OAuth2Client.generateState();
      assert.notEqual(state, OAuth2Client.generateState());
      const oauth = new OAuth2Client({ clientId: 'cid', redirectURI: 'http://localhost/cb' });
      const url = new URL(oauth.generateAuthURL({ state, codeChallenge: pkce.challenge }));
      assert.equal(url.searchParams.get('client_id'), 'cid');
      assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost/cb');
      assert.equal(url.searchParams.get('state'), state);
      assert.equal(url.searchParams.get('code_challenge'), pkce.challenge);
      assert.equal(url.searchParams.get('scope'), 'identify');
    },
  },
];

/** Runs the checks (optionally only some areas). Never throws; each result says what happened. */
export async function runChecks({ areas } = {}) {
  const selected = areas?.length ? checks.filter((c) => areas.some((a) => a.toLowerCase() === c.area.toLowerCase())) : checks;
  const results = [];
  for (const check of selected) {
    const started = performance.now();
    try {
      await check.fn();
      results.push({ ...check, ok: true, ms: performance.now() - started });
    } catch (error) {
      results.push({ ...check, ok: false, ms: performance.now() - started, error });
    }
  }
  return results;
}

export const areasOf = (list = checks) => [...new Set(list.map((c) => c.area))];
