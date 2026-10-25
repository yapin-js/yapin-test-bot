import {
  ActionRowBuilder,
  AllowedMediaHosts,
  ButtonBuilder,
  ContainerBuilder,
  EmbedBuilder,
  ErrorCodes,
  FileBuilder,
  Limits,
  MediaGalleryBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  YapinError,
  bold,
  channelMention,
  codeBlock,
  defineModule,
  escapeMarkdown,
  heading,
  hyperlink,
  inlineCode,
  italic,
  measureLayout,
  orderedList,
  quote,
  resolvePayload,
  sleep,
  strikethrough,
  unorderedList,
  userMention,
} from 'yapin.js';

// Real pictures on allowed hosts (raw.githubusercontent.com is in AllowedMediaHosts).
const JS_LOGO = 'https://raw.githubusercontent.com/github/explore/main/topics/javascript/javascript.png';
const NODE_LOGO = 'https://raw.githubusercontent.com/github/explore/main/topics/nodejs/nodejs.png';
const TS_LOGO = 'https://raw.githubusercontent.com/github/explore/main/topics/typescript/typescript.png';

function gameCard(votes = {}) {
  const count = (game) => votes[game] ?? 0;
  return new ContainerBuilder()
    .setAccentColor('Blurple')
    .addTextDisplayComponents('## Game night', 'Pick what we play. Buttons sit next to the text they belong to.')
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(`**Minecraft**\nSurvival, new world · ${count('mc')} votes`)
        .setButtonAccessory(ButtonBuilder.primary('Vote', 'card:vote:mc')),
      (s) => s.addTextDisplayComponents(`**Among Us**\nUp to 10 players · ${count('au')} votes`).setButtonAccessory(ButtonBuilder.primary('Vote', 'card:vote:au')),
      (s) => s.addTextDisplayComponents('**Thumbnail accessory**\nA section can hold a picture instead of a button.').setThumbnailAccessory(new ThumbnailBuilder().setURL(NODE_LOGO).setDescription('Node.js logo')),
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing('large'))
    .addActionRowComponents(new ActionRowBuilder(ButtonBuilder.secondary('Edit this card', 'card:edit'), ButtonBuilder.link('Docs', 'https://github.com/yapin-js/yapin.js')));
}

// Module style 2: defineModule({ … }).
export default defineModule({
  name: 'layouts',

  commands: [
    {
      name: 'embed',
      description: 'One embed using every EmbedBuilder setter',
      run(ctx) {
        const embed = new EmbedBuilder()
          .setTitle('Match result')
          .setURL('https://example.com/match/42')
          .setDescription(`**Blue** won 3-1. ${hyperlink('Replay', 'https://example.com/r/42')}`)
          .setColor('#ff6b4a')
          .setAuthor({ name: ctx.author.displayName, iconURL: ctx.author.avatarURL() ?? JS_LOGO })
          .addFields(
            { name: 'MVP', value: `${ctx.author}`, inline: true },
            { name: 'Time', value: '34:12', inline: true },
            { name: 'Map', value: 'Dust II', inline: true },
          )
          .addField('Notes', 'addField(name, value, inline) works too')
          .setThumbnail(JS_LOGO)
          .setImage(NODE_LOGO)
          .setTimestamp();
        // embed.length counts the footer too, so this is measured before the footer is added.
        embed.setFooter({ text: `${embed.length} of ${Limits.EmbedTotal} characters used`, iconURL: TS_LOGO });
        return ctx.reply({ embeds: [embed] });
      },
    },
    {
      name: 'embeds',
      description: 'Several embeds: builder, plain object, from(), colour formats',
      run(ctx) {
        const plain = { title: 'A plain object', description: 'Plain API-shaped objects work too.', color: 0x57f287 };
        return ctx.reply({
          content: 'Three embeds in one message:',
          embeds: [
            new EmbedBuilder().setTitle('A builder').setColor([88, 101, 242]).setDescription('Colour from `[r, g, b]`.'),
            plain,
            EmbedBuilder.from(plain).setTitle('EmbedBuilder.from(plain)').setColor('Random').spliceFields(0, 0, { name: 'Spliced in', value: 'spliceFields' }),
          ],
        });
      },
    },
    {
      name: 'embedlimits',
      description: 'Shows builder validation catching a broken limit',
      run(ctx) {
        const results = [];
        const attempt = (label, fn) => {
          try {
            fn();
            results.push(`❌ ${label}: no error`);
          } catch (error) {
            const ok = error instanceof YapinError && error.code === ErrorCodes.ValidationError;
            results.push(`${ok ? '✅' : '❌'} ${label}: ${error.message}`);
          }
        };
        attempt('title over 256', () => new EmbedBuilder().setTitle('x'.repeat(Limits.EmbedTitle + 1)));
        attempt('11 fields', () => new EmbedBuilder().addFields(...Array.from({ length: 11 }, (_, i) => ({ name: `f${i}`, value: 'v' }))));
        attempt('http image', () => new EmbedBuilder().setImage('http://i.imgur.com/x.png'));
        attempt('bad colour', () => new EmbedBuilder().setColor('not-a-colour'));
        attempt('6 buttons in a row', () => new ActionRowBuilder(...Array.from({ length: 6 }, (_, i) => ButtonBuilder.primary(`${i}`, `b${i}`))));
        attempt('link button without https', () => ButtonBuilder.link('x', 'ftp://example.com'));
        attempt('V2 with embeds', () => resolvePayload({ components: [new ContainerBuilder().add('text')], embeds: [{ title: 'x' }] }));
        attempt('empty gallery', () => new MediaGalleryBuilder().toJSON());
        return ctx.reply(results.join('\n'));
      },
    },
    {
      name: 'card',
      description: 'A Components V2 card: container, sections, accessories, separator',
      run(ctx) {
        const card = gameCard();
        const { count, text } = measureLayout([card.toJSON()]);
        // `content` on a V2 message becomes a leading text display.
        return ctx.reply({
          content: `${count}/${Limits.ComponentsV2Total} components, ${text}/${Limits.ComponentsV2Text} characters of text`,
          components: [card],
        });
      },
    },
    {
      name: 'gallery',
      description: 'Components V2: media gallery, spoiler, file card',
      run: (ctx) => ctx.reply({
        components: [
          new ContainerBuilder()
            .setAccentColor('Green')
            .add('### A gallery', new MediaGalleryBuilder().addItems(JS_LOGO, { url: TS_LOGO, spoiler: true, description: 'Spoiler' }).addItem(NODE_LOGO, { description: 'addItem()' }))
            .addSeparatorComponents((s) => s.setDivider(false))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`Allowed media hosts: ${AllowedMediaHosts.length}`))
            .addFileComponents(new FileBuilder().setURL(NODE_LOGO)),
        ],
      }),
    },
    {
      name: 'markdown',
      description: 'Every formatter, rendered in a Components V2 text display',
      run(ctx) {
        const text = [
          heading('Formatters', 2),
          `${bold('bold')} ${italic('italic')} ${strikethrough('strike')} ${inlineCode('code')}`,
          quote('quote()\nspans lines'),
          hyperlink('hyperlink()', 'https://example.com'),
          unorderedList(['unorderedList', 'items']),
          orderedList(['orderedList', 'from 3'], 3),
          `${userMention(ctx.authorId)} in ${channelMention(ctx.channelId)}`,
          `escapeMarkdown: ${escapeMarkdown('*not bold* _not italic_')}`,
          codeBlock('js', "const hello = 'codeBlock()';"),
        ].join('\n');
        return ctx.reply({ components: [new ContainerBuilder().addTextDisplayComponents(text)] });
      },
    },
  ],

  buttons: {
    'card:vote:{game}': (i) => i.ephemeral(`You voted for **${i.params.game === 'mc' ? 'Minecraft' : 'Among Us'}**.`),
    // Editing a V2 message: i.update with a new card.
    'card:edit': async (i) => {
      await i.update({ components: [gameCard({ mc: 3, au: 1 }).setAccentColor('Red')] });
      await sleep(1500);
      const message = await i.fetchMessage();
      await message.edit({ components: [gameCard({ mc: 4, au: 1 }).setAccentColor('Gold')] });
    },
  },
});
