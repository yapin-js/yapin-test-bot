import { EmbedBuilder, codeBlock, formatDuration } from 'yapin.js';

const describe = (value) => {
  if (value === null || value === undefined) return '—';
  if (value instanceof URL) return `URL(${value.href})`;
  return `${JSON.stringify(value)} (${typeof value})`;
};

export default [
  {
    name: 'types',
    description: 'Parses every scalar option type',
    category: 'Arguments',
    options: [
      { name: 'int', type: 'integer', min: 1, max: 1000, description: 'integer 1 to 1000' },
      { name: 'num', type: 'number', description: 'any number' },
      { name: 'flag', type: 'boolean', description: 'yes/no, on/off…' },
      { name: 'wait', type: 'duration', max: 7 * 86_400_000, description: 'like 1h30m' },
      { name: 'link', type: 'url', description: 'an https link' },
    ],
    examples: ['/types 42 3.14 yes 1h30m https://example.com'],
    run(ctx) {
      const { int, num, flag, wait, link } = ctx.values;
      const lines = [
        `int:  ${describe(int)}`,
        `num:  ${describe(num)}`,
        `flag: ${describe(flag)}`,
        `wait: ${describe(wait)}${wait ? ` = ${formatDuration(wait)}` : ''}`,
        `link: ${describe(link)}`,
      ];
      return ctx.reply(codeBlock(lines.join('\n')));
    },
  },
  {
    name: 'pick',
    description: 'Choices: plain strings and name/value pairs',
    category: 'Arguments',
    options: [
      { name: 'colour', choices: ['red', 'green', 'blue'], required: true },
      { name: 'size', choices: [{ name: 'small', value: 1 }, { name: 'large', value: 3 }], default: 1 },
    ],
    run: (ctx) => ctx.reply(`colour=${ctx.values.colour} size=${ctx.values.size} (${typeof ctx.values.size})`),
  },
  {
    name: 'whois',
    description: 'Resolves a user option (mention, id or name)',
    category: 'Arguments',
    options: [{ name: 'user', type: 'user', default: (ctx) => ctx.author }],
    run(ctx) {
      const user = ctx.options.getUser('user', true);
      const embed = new EmbedBuilder()
        .setTitle(user.displayName)
        .setColor('Blue')
        .addFields(
          { name: 'Username', value: user.username ?? 'unknown', inline: true },
          { name: 'Bot', value: user.bot ? 'yes' : 'no', inline: true },
          { name: 'Badges', value: user.badges.join(', ') || 'none', inline: true },
          { name: 'Mention', value: `${user}` },
        )
        .setFooter({ text: user.id });
      const avatar = user.avatarURL();
      if (avatar) embed.setThumbnail(avatar);
      return ctx.reply({ embeds: [embed] });
    },
  },
  {
    name: 'member',
    description: 'Resolves a member option, with roles',
    category: 'Arguments',
    serverOnly: true,
    options: [{ name: 'member', type: 'member', required: true }],
    async run(ctx) {
      const member = ctx.options.getMember('member', true);
      await ctx.server.roles.ensure();
      return ctx.reply(
        `${member.displayName}: roles ${member.roles.cache.map((r) => r.name).join(', ') || 'none'}; ` +
          `highest ${member.roles.highest?.name ?? 'none'}; timed out: ${member.isTimedOut() ? 'yes' : 'no'}`,
      );
    },
  },
  {
    name: 'chan',
    description: 'Resolves a text channel option',
    category: 'Arguments',
    serverOnly: true,
    options: [{ name: 'channel', type: 'channel', channelTypes: ['text'], default: (ctx) => ctx.channel }],
    run(ctx) {
      const c = ctx.values.channel;
      return ctx.reply(`${c} is a ${c.type} channel, position ${c.position ?? '?'}, slowmode ${c.slowmode ?? 0}s, private: ${Boolean(c.private)}`);
    },
  },
  {
    name: 'role',
    description: 'Resolves a role option (id or name)',
    category: 'Arguments',
    serverOnly: true,
    options: [{ name: 'role', type: 'role', required: true, description: 'Quote names with spaces: "Some Role"' }],
    run(ctx) {
      const { role } = ctx.values;
      return ctx.reply(`${role.name}: colour ${role.hexColor ?? 'none'}, position ${role.position}, perms ${role.permissions.toArray().join(', ') || 'none'}`);
    },
  },
  {
    name: 'paint',
    description: 'A custom option type (hex colours)',
    category: 'Arguments',
    options: [{ name: 'colour', type: 'hex', required: true }],
    examples: ['/paint #ff6b4a'],
    run(ctx) {
      const hex = ctx.values.colour.toString(16).padStart(6, '0');
      return ctx.reply({ embeds: [new EmbedBuilder().setColor(ctx.values.colour).setTitle(`#${hex}`).setDescription('Look at the stripe on the left.')] });
    },
  },
  {
    name: 'even',
    description: 'An option with a validate() function',
    category: 'Arguments',
    options: [{ name: 'n', type: 'integer', required: true, validate: (n) => n % 2 === 0 || `${n} is odd, I wanted an even number` }],
    run: (ctx) => ctx.reply(`${ctx.values.n} is even 👍`),
  },
  {
    name: 'sum',
    description: 'A rest option of integers (an array)',
    category: 'Arguments',
    options: [{ name: 'numbers', type: 'integer', rest: true, required: true }],
    run: (ctx) => ctx.reply(`${ctx.values.numbers.join(' + ')} = ${ctx.values.numbers.reduce((a, b) => a + b, 0)}`),
  },
  {
    name: 'argv',
    description: 'Shows how the command line was read',
    category: 'Arguments',
    aliases: ['args'],
    options: [{ name: 'words', rest: true }],
    examples: ['/argv "two words" three'],
    run(ctx) {
      const info = {
        prefix: ctx.prefix,
        commandName: ctx.commandName,
        args: ctx.args,
        argv: ctx.argv,
        usage: ctx.usage,
        values: ctx.options.toJSON(),
      };
      return ctx.reply(codeBlock('json', JSON.stringify(info, null, 2)));
    },
  },
];
