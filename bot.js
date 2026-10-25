import { ErrorCodes } from 'yapin.js';
import { createBot } from './src/createBot.js';

const client = await createBot({ sequenceStore: '.yapin-seq', maxEventAge: 300 });

if (process.argv.includes('--watch-modules')) {
  client.modules.watch();
  client.logger.info('Watching modules/ and commands/ for changes');
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    client.logger.info('Shutting down');
    await client.destroy();
    process.exit(0);
  });
}

try {
  await client.login();
} catch (error) {
  if (error.code === ErrorCodes.TokenMissing || error.code === ErrorCodes.TokenInvalid) {
    console.error(`${error.message}\nSet YAPIN_TOKEN, e.g. node --env-file=.env bot.js`);
    process.exit(1);
  }
  throw error;
}
