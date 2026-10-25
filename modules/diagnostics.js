import { EmbedBuilder, Module, PresenceStatus, Routes, YapinAPIError, codeBlock, formatDuration } from 'yapin.js';
import { stats } from '../src/stats.js';
import { areasOf, checks, runChecks } from '../selftest/checks.js';

// Bot-side diagnostics: the offline suite, live stats, raw REST, and module hot reload.
export default class Diagnostics extends Module {
  commands = [
    {
      name: 'selftest',
      description: 'Runs the offline yapin.js checks inside the bot',
      cooldown: { seconds: 15, scope: 'channel' },
      options: [{ name: 'areas', rest: true, description: `Only some areas: ${areasOf(checks).join(', ')}` }],
      run: async (ctx) => {
        const areas = ctx.values.areas?.split(/[\s,]+/).filter(Boolean);
        const results = await runChecks({ areas });
        const failed = results.filter((r) => !r.ok);
        const embed = new EmbedBuilder()
          .setTitle(`Self-test: ${results.length - failed.length}/${results.length} passed`)
          .setColor(failed.length ? 'Red' : 'Green')
          .setFooter({ text: `${results.reduce((ms, r) => ms + r.ms, 0).toFixed(0)}ms in all` });
        for (const area of areasOf(results).slice(0, 10)) {
          const inArea = results.filter((r) => r.area === area);
          const bad = inArea.filter((r) => !r.ok);
          const value = bad.length ? bad.map((r) => `✘ ${r.name}\n  ${String(r.error?.message ?? r.error).split('\n')[0].slice(0, 120)}`).join('\n') : `all ${inArea.length} passed`;
          embed.addFields({ name: `${bad.length ? '❌' : '✅'} ${area}`, value: value.slice(0, 1024), inline: !bad.length });
        }
        return ctx.reply({ embeds: [embed] });
      },
    },
    {
      name: 'stats',
      description: 'Commands run, events seen, errors, uptime',
      run: (ctx) => {
        const top = [...stats.commands].sort(([, a], [, b]) => b.runs - a.runs).slice(0, 10);
        const embed = new EmbedBuilder()
          .setTitle('Bot stats')
          .setColor('Gold')
          .addFields(
            { name: 'Uptime', value: formatDuration(Date.now() - stats.startedAt), inline: true },
            { name: 'Denied', value: String(stats.denied), inline: true },
            { name: 'Errors', value: String(stats.errors), inline: true },
            { name: 'Clicks', value: String(stats.clicks), inline: true },
            { name: 'Rate limits', value: String(stats.rateLimits), inline: true },
            { name: 'Maintenance', value: stats.maintenance ? 'on' : 'off', inline: true },
            { name: 'Top commands', value: top.map(([path, s]) => `/${path} ×${s.runs} (avg ${(s.totalMs / s.runs).toFixed(0)}ms)`).join('\n') || 'none yet' },
            { name: 'Events', value: [...stats.events].map(([type, n]) => `${type}: ${n}`).join('\n') || 'none yet' },
          );
        return ctx.reply({ embeds: [embed] });
      },
    },
    {
      name: 'rest',
      description: 'Raw client.rest calls: /me, this server, a deliberate 404',
      run: async (ctx) => {
        const me = await ctx.client.rest.get(Routes.me());
        const lines = [`GET ${Routes.me()} → keys: ${Object.keys(me).join(', ')}`];
        if (ctx.serverId) {
          const server = await ctx.client.rest.get(Routes.server(ctx.serverId));
          lines.push(`GET ${Routes.server(ctx.serverId)} → keys: ${Object.keys(server.server ?? server).join(', ')}`);
        }
        try {
          await ctx.client.rest.get(Routes.channel('00000000-0000-0000-0000-000000000000'));
          lines.push('GET unknown channel → no error?');
        } catch (error) {
          lines.push(error instanceof YapinAPIError ? `GET unknown channel → ${error.status} "${error.message}" (isNotFound: ${error.isNotFound})` : `GET unknown channel → ${error.name}: ${error.message}`);
        }
        return ctx.reply(codeBlock(lines.join('\n')));
      },
    },
    {
      name: 'unawaited',
      description: 'A send nobody awaits fails; the error goes to the error event',
      run: (ctx) => {
        const before = stats.errors;
        ctx.client.send('00000000-0000-0000-0000-000000000000', 'this channel does not exist'); // not awaited on purpose
        return new Promise((resolve) => setTimeout(resolve, 1500)).then(() =>
          ctx.reply(stats.errors > before ? '✅ The failed send went to the error event instead of crashing.' : '❓ No error was reported (did the send succeed?)'));
      },
    },
    {
      name: 'modules',
      description: 'List, reload, unload or load modules (owner only)',
      ownerOnly: true,
      subcommands: [
        {
          name: 'list',
          run: (ctx) => ctx.reply(ctx.client.modules.cache.map((m) => `**${m.name}** · ${m.label} · loaded ${m.loadedAt?.toISOString().slice(11, 19) ?? '?'}`).join('\n') || 'No modules.'),
        },
        {
          name: 'reload',
          options: [{ name: 'module', required: true }],
          run: async (ctx) => {
            if (ctx.values.module === 'all') await ctx.client.modules.reloadAll();
            else await ctx.client.modules.reload(ctx.values.module);
            return ctx.reply(`♻️ Reloaded ${ctx.values.module}.`);
          },
        },
        {
          name: 'unload',
          options: [{ name: 'module', required: true }],
          run: async (ctx) => {
            if (ctx.values.module === 'diagnostics') return ctx.error("Unloading diagnostics would remove this command too; reload it instead.");
            await ctx.client.modules.unload(ctx.values.module);
            return ctx.reply(`⏏️ Unloaded ${ctx.values.module}. Its commands, buttons and listeners are gone.`);
          },
        },
        {
          name: 'load',
          options: [{ name: 'file', required: true, description: 'like modules/layouts.js' }],
          run: async (ctx) => {
            const file = ctx.values.file.replace(/^\.?\/?/, '');
            if (!/^modules\/[\w-]+(\.js)?$/.test(file)) return ctx.error('Give a file in modules/, like `modules/layouts.js`.');
            await ctx.client.modules.load(new URL(`../${file}`, import.meta.url));
            return ctx.reply(`📦 Loaded ${file}.`);
          },
        },
      ],
    },
    {
      name: 'maintenance',
      description: 'Toggle maintenance mode (owner only; a middleware gate)',
      ownerOnly: true,
      options: [{ name: 'on', type: 'boolean' }],
      run: (ctx) => {
        stats.maintenance = ctx.values.on ?? !stats.maintenance;
        return ctx.reply(`Maintenance is ${stats.maintenance ? 'on: only owners can run commands' : 'off'}.`);
      },
    },
    {
      name: 'sync',
      description: 'Sync commands and compare with fetchRemote (owner only)',
      ownerOnly: true,
      run: async (ctx) => {
        const local = await ctx.client.commands.sync();
        const remote = await ctx.client.commands.fetchRemote();
        return ctx.reply(`Local list: ${local.length} · Yapin’ has: ${remote.length}`);
      },
    },
    {
      name: 'presence',
      description: 'Set status and activity (owner only)',
      ownerOnly: true,
      options: [
        { name: 'status', choices: Object.values(PresenceStatus), required: true },
        { name: 'activity', rest: true, max: 60 },
      ],
      run: async (ctx) => {
        await ctx.client.user.setPresence({ status: ctx.values.status, activity: ctx.values.activity ?? null });
        return ctx.reply(`Presence: ${ctx.values.status}${ctx.values.activity ? `, "${ctx.values.activity}"` : ''}.`);
      },
    },
  ];

  load() {
    // Timers made through the module are cleared on unload and reload.
    this.setInterval(() => this.logger.debug(`heartbeat: ${stats.commands.size} distinct commands run, ${stats.errors} errors`), 5 * 60_000);
    this.onUnload(() => this.logger.debug('diagnostics unloaded'));
  }
}
