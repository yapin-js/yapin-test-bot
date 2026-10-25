import { EmbedBuilder, formatDuration, inlineCode, version } from 'yapin.js';

// A file can export an array of commands.
export default [
  {
    name: 'ping',
    description: 'Is the bot alive? Shows transport, heartbeat and uptime',
    category: 'Basics',
    aliases: ['p'],
    async run(ctx) {
      const sent = Date.now();
      const reply = await ctx.reply('pong 🏓');
      const client = ctx.client;
      await reply.edit(
        `pong 🏓 round trip ${Date.now() - sent}ms · events via ${client.transport ?? 'unknown'}` +
          `${client.ping !== null ? ` (heartbeat ${client.ping}ms)` : ''} · up ${formatDuration(client.uptime)}`,
      );
    },
  },
  {
    name: 'echo',
    description: 'Repeats what you say (a rest string option)',
    category: 'Basics',
    options: [{ name: 'text', rest: true, required: true, description: 'Anything' }],
    examples: ['/echo hello world'],
    async run(ctx) {
      await ctx.react('✅');
      await ctx.reply(ctx.values.text);
    },
  },
  {
    name: 'say',
    description: 'Posts without quoting you (ctx.send)',
    category: 'Basics',
    options: [{ name: 'text', rest: true, required: true }],
    run: (ctx) => ctx.send(ctx.values.text),
  },
  {
    name: 'about',
    description: 'Framework, runtime and cache facts',
    category: 'Basics',
    run(ctx) {
      const { client } = ctx;
      const embed = new EmbedBuilder()
        .setTitle('yapin.js test bot')
        .setColor('Yapin')
        .setDescription('A bot whose only job is to exercise every part of yapin.js.')
        .addFields(
          { name: 'yapin.js', value: inlineCode(version), inline: true },
          { name: 'Node', value: inlineCode(process.version), inline: true },
          { name: 'Transport', value: inlineCode(client.transport ?? 'none'), inline: true },
          { name: 'Commands', value: String(client.commands.size), inline: true },
          { name: 'Modules', value: String(client.modules.cache.size), inline: true },
          { name: 'Cached users', value: String(client.users.cache.size), inline: true },
        )
        .setFooter({ text: `Ready since ${client.readyAt?.toISOString() ?? 'not ready'}` })
        .setTimestamp();
      return ctx.reply({ embeds: [embed] });
    },
  },
];
