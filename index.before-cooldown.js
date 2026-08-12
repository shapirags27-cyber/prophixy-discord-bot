require("dotenv").config();

const fs = require("fs");
const path = require("path");

const {
  Client,
  Collection,
  GatewayIntentBits,
  MessageFlags,
  Events
} = require("discord.js");

const {
  initDB,
  getUser,
  createUser
} = require("./services/database");

const {
  cacheGuildInvites,
  findUsedInvite,
  recordInvite
} = require("./services/invites");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// ==============================
// COMMANDS
// ==============================

client.commands = new Collection();

const commandsPath =
  path.join(__dirname, "commands");

const commandFiles =
  fs.readdirSync(commandsPath)
    .filter(file => file.endsWith(".js"));

for (const file of commandFiles) {

  const filePath =
    path.join(commandsPath, file);

  const command =
    require(filePath);

  if (!command.data || !command.execute) {

    console.log(
      `⚠️ Skipping invalid command: ${file}`
    );

    continue;
  }

  client.commands.set(
    command.data.name,
    command
  );

  console.log(
    `📌 Loaded command: /${command.data.name}`
  );
}

// ==============================
// API
// ==============================

require("./api")(client);

// ==============================
// INVITE CACHE
// ==============================

const guildInvites = new Map();

// ==============================
// READY
// ==============================

client.once(
  Events.ClientReady,
  async () => {

    await initDB();

    console.log(
      `✅ Ready: ${client.user.tag}`
    );

    for (
      const guild of client.guilds.cache.values()
    ) {

      try {

        const invites =
          await cacheGuildInvites(guild);

        guildInvites.set(
          guild.id,
          invites
        );

        console.log(
          `🔗 Cached ${Object.keys(invites).length} invite(s) for ${guild.name}`
        );

      } catch (error) {

        console.error(
          `❌ Could not cache invites for ${guild.name}:`,
          error.message
        );

      }

    }

  }
);

// ==============================
// GENERATE INVITE BUTTON
// ==============================

client.on(
  Events.InteractionCreate,
  async interaction => {

    // ==========================
    // BUTTON
    // ==========================
if (interaction.isButton()) {

  if (interaction.customId !== "generate_prophixy_invite") {
    return;
  }

  try {

    // IMPORTANT:
    // Acknowledge the interaction immediately.
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });

    const guild = interaction.guild;

    if (!guild) {

      return interaction.editReply({
        content:
          "❌ This button can only be used inside the Prophixy server."
      });

    }

    console.log(
      `🎟️ Generating invite for ${interaction.user.tag}`
    );

    // Make sure the user exists
    let user = await getUser(interaction.user.id);

    if (!user) {

      user = await createUser(
        interaction.user.id,
        interaction.user.username
      );

    }

    // Find a channel where the bot can create invites
    const channel =
      guild.channels.cache.find(
        channel =>
          channel.isTextBased() &&
          channel
            .permissionsFor(guild.members.me)
            ?.has("CreateInstantInvite")
      );

    if (!channel) {

      return interaction.editReply({
        content:
          "❌ I don't have permission to create Discord invites."
      });

    }

    console.log(
      `🔗 Creating 7-day invite for ${interaction.user.tag}...`
    );

    // Create unique invite lasting 7 days
    const invite =
      await channel.createInvite({

        maxAge: 7 * 24 * 60 * 60,

        maxUses: 0,

        unique: true,

        reason:
          `Prophixy invite for ${interaction.user.tag}`

      });

    console.log(
      `✅ Invite created: ${invite.code}`
    );

    // Save invite information
    const { db } = require("./services/database");

    await db.read();

    const dbUser =
      db.data.users.find(
        u =>
          u.discordId ===
          interaction.user.id
      );

    if (dbUser) {

      dbUser.inviteCode =
        invite.code;

      dbUser.inviteCreatedAt =
        new Date().toISOString();

      dbUser.inviteExpiresAt =
        new Date(
          Date.now() +
          7 * 24 * 60 * 60 * 1000
        ).toISOString();

      await db.write();

    }

    // Refresh invite cache
    try {

      const invites =
        await cacheGuildInvites(guild);

      guildInvites.set(
        guild.id,
        invites
      );

    } catch (cacheError) {

      console.error(
        "⚠️ Could not refresh invite cache:",
        cacheError.message
      );

    }

    // Send the result
    await interaction.editReply({

      content:
`# 🔗 Your Prophixy Invite

Your unique invite is ready:

**${invite.url}**

⏳ **Expires:** 7 days from now

👥 **Reward:** +10 points for each successful invite

🎁 Share this link with your friends!

⚠️ You can only receive credit for the same member once.`

    });

    console.log(
      `🎉 Invite delivered to ${interaction.user.tag}`
    );

  } catch (error) {

    console.error(
      "❌ Generate invite error:",
      error
    );

    try {

      if (interaction.deferred) {

        await interaction.editReply({
          content:
            "❌ I couldn't generate your invite. Please try again."
        });

      } else if (!interaction.replied) {

        await interaction.reply({
          content:
            "❌ I couldn't generate your invite. Please try again.",
          flags: MessageFlags.Ephemeral
        });

      }

    } catch (replyError) {

      console.error(
        "❌ Could not send invite error response:",
        replyError
      );

    }

  }

  return;
}


});

// ==============================
// LOGIN
// ==============================

client.login(process.env.DISCORD_TOKEN);
