import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, Module, sleep } from 'yapin.js';
import { stats } from '../src/stats.js';

const PAGES = {
  planets: ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'],
  colours: ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Indigo', 'Violet'],
};
const PAGE_SIZE = 3;

// Module style 1: a class extending Module.
export default class Buttons extends Module {
  name = 'buttons';

  /** message id → { yes: Set<userId>, no: Set<userId> } */
  votes = new Map();

  commands = [
    {
      name: 'buttons',
      description: 'Every button style plus each way to answer a click',
      run: (ctx) => ctx.reply({
        content: 'Row 1 is every style. Row 2 is every way to answer a click.',
        components: [
          new ActionRowBuilder(
            ButtonBuilder.primary('Primary', 'btn:style:primary'),
            ButtonBuilder.secondary('Secondary', 'btn:style:secondary').setEmoji('⚙️'),
            ButtonBuilder.success('Success', 'btn:style:success'),
            ButtonBuilder.danger('Danger', 'btn:style:danger'),
            ButtonBuilder.link('Docs', 'https://github.com/yapin-js/yapin.js#readme'),
          ),
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn:ephemeral').setLabel('Ephemeral').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('btn:reply').setLabel('Reply').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn:defer').setLabel('Defer + follow up').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn:slow').setLabel('Slow (auto-ack)').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn:disabled').setLabel('Disabled').setStyle(ButtonStyle.Danger).setDisabled(),
          ),
        ],
      }),
    },
    {
      name: 'counter',
      description: 'A button that counts clicks (i.update with state in the custom id)',
      run: (ctx) => ctx.reply(this.counter(0)),
    },
    {
      name: 'vote',
      description: 'Yes/no vote, routed with a RegExp and named groups',
      options: [{ name: 'question', rest: true, default: 'Pizza tonight?' }],
      run: (ctx) => ctx.reply({ content: this.voteText(ctx.values.question, null), components: [this.voteRow()] }),
    },
    {
      name: 'pages',
      description: 'A paginator: page:{list}:{n} with prev/next',
      options: [{ name: 'list', choices: Object.keys(PAGES), default: 'planets' }],
      run: (ctx) => ctx.reply(this.page(ctx.values.list, 0)),
    },
    {
      name: 'onceclick',
      description: 'A button handled by components.once(): only the first click counts',
      // An arrow function, so `this` is the module (yapin.js calls run with `this` = the definition).
      run: async (ctx) => {
        const id = `once:${ctx.message.id}`;
        const remove = ctx.client.components.once(id, (i) => i.update({ content: `🏁 ${i.user} got there first.`, components: null }));
        // The router keeps unclicked once-handlers until removed, so clean up when the click window closes.
        this.setTimeout(remove, 15 * 60_000);
        await ctx.reply({ content: 'First to click wins.', components: [new ActionRowBuilder(ButtonBuilder.success('Me!', id))] });
      },
    },
  ];

  buttons = {
    'btn:style:{style}': (i) => i.ephemeral(`You clicked the **${i.params.style}** button.`),
    'btn:ephemeral': (i) => i.ephemeral({
      embeds: [new EmbedBuilder().setTitle('Only you can see this').setColor('Purple').setDescription('Ephemeral replies take text and embeds.')],
    }),
    'btn:reply': (i) => i.reply(`${i.user} clicked **Reply**: this is a normal message.`),
    'btn:defer': async (i) => {
      await i.deferUpdate();
      await sleep(1000);
      await i.followUp({ content: `Deferred, then followed up a second later (answers so far: ${i.responses}).`, ephemeral: true });
    },
    'btn:slow': async (i) => {
      // Answer later than the auto-ack window, so yapin.js acknowledges the click for us first.
      const wait = Math.round(this.client.options.components.autoAckAfter * 1.6);
      await sleep(wait);
      await i.followUp({ content: `Answered after ${wait}ms. Auto-acked: ${i.deferred ? 'yes' : 'no'}.`, ephemeral: true });
    },
    'counter:{n}': (i) => i.update(this.counter(Number(i.params.n) + 1)),
    'counter-reset': (i) => i.update(this.counter(0)),
    'counter-done:{n}': (i) => i.update({
      content: `Final count: ${i.params.n}`,
      components: [new ActionRowBuilder(ButtonBuilder.secondary('Done', 'counter-noop').setDisabled())],
    }),
    'page:{list}:{n}': (i) => i.update(this.page(i.params.list, Number(i.params.n))),
  };

  events = {
    [Events.InteractionCreate]: (i) => {
      stats.clicks++;
      this.logger.debug(`${i.user.username ?? i.userId} clicked ${i.customId}`);
    },
  };

  load() {
    // RegExp patterns aren't valid object keys, so route this one in code. Named groups become i.params.
    this.button(/^vote:(?<choice>yes|no)$/, (i) => {
      const tally = this.votes.get(i.messageId) ?? { yes: new Set(), no: new Set() };
      this.votes.set(i.messageId, tally);
      const other = i.params.choice === 'yes' ? 'no' : 'yes';
      tally[other].delete(i.userId);
      tally[i.params.choice].add(i.userId);
      const question = /^\*\*(.+?)\*\*/.exec(i.message?.content ?? '')?.[1] ?? 'Vote';
      return i.update({ content: this.voteText(question, tally) });
    });
  }

  counter(n) {
    return {
      content: `Clicked ${n} time${n === 1 ? '' : 's'}`,
      components: [
        new ActionRowBuilder(
          ButtonBuilder.primary('+1', `counter:${n}`).setEmoji('➕'),
          ButtonBuilder.secondary('Reset', 'counter-reset'),
          ButtonBuilder.danger('Done', `counter-done:${n}`),
        ),
      ],
    };
  }

  voteRow() {
    return new ActionRowBuilder(ButtonBuilder.success('Yes', 'vote:yes').setEmoji('👍'), ButtonBuilder.danger('No', 'vote:no').setEmoji('👎'));
  }

  voteText(question, tally) {
    return `**${question}**\n👍 ${tally?.yes.size ?? 0} · 👎 ${tally?.no.size ?? 0}`;
  }

  page(list, n) {
    const items = PAGES[list] ?? PAGES.planets;
    const last = Math.ceil(items.length / PAGE_SIZE) - 1;
    const index = Math.min(Math.max(n, 0), last);
    const shown = items.slice(index * PAGE_SIZE, index * PAGE_SIZE + PAGE_SIZE);
    return {
      content: `**${list}** · page ${index + 1}/${last + 1}\n${shown.map((s) => `- ${s}`).join('\n')}`,
      components: [
        new ActionRowBuilder(
          ButtonBuilder.secondary('◀', `page:${list}:${index - 1}`).setDisabled(index === 0),
          ButtonBuilder.secondary('▶', `page:${list}:${index + 1}`).setDisabled(index === last),
        ),
      ],
    };
  }
}
