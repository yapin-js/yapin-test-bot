// Files starting with _ are skipped by commands.load(). If this ever loads, the bot fails to start.
throw new Error('commands/_not-loaded.js was loaded: files starting with _ should be skipped');
