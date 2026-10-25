import { PermissionFlags, defineModule, formatDuration } from 'yapin.js';

// Reversible moderation only: timeouts, nicknames, roles, pins and purges. Kick and ban are left out
// on purpose so a test run can't remove anyone from the server.
export default defineModule({
  name: 'moderation',

  check: (ctx) => ctx.inServer() || 'Moderation commands only work in servers.',

  commands: [
    {
      name: 'mod',
      description: 'timeout, untimeout, nick, role add/remove, pin, purge',
      category: 'Moderation',
      serverOnly: true,
      subcommands: [
        {
          name: 'timeout',
          description: 'Time someone out',
          permissions: [PermissionFlags.TimeoutMembers],
          options: [
            { name: 'member', type: 'member', required: true },
            { name: 'length', type: 'duration', default: 60_000, min: 60_000, max: 28 * 86_400_000 },
            { name: 'reason', rest: true },
          ],
          async run(ctx) {
            const { member, length, reason } = ctx.values;
            await member.timeout(length, reason ?? undefined);
            await ctx.reply(`⏳ ${member.displayName} is timed out for ${formatDuration(length)}${reason ? `: ${reason}` : ''}.`);
          },
        },
        {
          name: 'untimeout',
          description: 'Lift a timeout',
          permissions: [PermissionFlags.TimeoutMembers],
          options: [{ name: 'member', type: 'member', required: true }],
          async run(ctx) {
            await ctx.values.member.removeTimeout();
            await ctx.reply(`✅ ${ctx.values.member.displayName} can talk again.`);
          },
        },
        {
          name: 'nick',
          description: 'Set or clear a nickname',
          permissions: [PermissionFlags.ManageNicknames],
          options: [{ name: 'member', type: 'member', required: true }, { name: 'nickname', rest: true, max: 32 }],
          async run(ctx) {
            const { member, nickname } = ctx.values;
            await member.setNickname(nickname ?? null);
            await ctx.reply(nickname ? `Renamed to **${nickname}**.` : 'Nickname cleared.');
          },
        },
        {
          name: 'role',
          description: 'Give or take a role',
          permissions: [PermissionFlags.ManageRoles],
          options: [
            { name: 'action', choices: ['add', 'remove'], required: true },
            { name: 'member', type: 'member', required: true },
            { name: 'role', type: 'role', required: true },
          ],
          async run(ctx) {
            const { action, member, role } = ctx.values;
            await member.roles[action](role);
            await ctx.reply(`${action === 'add' ? 'Gave' : 'Took'} **${role.name}** ${action === 'add' ? 'to' : 'from'} ${member.displayName}.`);
          },
        },
        {
          name: 'pin',
          description: 'Pin (or unpin) the message you reply to',
          permissions: [PermissionFlags.ManageMessages],
          options: [{ name: 'undo', type: 'boolean', default: false }],
          async run(ctx) {
            if (!ctx.message.replyToId) return ctx.error('Reply to the message you want pinned.');
            const target = await ctx.message.fetchReference();
            await (ctx.values.undo ? target.unpin() : target.pin());
            await ctx.reply(ctx.values.undo ? '📌 Unpinned.' : '📌 Pinned.');
          },
        },
        {
          name: 'purge',
          description: 'bulkDelete the last N messages',
          permissions: [PermissionFlags.ManageMessages],
          options: [{ name: 'count', type: 'integer', min: 1, max: 100, required: true }],
          async run(ctx) {
            const { deleted, skipped } = await ctx.channel.bulkDelete(ctx.values.count);
            await ctx.send(`🧹 Deleted ${deleted.length}${skipped.length ? `, skipped ${skipped.length}` : ''}.`);
          },
        },
      ],
    },
  ],
});
