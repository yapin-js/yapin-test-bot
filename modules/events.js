import { EmbedBuilder, Events, defineModule } from 'yapin.js';

// Gateway events: joins, leaves, reactions, voice, the test button and @mentions.
// Set WELCOME_CHANNEL_ID to post a welcome card when someone joins.

// Listeners in a defineModule are bound to the definition object, which has no client or logger,
// so keep the module context from setup(). setup runs at load, before any event can arrive.
let mod;

export default defineModule({
  name: 'events',

  events: {
    [Events.MessageCreate](message) {
      // Commands are messages too; only answer plain @mentions.
      if (message.mentioned && !message.content.replace(/<@!?[\w-]+>/g, '').trim()) {
        message.reply(`Hi ${message.author}! Try \`/help\`, \`/selftest\` or \`/buttons\`.`);
      }
    },

    async [Events.ServerMemberAdd](member) {
      mod.logger.info(`${member.displayName} joined ${member.server?.name ?? member.serverId} (now ${member.server?.memberCount ?? '?'} members)`);
      const channelId = process.env.WELCOME_CHANNEL_ID;
      if (!channelId) return;
      await mod.client.send(channelId, {
        embeds: [new EmbedBuilder().setTitle(`Welcome, ${member.displayName}!`).setColor('Green').setDescription(`${member} is member #${member.server?.memberCount ?? '?'}.`)],
      });
    },

    [Events.ServerMemberRemove](member) {
      mod.logger.info(`${member.displayName ?? member.id} left ${member.serverId}${member.partial ? ' (partial)' : ''}`);
    },

    async [Events.MessageReactionAdd](reaction, user) {
      mod.logger.debug(`${user.username ?? user.id} reacted ${reaction.emoji} on ${reaction.messageId}`);
      // React 🔁 on one of the bot's messages and it reacts back.
      if (reaction.onOwnMessage && reaction.emoji === '🔁' && user.id !== mod.client.user.id) await reaction.react();
    },

    [Events.MessageReactionRemove](reaction, user) {
      mod.logger.debug(`${user.username ?? user.id} removed ${reaction.emoji} from ${reaction.messageId}`);
    },

    [Events.VoiceJoin](state) {
      mod.logger.info(`${state.isMe ? 'I' : state.userId} joined voice ${state.channelId}`);
    },

    [Events.VoiceLeave](state) {
      mod.logger.info(`${state.isMe ? 'I' : state.userId} left voice ${state.channelId}`);
    },

    [Events.Test](data) {
      mod.logger.info(`Test event from Settings → Developer: ${JSON.stringify(data)}`);
    },
  },

  setup(ctx) {
    mod = ctx;
    ctx.once(Events.ClientReady, () => ctx.logger.info(`events module listening in ${ctx.client.servers.cache.size} cached servers`));
  },
});
