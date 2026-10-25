import { PermissionFlags, UserError } from 'yapin.js';

const testRole = process.env.TEST_ROLE ?? 'Tester';

export default [
  {
    name: 'serveronly',
    description: 'Precondition: serverOnly',
    category: 'Checks',
    serverOnly: true,
    run: (ctx) => ctx.reply(`✅ You're in ${ctx.server.name ?? ctx.serverId}`),
  },
  {
    name: 'owneronly',
    description: 'Precondition: ownerOnly (bot owner and OWNER_IDS)',
    category: 'Checks',
    ownerOnly: true,
    run: (ctx) => ctx.reply('✅ You own me.'),
  },
  {
    name: 'needperm',
    description: 'Precondition: Manage messages permission',
    category: 'Checks',
    permissions: [PermissionFlags.ManageMessages],
    run: (ctx) => ctx.reply('✅ You can manage messages.'),
  },
  {
    name: 'needrole',
    description: `Precondition: the ${testRole} role (set TEST_ROLE to change it)`,
    category: 'Checks',
    roles: [testRole],
    run: (ctx) => ctx.reply(`✅ You have ${testRole}.`),
  },
  {
    name: 'customcheck',
    description: 'Custom checks: a channel with "bot" in its name',
    category: 'Checks',
    checks: [
      async () => true, // async checks are awaited
      (ctx) => /bot/i.test(ctx.channel.name ?? '') || 'Use this in a channel with "bot" in its name',
    ],
    run: (ctx) => ctx.reply('✅ Right channel.'),
  },
  {
    name: 'cooldown',
    description: 'Cooldown: 2 uses per 20 seconds per person',
    category: 'Checks',
    cooldown: { seconds: 20, uses: 2 },
    run: (ctx) => ctx.reply('✅ Used. Try me three times quickly.'),
  },
  {
    name: 'channelcd',
    description: 'Cooldown: once per 15 seconds per channel',
    category: 'Checks',
    cooldown: { seconds: 15, scope: 'channel' },
    run: (ctx) => ctx.reply('✅ The channel used its turn.'),
  },
  {
    name: 'resetcd',
    description: 'Resets your /cooldown',
    category: 'Checks',
    run(ctx) {
      ctx.client.commands.cooldowns.reset(ctx.client.commands.get('cooldown'), ctx);
      return ctx.reply('Your /cooldown is reset.');
    },
  },
  {
    name: 'boom',
    description: 'Throws an unexpected error (commandError)',
    category: 'Checks',
    run() {
      throw new Error('Kaboom: this error is on purpose');
    },
  },
  {
    name: 'deny',
    description: 'Stops with ctx.error() (commandDenied)',
    category: 'Checks',
    run: (ctx) => ctx.error('Denied on purpose, with a reason you can read.'),
  },
  {
    name: 'silent',
    description: 'Stops with a silent UserError: a 🤫 reaction, no reply',
    category: 'Checks',
    async run(ctx) {
      await ctx.react('🤫');
      throw new UserError('nobody sees this', { silent: true });
    },
  },
  {
    name: 'hidden',
    description: 'Hidden: not in / or /help, still runs',
    category: 'Checks',
    hidden: true,
    run: (ctx) => ctx.reply('👻 You found the hidden command.'),
  },
  {
    name: 'prefixonly',
    description: 'register: false, so it is not sent to the / menu',
    category: 'Checks',
    register: false,
    run: (ctx) => ctx.reply('This command is prefix-only.'),
  },
];
