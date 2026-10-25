import { codeBlock } from 'yapin.js';

// Per-server settings, in memory. Exercises subcommands, nesting, and checks inherited from the parent.
const settings = new Map();
const forServer = (ctx) => {
  if (!settings.has(ctx.serverId)) settings.set(ctx.serverId, { values: new Map(), flags: new Set() });
  return settings.get(ctx.serverId);
};

export default {
  name: 'config',
  description: 'Subcommands: set, get, list, reset, flags on/off',
  category: 'Arguments',
  serverOnly: true, // applies to every subcommand
  subcommands: [
    {
      name: 'set',
      description: 'Set a value',
      options: [{ name: 'key', required: true, max: 32 }, { name: 'value', required: true, rest: true }],
      run(ctx) {
        forServer(ctx).values.set(ctx.values.key, ctx.values.value);
        return ctx.reply(`Set \`${ctx.values.key}\` to \`${ctx.values.value}\``);
      },
    },
    {
      name: 'get',
      description: 'Read a value',
      options: [{ name: 'key', required: true }],
      run(ctx) {
        const value = forServer(ctx).values.get(ctx.values.key);
        return ctx.reply(value === undefined ? `\`${ctx.values.key}\` isn't set` : `\`${ctx.values.key}\` = \`${value}\``);
      },
    },
    {
      name: 'list',
      aliases: ['ls'],
      description: 'Everything that is set',
      run(ctx) {
        const { values, flags } = forServer(ctx);
        const dump = { values: Object.fromEntries(values), flags: [...flags] };
        return ctx.reply(codeBlock('json', JSON.stringify(dump, null, 2)));
      },
    },
    {
      name: 'reset',
      description: 'Clear everything (needs Manage server)',
      permissions: ['manage_server'],
      run(ctx) {
        settings.delete(ctx.serverId);
        return ctx.reply('Settings cleared.');
      },
    },
    {
      name: 'flags',
      description: 'Nested subcommands: on, off',
      subcommands: [
        { name: 'on', options: [{ name: 'flag', required: true }], run: (ctx) => { forServer(ctx).flags.add(ctx.values.flag); return ctx.reply(`Flag \`${ctx.values.flag}\` is on`); } },
        { name: 'off', options: [{ name: 'flag', required: true }], run: (ctx) => { forServer(ctx).flags.delete(ctx.values.flag); return ctx.reply(`Flag \`${ctx.values.flag}\` is off`); } },
      ],
    },
  ],
};
