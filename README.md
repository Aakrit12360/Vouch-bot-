# Discord Vouch Bot

A Discord bot that tracks member vouches, posts styled vouch embeds, awards a configured role, and can generate automatic vouches on a random interval.

## Commands

- `/vouch setup channel:#vouches role:@Vouched` configures the announcement channel and awarded role.
- `/vouch interval minimum_seconds:10 maximum_seconds:1800` enables automatic vouches with a random delay from 10 seconds to 30 minutes.
- `/vouch give user:@member service:Trusted service` adds a manual vouch.
- `/vouch set user:@member count:25` sets a total.
- `/vouch remove user:@member amount:5` removes vouches.
- `/vouch stats user:@member` displays the total and rank.

## Setup

1. Create a Discord application and bot in the Discord Developer Portal.
2. Invite it with the `bot` and `applications.commands` scopes.
3. Give it View Channels, Send Messages, Embed Links, Read Message History, and Manage Roles permissions.
4. Move the bot role above the configured vouch role.
5. Enable Server Members Intent if the bot should select from all server members.
6. Set `DISCORD_BOT_TOKEN` as a secret and optionally set `DISCORD_GUILD_ID` for instant guild-scoped slash-command registration.
7. Run `pnpm install`, `pnpm --filter @workspace/db run push`, and `pnpm --filter @workspace/api-server run dev`.

The bot stores server settings and vouch totals in PostgreSQL. Never commit the Discord token or any environment file.
