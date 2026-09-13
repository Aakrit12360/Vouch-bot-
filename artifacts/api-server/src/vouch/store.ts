import { and, eq, sql } from "drizzle-orm";
import { db, vouchConfigs, vouchCounts } from "@workspace/db";

export type VouchConfig = typeof vouchConfigs.$inferSelect;

export async function getConfig(guildId: string): Promise<VouchConfig | null> {
  const [config] = await db
    .select()
    .from(vouchConfigs)
    .where(eq(vouchConfigs.guildId, guildId))
    .limit(1);
  return config ?? null;
}

export async function saveConfig(
  guildId: string,
  channelId: string,
  roleId: string,
): Promise<VouchConfig> {
  const [config] = await db
    .insert(vouchConfigs)
    .values({ guildId, channelId, roleId })
    .onConflictDoUpdate({
      target: vouchConfigs.guildId,
      set: { channelId, roleId, updatedAt: new Date() },
    })
    .returning();

  if (!config) {
    throw new Error("Could not save the vouch configuration.");
  }
  return config;
}

export async function setIntervalMinutes(
  guildId: string,
  minutes: number,
): Promise<VouchConfig> {
  const [config] = await db
    .update(vouchConfigs)
    .set({ intervalMinutes: minutes, updatedAt: new Date() })
    .where(eq(vouchConfigs.guildId, guildId))
    .returning();

  if (!config) {
    throw new Error("Run /vouch setup before setting the interval.");
  }
  return config;
}

export async function setAutoInterval(
  guildId: string,
  minSeconds: number,
  maxSeconds: number,
): Promise<VouchConfig> {
  const [config] = await db
    .update(vouchConfigs)
    .set({
      intervalMinSeconds: minSeconds,
      intervalMaxSeconds: maxSeconds,
      autoEnabled: true,
      updatedAt: new Date(),
    })
    .where(eq(vouchConfigs.guildId, guildId))
    .returning();

  if (!config) {
    throw new Error("Run /vouch setup before setting the automatic interval.");
  }
  return config;
}

export async function listConfigs(): Promise<VouchConfig[]> {
  return db.select().from(vouchConfigs);
}

export async function markPosted(
  guildId: string,
  postedAt: Date,
): Promise<void> {
  await db
    .update(vouchConfigs)
    .set({ lastPostedAt: postedAt, updatedAt: new Date() })
    .where(eq(vouchConfigs.guildId, guildId));
}

export async function getCount(guildId: string, userId: string): Promise<number> {
  const [record] = await db
    .select({ count: vouchCounts.count })
    .from(vouchCounts)
    .where(
      and(eq(vouchCounts.guildId, guildId), eq(vouchCounts.userId, userId)),
    )
    .limit(1);
  return record?.count ?? 0;
}

export async function changeCount(
  guildId: string,
  userId: string,
  delta: number,
): Promise<number> {
  const [record] = await db
    .insert(vouchCounts)
    .values({ guildId, userId, count: Math.max(0, delta) })
    .onConflictDoUpdate({
      target: [vouchCounts.guildId, vouchCounts.userId],
      set: {
        count: sql`GREATEST(0, ${vouchCounts.count} + ${delta})`,
        updatedAt: new Date(),
      },
    })
    .returning({ count: vouchCounts.count });

  if (!record) {
    throw new Error("Could not update the vouch count.");
  }
  return record.count;
}

export async function setCount(
  guildId: string,
  userId: string,
  count: number,
): Promise<number> {
  const [record] = await db
    .insert(vouchCounts)
    .values({ guildId, userId, count })
    .onConflictDoUpdate({
      target: [vouchCounts.guildId, vouchCounts.userId],
      set: { count, updatedAt: new Date() },
    })
    .returning({ count: vouchCounts.count });

  if (!record) {
    throw new Error("Could not set the vouch count.");
  }
  return record.count;
}