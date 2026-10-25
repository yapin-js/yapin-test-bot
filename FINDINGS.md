# yapin.js 0.1.0-beta.1: findings from building a test bot

I built a bot that touches nearly every public part of yapin.js: 67 commands, 7 modules in all three module styles, 50 offline unit checks, and a simulator that runs the real bot against a mock API through 46 scenarios.

**Caveat:** I had no bot token, so nothing here ran against the live Yapin’ API. The mock API is reverse-engineered from the yapin.js source. Where behaviour depends on what Yapin’ itself accepts, I say so.

## Summary

| | Verdict |
| --- | --- |
| Setup | **Very easy.** One dependency, installs in about a second, and a working command is three lines. |
| Beginner | **Good**, with a few traps around `this` and module styles. |
| Intermediate | **Excellent.** Commands, buttons, collectors and modules feel like discord.js done right. |
| Advanced | **Good.** It's injectable (`fetch`, `baseURL`, `WebSocket`, logger), but there are no testing utilities and the response shapes aren't documented. |
| Documentation | **Strong: 8/10.** Clear and complete for the happy path. A handful of details are missing or don't match the code. |
| Bugs found | **2 confirmed**, plus 1 docs/code mismatch and several sharp edges (below) |

## 1. How easy was it to set up?

Very. `npm i yapin.js` pulled in one package with zero dependencies. From there:

- `new Client()` plus `client.command('ping', 'Pong!', (ctx) => ctx.reply('pong'))` plus `client.login()` is a complete bot.
- `commands.load('./commands')` and `modules.load('./modules')` loaded 13 files on the first try, and correctly skipped `_not-loaded.js`.
- Token mistakes are caught before any network request, with an actionable message ("Bot tokens start with yb_. Get one in Settings → Developer → your bot → Token."). The self-test checks that no request is made.
- The one stumble is that `npm init -y` doesn't add `"type": "module"`. The README and getting-started guide both say to add it, but a beginner who skims will get a `SyntaxError: Cannot use import statement`. An `npm create yapin-bot` starter, or a clear error, would remove that step.

Because the client takes `fetch` and `baseURL` options, a complete offline mock took about 300 lines and needed no monkey-patching. That's a big point in its favour.

## 2. Feasibility by experience level

### Beginner (first bot, some JavaScript)

Feasible, and better than most frameworks. The things that help most:

- **Error replies are written for end users.** A mistyped argument gets ``Missing `n`. Usage: `/even <n>` `` or ``` `colour` must be one of: `red`, `green`, `blue` ```. A beginner gets helpful UX without writing any.
- **Your mistakes don't crash the bot.** A `reply()` you didn't `await` that fails goes to the `error` event. So does a throwing listener. `/unawaited` and `/boom` in this bot show both.
- **Builders fail at the line that's wrong**, with the limit in the message ("Embed title is 257 characters; the limit is 256").
- **`/help` is built in**, and `ctx.error('…')` is the obvious way to say no.

Where a beginner will get stuck:

- **`this` differs by module style** (details in 4.4). I hit this twice in this project.
- **Three ways to write a module, plus command files**, all valid. That's flexible, but a beginner reading two examples written in different styles won't know which to copy. The docs could recommend one.
- **`ownerOnly` means the bot's owner, not the server owner**, while `permissions` treats the server owner as having everything. That's reasonable, but worth saying in the `ownerOnly` row.

### Intermediate (has built a discord.js bot)

This is where yapin.js shines. Everything maps one-to-one (`EmbedBuilder`, `ActionRowBuilder`, `awaitMessageComponent`, `Collection`, `ctx.options.getMember`), and it adds things discord.js leaves to you:

- typed options with `min`/`max`/`choices`/`validate`, custom types, cooldown scopes, middleware
- button routing by pattern (`'page:{list}:{n}'`, RegExp groups) instead of one big `interactionCreate` switch
- automatic acknowledgement of clicks no handler answered (the auto-ack), so slow handlers don't show "This interaction failed"
- hot-reloadable modules that put the old version back if the new one fails to load

All 46 simulated scenarios (collectors, pagination, V2 card edits, permission-gated subcommands, hot reload) were written straight from the docs. The two that failed did so because of framework bugs, not because the API was hard to use.

### Advanced (testing, custom infrastructure, contributing)

Good, with gaps:

- **The injection points are excellent:** `fetch`, `baseURL`, `WebSocket: false`, `transport: 'polling'`, `logger`, and `sequenceStore`.
- **There are no testing utilities.** To unit-test routing and event handling without a network, I had to call private methods (`client._dispatch`, `client.components._handle`). The repo's own `test/` has a mock API, but it isn't exported. A `yapin.js/testing` entry point (a mock server plus `emit`/`say`/`click` helpers like [sim/mockApi.js](sim/mockApi.js)) would be the single most useful addition for serious users.
- **API response shapes aren't documented.** I had to read the managers to learn that a send returns `{ message }`, a member list returns `{ members }`, and reactions come one row per user. Anyone writing raw `client.rest` calls, which [rest.md](node_modules/yapin.js/docs/rest.md) encourages, needs this too.
- I didn't evaluate the 1,623-line `types/index.d.ts`.

## 3. How well is it documented?

The 20 docs pages are concise, consistently structured (a table of every option and method, then an example), and accurate in nearly every detail I checked against the source. The rate-limit page and the "where errors go" table are better than what most mature libraries offer.

What's missing or wrong:

| Topic | Problem |
| --- | --- |
| Components V2 types | [components.md](node_modules/yapin.js/docs/components.md) lists `ActionRowBuilder` as type `1` and says layouts use "the standard Components V2 JSON". In fact rows and buttons serialise as `type: 'row'` / `type: 'button'`, even inside a V2 container, next to numeric `17`/`9`/`10`. Either the docs or the code is wrong. I couldn't check which one the API accepts. |
| `measureLayout` | It needs JSON. Given a builder it silently returns the wrong text count (`{ count: 3, text: 0 }` vs `{ count: 3, text: 10 }`). This isn't documented. |
| `this` in modules | Not covered. See 4.4. |
| `/help` limits | `/help` shows at most 10 categories (`.slice(0, 10)`). An 11th category's commands silently disappear. This bot has exactly 10. |
| `members.search` | Described as searching "by name or nickname". It's an exact, case-insensitive match, so `search('ali')` won't find `alice`. |
| `Permissions` for owners | `has()` is `true` for the server owner but `toArray()` returns `[]`, so a "your permissions" readout shows nothing for the most powerful person. `/me` here has to special-case it. |
| REST response shapes | Not documented anywhere (see above). |

## 4. Bugs and what I'd improve

### 4.1 Bug: button handlers see another route's params (confirmed)

[ComponentRouter.js `_handle`](node_modules/yapin.js/src/interactions/ComponentRouter.js) sets `interaction.params` inside the matching loop, but defers every handler to a microtask. When two patterns match one click (`'shop:{item}'` and `'shop:*'`), every handler runs after the loop has finished, so all of them see the **last** route's params. `shop:{item}` gets `i.params.item === undefined`.

Reproduced by the self-test check `Routing › each matching handler sees its own pattern params`.

Fix: pass the params to each handler (`route.handler(interaction, named)`), or set them inside the deferred callback just before calling it. That second option still breaks for handlers that read `i.params` after an `await`. A per-handler proxy doesn't work either, because `ButtonInteraction` uses `#private` fields.

### 4.2 Bug: channel options can't find most channels by name (confirmed)

The `channel` type in [ArgumentTypes.js](node_modules/yapin.js/src/commands/ArgumentTypes.js) only fetches the server's channel list when `server.channels.cache.size` is 0. Every incoming message adds its own channel to that cache. So in practice, `/chan bot-commands` fails with "I can't find that channel" unless something already fetched the list. Mentions and ids work, because they fetch one channel directly.

Reproduced by the simulator scenario `Arguments › a channel option finds a channel by name on a fresh cache`.

Fix: on a cache miss, fetch the list and look again, or track an "all channels fetched" flag the way `roles.ensure()` does.

### 4.3 Mismatch: row and button JSON types

See the table in section 3. Whichever is right, make the code and the docs agree, and add a test that sends a V2 container holding an action row to the real API.

### 4.4 Improvement: make `this` consistent across module styles

What `this` is depends on how you wrote the code:

| Written as | `this` in `run` / listeners |
| --- | --- |
| A command file | the definition object |
| A class module | the module instance (bound), so `this.client` and `this.logger` work |
| `defineModule` | the definition object, so `this.client` and `this.logger` are `undefined` |

The class example in [modules.md](node_modules/yapin.js/docs/modules.md) teaches `this.logger`. Copy that habit into a `defineModule` and you get `TypeError: Cannot read properties of undefined`. [modules/events.js](modules/events.js) has to stash the context from `setup()` to work around it. Either bind `defineModule` handlers to an object that has `client`/`logger`, or pass the `ModuleContext` as a final argument everywhere.

### 4.5 Other improvements, roughly by value

1. **Ship `yapin.js/testing`** with a mock API and event helpers (see section 2).
2. **Document REST response shapes**, at least per manager.
3. **Warn when `/help` drops categories**, or paginate it with buttons, which the framework already makes easy.
4. **`measureLayout` should accept builders** (call `toJSON()` on anything that has one), like `resolvePayload` does.
5. **Add a `members.search` option for partial matches**, or rename it `findByName` to match `channels.findByName`.
6. **A `Permissions.all` flag in `toArray()`/readouts**, or document that owners show `[]`.
7. **An `npm create` starter** that sets `"type": "module"` and an `.env`.
8. **`i.responses` naming**: it counts answers sent so far, including the one in flight, so reading it inside `followUp(...)` gives the count before that follow-up. Fine, but easy to misread.

## What went right, briefly

Only two framework bugs turned up in about 3,100 lines of bot and test code that pushed on every feature. The error-handling design (soft promises, tagged errors, user-facing replies), the polling-or-gateway transport and event deduplication (a webhook delivery and a polled copy of the same event were handled exactly once), and module hot reload with rollback are all production-grade ideas, done cleanly.
