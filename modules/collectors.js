import { ActionRowBuilder, ButtonBuilder, formatDuration } from 'yapin.js';

// Module style 3: just a setup(ctx) export. The module is named after the file ("collectors").
export function setup(mod) {
  mod.command({
    name: 'quiz',
    description: 'awaitMessages: answer within 15 seconds',
    async run(ctx) {
      await ctx.reply('What is 6 × 7? You have 15 seconds.');
      const answers = await ctx.channel.awaitMessages({ filter: (m) => m.authorId === ctx.authorId, max: 1, time: 15_000 });
      const answer = answers.first();
      if (!answer) return ctx.send('⏰ Time is up. It was 42.');
      return answer.reply(answer.content.trim() === '42' ? '✅ Correct!' : '❌ Nope, 42.');
    },
  });

  mod.command({
    name: 'guess',
    description: 'A message collector with filter, idle, max and stop(reason)',
    async run(ctx) {
      const secret = 1 + Math.floor(Math.random() * 20);
      await ctx.reply('I picked a number from 1 to 20. Five guesses; I give up if you go quiet for 20 seconds.');
      const collector = ctx.channel.createMessageCollector({
        filter: (m) => m.authorId === ctx.authorId && /^\d+$/.test(m.content.trim()),
        idle: 20_000,
        max: 5,
      });
      collector.on('collect', (m) => {
        const n = Number(m.content);
        if (n === secret) collector.stop('correct');
        else m.react(n < secret ? '⬆️' : '⬇️');
      });
      collector.on('ignore', (m) => mod.logger.debug(`guess ignored "${m.content}"`));
      collector.on('end', (collected, reason) => {
        const verdicts = { correct: `🎉 Got it in ${collected.size}!`, limit: `Out of guesses, it was ${secret}.`, idle: `You went quiet. It was ${secret}.` };
        ctx.send(`${verdicts[reason] ?? `Ended (${reason}).`} (end reason: \`${reason}\`)`);
      });
    },
  });

  mod.command({
    name: 'coinflip',
    description: 'awaitMessageComponent: one click within 30 seconds',
    async run(ctx) {
      const message = await ctx.reply({
        content: 'Call it!',
        components: [new ActionRowBuilder(ButtonBuilder.primary('Heads', 'flip:h'), ButtonBuilder.primary('Tails', 'flip:t'))],
      });
      try {
        const click = await message.awaitMessageComponent({ filter: (i) => i.userId === ctx.authorId, time: 30_000 });
        const landed = Math.random() < 0.5 ? 'flip:h' : 'flip:t';
        await click.update({ content: `It landed ${landed === 'flip:h' ? 'heads' : 'tails'}. ${landed === click.customId ? 'You win!' : 'You lose!'}`, components: null });
      } catch {
        await message.edit({ content: 'Too slow.', components: null });
      }
    },
  });

  mod.command({
    name: 'clicks',
    description: 'createMessageComponentCollector: count clicks for N seconds',
    options: [{ name: 'seconds', type: 'integer', min: 1, max: 120, default: 20 }],
    async run(ctx) {
      const message = await ctx.reply({
        content: `Click as much as you like for ${ctx.values.seconds}s.`,
        components: [new ActionRowBuilder(ButtonBuilder.success('Click', 'clicks:hit'), ButtonBuilder.danger('Stop', 'clicks:stop'))],
      });
      const collector = message.createMessageComponentCollector({ time: ctx.values.seconds * 1000 });
      const people = new Set();
      collector.on('collect', (i) => {
        people.add(i.userId);
        if (i.customId === 'clicks:stop') return collector.stop('stopped');
        return i.update({ content: `${collector.collected.size} clicks from ${people.size} people` });
      });
      collector.on('end', (collected, reason) => message.edit({ content: `Done (${reason}): ${collected.size} clicks from ${people.size} people.`, components: null }));
    },
  });

  mod.command({
    name: 'poll',
    description: 'A reaction collector with dispose, plus fetchReactions',
    options: [{ name: 'seconds', type: 'integer', min: 1, max: 300, default: 30 }, { name: 'question', rest: true, default: 'Do you like polls?' }],
    async run(ctx) {
      const { seconds, question } = ctx.values;
      const message = await ctx.reply(`📊 **${question}** React within ${formatDuration(seconds * 1000)}.`);
      await message.react('👍');
      await message.react('👎');
      const collector = message.createReactionCollector({
        filter: (reaction, user) => ['👍', '👎'].includes(reaction.emoji) && user.id !== ctx.client.user.id,
        time: seconds * 1000,
        dispose: true,
      });
      collector.on('dispose', (reaction) => mod.logger.debug(`poll: ${reaction.userId} took back ${reaction.emoji}`));
      collector.on('end', async (collected) => {
        const count = (emoji) => collected.filter((r) => r.emoji === emoji).size;
        const live = await message.fetchReactions().catch(() => null);
        const liveText = live ? ` (Yapin’ counts: ${live.map((r) => `${r.emoji} ${r.count}`).join(', ')})` : '';
        await ctx.send(`📊 **${question}** 👍 ${count('👍')} · 👎 ${count('👎')}${liveText}`);
      });
    },
  });

  mod.command({
    name: 'chat',
    description: 'Async iteration: for await over a collector. Say "stop" to end',
    async run(ctx) {
      await ctx.reply('Talk to me for 30 seconds. I ✅ each message. Say `stop` to end.');
      const collector = ctx.channel.createMessageCollector({ filter: (m) => m.authorId === ctx.authorId, time: 30_000 });
      let n = 0;
      for await (const message of collector) {
        if (message.content.trim().toLowerCase() === 'stop') {
          collector.stop('asked');
          break;
        }
        n++;
        await message.react('✅');
      }
      await ctx.send(`Chat over: ${n} message${n === 1 ? '' : 's'} (${collector.endReason}).`);
    },
  });

  mod.command({
    name: 'nextmsg',
    description: 'await collector.next: the next message from you',
    async run(ctx) {
      await ctx.reply('Say anything in the next 15 seconds.');
      const collector = ctx.channel.createMessageCollector({ filter: (m) => m.authorId === ctx.authorId, time: 15_000 });
      try {
        const message = await collector.next;
        collector.stop();
        await message.reply(`Got "${message.content}" through \`await collector.next\`.`);
      } catch {
        await ctx.send('Nothing came (collector.next rejected).');
      }
    },
  });
}
