import {
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Role,
  type TextChannel,
  type User,
} from "discord.js";
import { logger } from "../lib/logger";
import {
  changeCount,
  getConfig,
  getCount,
  listConfigs,
  markPosted,
  saveConfig,
  setAutoInterval,
  setCount,
} from "./store";
import { getRank } from "./ranks";

const commands = [
  new SlashCommandBuilder()
    .setName("vouch")
    .setDescription("Manage server vouches")
    .addSubcommand((command) =>
      command
        .setName("setup")
        .setDescription("Choose where vouch messages go and which role is awarded")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("The channel for vouch announcements")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option
            .setName("role")
            .setDescription("The role awarded to members with at least one vouch")
            .setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("interval")
        .setDescription("Automatically post vouches at a random interval")
        .addIntegerOption((option) =>
          option
            .setName("minimum_seconds")
            .setDescription("Minimum delay, from 10 to 1800 seconds")
            .setMinValue(10)
            .setMaxValue(1800)
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("maximum_seconds")
            .setDescription("Maximum delay, from 10 to 1800 seconds")
            .setMinValue(10)
            .setMaxValue(1800)
            .setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("give")
        .setDescription("Give a member one vouch")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The member receiving the vouch")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("service")
            .setDescription("Optional service or transaction note")
            .setMaxLength(180),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("set")
        .setDescription("Set a member's total vouches")
        .addUserOption((option) =>
          option.setName("user").setDescription("The member").setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("count")
            .setDescription("The new total")
            .setMinValue(0)
            .setMaxValue(100000)
            .setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("remove")
        .setDescription("Remove vouches from a member")
        .addUserOption((option) =>
          option.setName("user").setDescription("The member").setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("amount")
            .setDescription("How many to remove")
            .setMinValue(1)
            .setMaxValue(100000)
            .setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("stats")
        .setDescription("View a member's vouch total and rank")
        .addUserOption((option) =>
          option.setName("user").setDescription("The member to inspect"),
        ),
    ),
].map((command) => command.toJSON());

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const guildQueues = new Map<string, Promise<void>>();
const autoVouchTimers = new Map<string, NodeJS.Timeout>();

function isModerator(interaction: ChatInputCommandInteraction): boolean {
  const member = interaction.member as GuildMember | null;
  return Boolean(
    member?.permissions.has(PermissionFlagsBits.ManageGuild) ||
      member?.permissions.has(PermissionFlagsBits.Administrator),
  );
}

function enqueue<T>(guildId: string, task: () => Promise<T>): Promise<T> {
  const previous = guildQueues.get(guildId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  guildQueues.set(
    guildId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

function formatDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function createVouchEmbed(
  user: User,
  total: number,
  service: string | null,
): EmbedBuilder {
  const rank = getRank(total);
  return new EmbedBuilder()
    .setColor(0xff5b18)
    .setAuthor({
      name: `${user.username} received a new vouch`,
      iconURL: user.displayAvatarURL({ size: 128 }),
    })
    .setTitle("⭐ New Vouch!")
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setDescription(
      [
        `**Vouched User**`,
        `<@${user.id}>`,
        ``,
        `**Total Vouches**`,
        `**${total}** (+1)`,
        ``,
        `**Current Rank**`,
        `${rank.emoji} ${rank.name}`,
      ].join("\n"),
    )
    .addFields({
      name: "Service",
      value: service || "Automatic vouch",
      inline: false,
    })
    .setFooter({
      text: `Trusted service • ${formatDate()}`,
    });
}

async function syncVouchRole(
  guild: Guild,
  userId: string,
  role: Role,
  count: number,
): Promise<void> {
  const member = await guild.members.fetch(userId);
  if (!member) return;
  if (count > 0 && !member.roles.cache.has(role.id)) {
    await member.roles.add(role, "Vouch count reached one or more");
  } else if (count === 0 && member.roles.cache.has(role.id)) {
    await member.roles.remove(role, "Vouch count reached zero");
  }
}

async function postVouch(
  guildId: string,
  user: User,
  total: number,
  service: string | null,
): Promise<void> {
  const config = await getConfig(guildId);
  if (!config) return;
  const channel = await client.channels.fetch(config.channelId);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  const textChannel = channel as TextChannel;
  await textChannel.send({
    content: `🎉 <@${user.id}> just received **+1 vouch** and is now at **${total} total**!`,
    embeds: [createVouchEmbed(user, total, service)],
  });
  await markPosted(guildId, new Date());
}

function stopAutoVouchLoop(guildId: string): void {
  const timer = autoVouchTimers.get(guildId);
  if (timer) clearTimeout(timer);
  autoVouchTimers.delete(guildId);
}

function scheduleAutoVouchLoop(
  guildId: string,
  minSeconds: number,
  maxSeconds: number,
): void {
  stopAutoVouchLoop(guildId);
  const delaySeconds =
    Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
  const timer = setTimeout(() => {
    void runAutomaticVouch(guildId)
      .catch((error) => {
        logger.error({ err: error, guildId }, "Automatic vouch cycle failed");
      })
      .finally(() => {
        scheduleAutoVouchLoop(guildId, minSeconds, maxSeconds);
      });
  }, delaySeconds * 1000);
  autoVouchTimers.set(guildId, timer);
  logger.info(
    { guildId, delaySeconds, minSeconds, maxSeconds },
    "Next automatic vouch scheduled",
  );
}

async function runAutomaticVouch(guildId: string): Promise<void> {
  const config = await getConfig(guildId);
  if (!config?.autoEnabled) return;

  const guild = await client.guilds.fetch(guildId);
  let eligibleMembers = [...guild.members.cache.values()].filter(
    (member) => !member.user.bot,
  );
  if (eligibleMembers.length === 0) {
    try {
      const owner = await guild.members.fetch(guild.ownerId);
      if (!owner.user.bot) eligibleMembers = [owner];
    } catch (error) {
      logger.warn({ err: error, guildId }, "Could not find a member for automatic vouch");
    }
  }
  if (eligibleMembers.length === 0) {
    logger.warn({ guildId }, "Automatic vouch skipped because no human members were found");
    return;
  }

  const member = eligibleMembers[Math.floor(Math.random() * eligibleMembers.length)];
  const total = await changeCount(guildId, member.id, 1);
  try {
    const role = await guild.roles.fetch(config.roleId);
    if (role) await syncVouchRole(guild, member.id, role, total);
  } catch (error) {
    logger.warn(
      { err: error, guildId, userId: member.id },
      "Could not assign automatic vouch role",
    );
  }
  await enqueue(guildId, () =>
    postVouch(guildId, member.user, total, "Automatic vouch"),
  );
}

async function handleVouch(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: "Vouch commands only work inside a server.",
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const moderatorOnly = ["setup", "interval", "set", "remove"];
  if (moderatorOnly.includes(subcommand) && !isModerator(interaction)) {
    await interaction.reply({
      content: "You need Manage Server permission to use this vouch command.",
      ephemeral: true,
    });
    return;
  }

  if (subcommand === "setup") {
    const channel = interaction.options.getChannel("channel", true);
    const role = interaction.options.getRole("role", true);
    const config = await saveConfig(guildId, channel.id, role.id);
    await interaction.reply({
      content: `Vouch messages will go to <#${config.channelId}>. Members will receive <@&${config.roleId}> after their first vouch. Automatic vouches are ${config.autoEnabled ? `enabled at ${config.intervalMinSeconds}–${config.intervalMaxSeconds} seconds` : "currently off; use `/vouch interval` to enable them"}.`,
      ephemeral: true,
    });
    if (config.autoEnabled) {
      scheduleAutoVouchLoop(
        guildId,
        config.intervalMinSeconds,
        config.intervalMaxSeconds,
      );
    } else {
      stopAutoVouchLoop(guildId);
    }
    return;
  }

  if (subcommand === "interval") {
    const minSeconds = interaction.options.getInteger("minimum_seconds", true);
    const maxSeconds = interaction.options.getInteger("maximum_seconds", true);
    if (minSeconds > maxSeconds) {
      await interaction.reply({
        content: "The minimum delay must be less than or equal to the maximum delay.",
        ephemeral: true,
      });
      return;
    }
    const config = await setAutoInterval(guildId, minSeconds, maxSeconds);
    scheduleAutoVouchLoop(guildId, minSeconds, maxSeconds);
    await interaction.reply({
      content: `Automatic vouches are enabled. A random non-bot member will receive a vouch every ${config.intervalMinSeconds}–${config.intervalMaxSeconds} seconds.`,
      ephemeral: true,
    });
    return;
  }

  if (subcommand === "give") {
    const user = interaction.options.getUser("user", true);
    const service = interaction.options.getString("service");
    const config = await getConfig(guildId);
    if (!config) {
      await interaction.reply({
        content: "Run `/vouch setup` first so I know the announcement channel and role.",
        ephemeral: true,
      });
      return;
    }
    const total = await changeCount(guildId, user.id, 1);
    await interaction.deferReply({ ephemeral: true });
    try {
      const role = await interaction.guild?.roles.fetch(config.roleId);
      if (role && interaction.guild) await syncVouchRole(interaction.guild, user.id, role, total);
    } catch (error) {
      logger.warn({ err: error, guildId, userId: user.id }, "Could not assign vouch role");
    }
    await enqueue(guildId, () => postVouch(guildId, user, total, service));
    await interaction.editReply(`Added one vouch to ${user}. They now have ${total}.`);
    return;
  }

  if (subcommand === "set") {
    const user = interaction.options.getUser("user", true);
    const count = interaction.options.getInteger("count", true);
    const config = await getConfig(guildId);
    const total = await setCount(guildId, user.id, count);
    if (config) {
      try {
        const role = await interaction.guild?.roles.fetch(config.roleId);
        if (role && interaction.guild) await syncVouchRole(interaction.guild, user.id, role, total);
      } catch (error) {
        logger.warn({ err: error, guildId, userId: user.id }, "Could not assign vouch role");
      }
    }
    await interaction.reply({
      content: `Set ${user}'s total to ${total} vouch(es).`,
      ephemeral: true,
    });
    return;
  }

  if (subcommand === "remove") {
    const user = interaction.options.getUser("user", true);
    const amount = interaction.options.getInteger("amount", true);
    const total = await changeCount(guildId, user.id, -amount);
    const config = await getConfig(guildId);
    if (config) {
      try {
        const role = await interaction.guild?.roles.fetch(config.roleId);
        if (role && interaction.guild) await syncVouchRole(interaction.guild, user.id, role, total);
      } catch (error) {
        logger.warn({ err: error, guildId, userId: user.id }, "Could not sync vouch role");
      }
    }
    await interaction.reply({
      content: `Removed ${amount} vouch(es) from ${user}. They now have ${total}.`,
      ephemeral: true,
    });
    return;
  }

  const user = interaction.options.getUser("user") ?? interaction.user;
  const total = await getCount(guildId, user.id);
  const rank = getRank(total);
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`${user.username}'s Vouch Stats`)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: "Total Vouches", value: `${total}`, inline: true },
          { name: "Current Rank", value: `${rank.emoji} ${rank.name}`, inline: true },
        ),
    ],
    ephemeral: true,
  });
}

client.once("clientReady", async (readyClient) => {
  const rest = new REST({ version: "10" }).setToken(readyClient.token);
  const applicationId = readyClient.application.id;
  const guildId = process.env["DISCORD_GUILD_ID"];
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
      body: commands,
    });
    logger.info({ guildId, user: readyClient.user.tag }, "Discord vouch commands registered for guild");
  } else {
    await rest.put(Routes.applicationCommands(applicationId), { body: commands });
    logger.info({ user: readyClient.user.tag }, "Discord vouch commands registered globally");
  }
  const configs = await listConfigs();
  for (const config of configs) {
    if (config.autoEnabled) {
      scheduleAutoVouchLoop(
        config.guildId,
        config.intervalMinSeconds,
        config.intervalMaxSeconds,
      );
    }
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "vouch") return;
  try {
    await handleVouch(interaction);
  } catch (error) {
    logger.error({ err: error }, "Vouch command failed");
    const response = {
      content: "That vouch action could not be completed. Check the bot's permissions and try again.",
      ephemeral: true,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(response);
    } else {
      await interaction.reply(response);
    }
  }
});

export async function startDiscordBot(): Promise<void> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    logger.warn("DISCORD_BOT_TOKEN is not configured; Discord bot is disabled");
    return;
  }
  await client.login(token);
}