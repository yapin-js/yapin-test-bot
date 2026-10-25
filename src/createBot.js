import { Client, Events, Logger } from 'yapin.js';
import { stats } from './stats.js';

const ownerIds = () => (process.env.OWNER_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);

/**
 * Builds the test bot without logging in, so bot.js and the offline simulator share the exact same
 * setup. `overrides` are passed to the Client (the simulator swaps in a mock API this way).
 */
export async function createBot(overrides = {}) {
  const client = new Client({
    prefixes: ['/', '!', 'yt!'],
    presence: { status: 'online', activity: 'Testing yapin.js' },
    logger: new Logger({ level: process.env.LOG_LEVEL ?? 'info', prefix: '[test-bot]' }),
    commands: {
      help: { title: 'yapin.js test bot', color: 'Blurple', aliases: ['commands'] },
      owners: ownerIds(),
    },
    ...overrides,
  });

  // A custom option type, used by /paint.
  client.commands.types.register(
    'hex',
    (text) => (/^#?[0-9a-f]{6}$/i.test(text) ? parseInt(text.replace('#', ''), 16) : undefined),
    { message: 'That should be a colour like #ff6b4a' },
  );

  // Middleware 1: a global maintenance gate that owners can pass.
  client.commands.use(async (ctx, next) => {
    const isOwner = ctx.authorId === client.application?.ownerId || client.options.commands.owners.includes(ctx.authorId);
    if (stats.maintenance && !isOwner) return ctx.reply('🚧 The bot is in maintenance mode. Try again soon.');
    await next();
  });

  // Middleware 2: timing, and something for later steps to read through ctx.state.
  client.commands.use(async (ctx, next) => {
    ctx.state.startedAt = performance.now();
    await next();
    stats.recordCommand(ctx.command.path, performance.now() - ctx.state.startedAt);
  });

  client.on(Events.ClientReady, (c) => c.logger.info(`Ready as ${c.user.displayName} (${c.user.id}) via ${c.transport ?? 'starting'}`));
  client.on(Events.Connected, ({ transport, previous }) => client.logger.info(`Events via ${transport}${previous ? ` (was ${previous})` : ''}`));
  client.on(Events.Disconnected, ({ transport, code }) => client.logger.warn(`${transport} disconnected (${code})`));
  client.on(Events.CommandsSynced, (commands) => client.logger.info(`Synced ${commands.length} commands to the / menu`));
  client.on(Events.RateLimited, ({ method, path, retryAfter, global }) => {
    stats.rateLimits++;
    client.logger.warn(`Rate limited on ${method} ${path} for ${retryAfter}s${global ? ' (bot-wide)' : ''}`);
  });
  client.on(Events.Raw, (event) => stats.recordEvent(event.type));
  client.on(Events.CommandDenied, (error, ctx) => {
    stats.denied++;
    client.logger.debug(`/${ctx.command.path} denied for ${ctx.author?.username}: ${error.name} ${error.message}`);
  });
  client.on(Events.CommandError, (error, ctx) => {
    stats.errors++;
    client.logger.error(`/${ctx.command.path} failed for ${ctx.author?.username}:`, error);
  });
  client.on(Events.Error, (error) => {
    stats.errors++;
    const where = [error.module && `module ${error.module}`, error.command && `/${error.command}`, error.where].filter(Boolean).join(' ');
    client.logger.error(where ? `[${where}]` : '', error);
  });

  await client.commands.load(new URL('../commands', import.meta.url));
  await client.modules.load(new URL('../modules', import.meta.url));
  return client;
}
