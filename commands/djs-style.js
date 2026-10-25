// discord.js-style command file: `data` plus `execute`.
export const data = {
  name: 'legacy',
  description: 'A command written discord.js style (data + execute)',
  category: 'Basics',
};

export function execute(ctx) {
  return ctx.reply('This command came from `export const data` + `export function execute`.');
}
