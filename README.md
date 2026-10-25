# yapin-test-bot

A Yapin’ bot whose job is to exercise every part of [yapin.js](https://github.com/yapin-js/yapin.js). It has 67 commands across 10 categories, three module styles, an offline unit suite and an end-to-end simulator.

## Run it

```sh
npm install
cp .env.example .env              # put your yb_ token in it
node --env-file=.env bot.js       # or: npm run dev  (hot-reloads modules/ and commands/ on save)
```

Then type `/help` in your server.

## Test it without a token

```sh
npm run selftest     # 50 unit checks of builders, parsing, routing, REST, webhooks, OAuth2… (~1s)
npm run simulate     # boots the real bot against an in-memory mock API and drives 46 scenarios (~10s)
npm test             # both
```

`npm run selftest -- Commands REST` runs only some areas. `SIM_VERBOSE=1 npm run simulate` shows the bot's logs.

Two checks fail on purpose because they catch real yapin.js bugs (see [FINDINGS.md](FINDINGS.md)):
`Routing › each matching handler sees its own pattern params` and
`Arguments › a channel option finds a channel by name on a fresh cache`.

## What exercises what

| Where | Style | Covers |
| --- | --- | --- |
| [commands/basics.js](commands/basics.js) | command file (array) | `/ping` (reply + edit), `/echo`, `/say`, `/about` |
| [commands/arguments.js](commands/arguments.js) | command file | every option type, choices, defaults, `validate`, rest arrays, a custom `hex` type, `ctx.argv` |
| [commands/config.js](commands/config.js) | command file | subcommands, nested subcommands, aliases, parent-level `serverOnly`, per-subcommand permissions |
| [commands/checks.js](commands/checks.js) | command file | `ownerOnly`, `roles`, `permissions`, custom checks, cooldowns (user and channel scope, reset), thrown / `ctx.error` / silent errors, `hidden`, `register: false` |
| [commands/djs-style.js](commands/djs-style.js) | `data` + `execute` | discord.js-style command files |
| [modules/buttons.js](modules/buttons.js) | `class extends Module` | every button style, `{param}` / `*` / RegExp routes, update, ephemeral, reply, defer + follow-up, auto-ack, `components.once`, paginator |
| [modules/layouts.js](modules/layouts.js) | `defineModule` | every `EmbedBuilder` setter, several embeds, validation errors, Components V2 containers / sections / thumbnails / galleries / files, editing V2 messages, every formatter |
| [modules/collectors.js](modules/collectors.js) | `export function setup` | `awaitMessages`, message collectors (idle/max/stop), `awaitMessageComponent`, component collectors, reaction collectors with dispose, `for await`, `collector.next` |
| [modules/inspect.js](modules/inspect.js) | class | servers, channels, members, roles, voice, message history, reactions, caches, `splitMessage` |
| [modules/moderation.js](modules/moderation.js) | `defineModule` + module `check` | timeout, untimeout, nickname, roles, pin, purge (no kick/ban, so tests can't remove anyone) |
| [modules/diagnostics.js](modules/diagnostics.js) | class | `/selftest`, `/stats`, raw `client.rest`, un-awaited send errors, `/modules list/reload/unload/load`, maintenance mode, `/sync`, `/presence` |
| [modules/events.js](modules/events.js) | `defineModule` | member join/leave, reactions, voice, the test event, @mentions |
| [src/createBot.js](src/createBot.js) | | client options, middleware (a maintenance gate and timing), every framework event, folder loading |

Owner-only commands answer to the bot's owner (from Settings → Developer) and any ids in `OWNER_IDS`.
