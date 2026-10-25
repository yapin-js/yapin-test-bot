import { EmbedBuilder, Module, codeBlock, inlineCode, splitMessage } from 'yapin.js';

const list = (items, empty = 'none') => (items.length ? items.join('\n') : empty);

// Managers, caches and structures: read-only lookups against the live API.
export default class Inspect extends Module {
  commands = [
    {
      name: 'serverinfo',
      description: 'server.fetch, fetchOwner, channels, roles, icon',
      serverOnly: true,
      run: async (ctx) => {
        const server = await ctx.server.fetch();
        const [owner, channels, roles] = await Promise.all([server.fetchOwner().catch(() => null), server.channels.fetch(), server.roles.fetch()]);
        const byType = channels.reduce((acc, c) => ({ ...acc, [c.type]: (acc[c.type] ?? 0) + 1 }), {});
        const embed = new EmbedBuilder()
          .setTitle(server.name)
          .setColor('Aqua')
          .addFields(
            { name: 'Owner', value: owner ? `${owner}` : inlineCode(server.ownerId ?? 'unknown'), inline: true },
            { name: 'Members', value: String(server.memberCount ?? '?'), inline: true },
            { name: 'Roles', value: String(roles.size), inline: true },
            { name: 'Channels', value: Object.entries(byType).map(([t, n]) => `${t}: ${n}`).join(', ') || 'none' },
            { name: 'Categories', value: server.channels.categories.map((c) => c.name).join(', ') || 'none' },
          )
          .setFooter({ text: server.id });
        const icon = server.iconURL();
        if (icon) embed.setThumbnail(icon);
        return ctx.reply({ embeds: [embed] });
      },
    },
    {
      name: 'members',
      description: 'members.list (one page), or members.search over the cache',
      serverOnly: true,
      options: [{ name: 'query', rest: true, description: 'Exact username, display name or nickname of a cached member' }],
      run: async (ctx) => {
        const { query } = ctx.values;
        const found = query ? ctx.server.members.search(query) : await ctx.server.members.list({ limit: 25 });
        const lines = found.first(25).map((m) => `${m.displayName}${m.user.bot ? ' 🤖' : ''}${m.nickname ? ` (nick of ${m.user.username})` : ''}`);
        return ctx.reply(`${query ? `Cached matches for "${query}"` : 'First page of members'} (${found.size}):\n${list(lines)}`);
      },
    },
    {
      name: 'roles',
      description: 'roles.fetch, highest first, with permissions',
      serverOnly: true,
      run: async (ctx) => {
        const roles = await ctx.server.roles.fetch();
        const lines = roles.map((r) => `${r.name}${r.auto ? ' (managed)' : ''} · ${r.hexColor ?? 'no colour'} · ${r.permissions.toArray().join(', ') || 'no perms'}`);
        return ctx.reply(`${roles.size} roles, highest is **${ctx.server.roles.highest?.name ?? '?'}**\n${list(lines)}`);
      },
    },
    {
      name: 'channels',
      description: 'server.channels.fetch grouped by category',
      serverOnly: true,
      run: async (ctx) => {
        const channels = await ctx.server.channels.fetch();
        const groups = new Map([[null, []]]);
        for (const c of channels.values()) {
          if (c.isCategory()) continue;
          const key = c.category?.name ?? null;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(`${c.isVoice() ? '🔊' : '#'} ${c.name}${c.private ? ' 🔒' : ''}${c.readOnly ? ' 📢' : ''}`);
        }
        const text = [...groups].filter(([, items]) => items.length).map(([name, items]) => `**${name ?? 'No category'}**\n${items.join('\n')}`).join('\n\n');
        return ctx.reply(text || 'No channels I can see.');
      },
    },
    {
      name: 'me',
      description: 'Your member: roles, permissions, timeout; and the bot\'s own',
      serverOnly: true,
      run: async (ctx) => {
        const [member, me] = await Promise.all([ctx.fetchMember(), ctx.server.members.fetchMe(), ctx.server.roles.ensure()]);
        const perms = (m) => m.permissions.toArray().join(', ') || 'none';
        return ctx.reply([
          `**You** ${member.displayName}: roles ${member.roles.cache.map((r) => r.name).join(', ') || 'none'}`,
          `permissions: ${ctx.server.ownerId === member.id ? 'everything (server owner)' : perms(member)}`,
          `kick_members? ${member.permissions.has('KickMembers')} · any of ban/kick? ${member.permissions.any('ban_members', 'kick_members')}`,
          `missing for moderation: ${member.permissions.missing(['kick_members', 'ban_members', 'timeout_members']).join(', ') || 'nothing'}`,
          `timed out: ${member.isTimedOut()} · joined ${member.joinedAt?.toISOString() ?? '?'}`,
          `**Me** ${me.displayName}: permissions ${perms(me)}`,
        ].join('\n'));
      },
    },
    {
      name: 'history',
      description: 'channel.messages.fetch: the last N messages here',
      options: [{ name: 'limit', type: 'integer', min: 1, max: 50, default: 10 }],
      run: async (ctx) => {
        const messages = await ctx.channel.messages.fetch({ limit: ctx.values.limit, before: ctx.message });
        const lines = messages.map((m) => `${m.createdAt?.toISOString().slice(11, 19) ?? '??'} ${m.author?.displayName ?? '?'}: ${(m.content || '[no text]').slice(0, 60)}`);
        return ctx.reply(`Last ${messages.size} messages before yours:\n${codeBlock(list(lines))}`);
      },
    },
    {
      name: 'reactions',
      description: 'fetchReactions on the message you reply to (or the last one)',
      run: async (ctx) => {
        let target = ctx.message.replyToId ? await ctx.message.fetchReference() : null;
        target ??= (await ctx.channel.messages.fetch({ limit: 1, before: ctx.message })).last();
        if (!target) return ctx.reply('No message to look at.');
        const reactions = await target.fetchReactions();
        const lines = reactions.map((r) => `${r.emoji} ×${r.count}${r.me ? ' (incl. me)' : ''}`);
        return ctx.reply(`Reactions on that message:\n${list(lines)}`);
      },
    },
    {
      name: 'voice',
      description: 'server.voice.fetch and channelOf: who is in voice',
      serverOnly: true,
      run: async (ctx) => {
        const channels = await ctx.server.voice.fetch();
        const mine = await ctx.server.voice.channelOf(ctx.authorId);
        const lines = channels.map((userIds, channelId) => `${ctx.client.channels.cache.get(channelId)?.name ?? channelId}: ${userIds.length ? userIds.map((id) => `<@${id}>`).join(' ') : 'empty'}`);
        return ctx.reply(`You are ${mine ? `in <#${mine}>` : 'not in voice'}.\n${list(lines, 'No voice channels.')}`);
      },
    },
    {
      name: 'cache',
      description: 'Sizes of every cache yapin.js keeps',
      run: (ctx) => {
        const { client } = ctx;
        const rows = [
          ['client.users', client.users.cache.size],
          ['client.servers', client.servers.cache.size],
          ['client.channels', client.channels.cache.size],
          ['this channel.messages', ctx.channel.messages?.cache.size ?? 0],
          ['server.members', ctx.server?.members.cache.size ?? 0],
          ['server.roles', ctx.server?.roles.cache.size ?? 0],
          ['server.voice.states', ctx.server?.voice.states.size ?? 0],
        ];
        return ctx.reply(codeBlock(rows.map(([k, v]) => `${k.padEnd(24)} ${v}`).join('\n')));
      },
    },
    {
      name: 'longtext',
      description: 'splitMessage: sends ~2400 characters in 2000-character parts',
      run: async (ctx) => {
        const text = Array.from({ length: 80 }, (_, i) => `Line ${i + 1}: the quick brown fox.`).join('\n');
        const parts = splitMessage(text);
        for (const part of parts) await ctx.send(part);
        return ctx.reply(`Sent ${text.length} characters as ${parts.length} messages.`);
      },
    },
  ];
}
