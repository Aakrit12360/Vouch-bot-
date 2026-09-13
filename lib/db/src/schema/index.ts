import {
  boolean,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const vouchConfigs = pgTable("vouch_configs", {
  guildId: text("guild_id").primaryKey(),
  channelId: text("channel_id").notNull(),
  roleId: text("role_id").notNull(),
  intervalMinutes: integer("interval_minutes").notNull().default(1),
  intervalMinSeconds: integer("interval_min_seconds").notNull().default(10),
  intervalMaxSeconds: integer("interval_max_seconds").notNull().default(1800),
  autoEnabled: boolean("auto_enabled").notNull().default(false),
  lastPostedAt: timestamp("last_posted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const vouchCounts = pgTable(
  "vouch_counts",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);