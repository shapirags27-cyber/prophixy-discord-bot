require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ChannelType,
  PermissionFlagsBits
} = require("discord.js");

const {
  initDB,
  getUser,
  createUser,
} = require("./services/database");

const { createEvent } = require("./events/createEvent");
const { handleVote } = require("./interactions/vote");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, async () => {
  await initDB();

  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log("🚀 Prophixy Beta is online!");
});

client.on(Events.InteractionCreate, async (interaction) => {

  if (interaction.isButton() && interaction.customId === "generate_prophixy_invite") {
    console.log(
      "⏱️ INVITE RECEIVED:",
      new Date().toISOString(),
      "created:",
      interaction.createdAt.toISOString(),
      "delay:",
      `${Date.now() - interaction.createdTimestamp}ms`
    );
  }

  try {

    // -----------------------------
    // BUTTON INTERACTIONS
    // -----------------------------
    if (interaction.isButton()) {

      if (interaction.customId === "close_prophixy_ticket") {

        try {

          const channel = interaction.channel;

          if (!channel || channel.type !== ChannelType.GuildText) {

            await interaction.reply({
              content: "❌ This is not a ticket channel.",
              flags: MessageFlags.Ephemeral
            }).catch(() => {});

            return;
          }

          // Acknowledge immediately.
          await interaction.reply({
            content:
              "🔒 Ticket closed. This channel will be deleted in 5 seconds.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});

          console.log(
            `🔒 Closing ticket #${channel.name} for ${interaction.user.tag}`
          );

          setTimeout(async () => {

            await channel.delete(
              "Prophixy support ticket closed"
            ).then(() => {

              console.log(
                `🗑️ Ticket deleted: #${channel.name}`
              );

            }).catch(error => {

              console.error(
                "❌ Could not delete ticket:",
                error
              );

            });

          }, 5000);

        } catch (error) {

          console.error(
            "❌ Ticket close error:",
            error
          );

        }

        return;
      }

      if (interaction.customId === "generate_prophixy_invite") {
        await handleGenerateInvite(interaction);
        return;
      }

      // ==============================
      // OPEN SUPPORT TICKET
      // ==============================

      if (interaction.customId === "open_prophixy_ticket") {

        try {

          await interaction.deferReply({
            flags: MessageFlags.Ephemeral
          });

          const guild = interaction.guild;

          if (!guild) {
            return interaction.editReply({
              content:
                "❌ This ticket can only be opened inside the Prophixy server."
            });
          }

          const user = interaction.user;

          // Check if user already has an open ticket
          const existingTicket = guild.channels.cache.find(
            channel =>
              channel.type === ChannelType.GuildText &&
              channel.name === `ticket-${user.username.toLowerCase()}`
          );

          if (existingTicket) {
            return interaction.editReply({
              content:
                `🎫 You already have an open ticket: ${existingTicket}`
            });
          }

          // Find or create ticket category
          let category = guild.channels.cache.find(
            channel =>
              channel.type === ChannelType.GuildCategory &&
              channel.name === "🎫 SUPPORT TICKETS"
          );

          if (!category) {

            category = await guild.channels.create({
              name: "🎫 SUPPORT TICKETS",
              type: ChannelType.GuildCategory
            });

          }

          // Find staff roles
          const staffRoleNames = [
            "Mod",
            "Moderator",
            "Team"
          ];

          const staffRoles = guild.roles.cache.filter(role =>
            staffRoleNames.some(
              name =>
                role.name.toLowerCase() === name.toLowerCase()
            )
          );

          // Permission overwrites
          const permissionOverwrites = [

            {
              id: guild.id,
              deny: [
                PermissionFlagsBits.ViewChannel
              ]
            },

            {
              id: user.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles
              ]
            },

            {
              id: guild.members.me.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages
              ]
            }

          ];

          // Give staff access
          for (const role of staffRoles.values()) {

            permissionOverwrites.push({
              id: role.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles
              ]
            });

          }

          // Create ticket channel
          const ticketChannel = await guild.channels.create({

            name: `ticket-${user.username.toLowerCase()}`,

            type: ChannelType.GuildText,

            parent: category.id,

            permissionOverwrites

          });

          // Ticket embed
          const embed = new EmbedBuilder()
            .setTitle("🎫 Prophixy Support Ticket")
            .setDescription(
              `Hello ${user}, welcome to Prophixy Support!\n\n` +
              `A member of the **Prophixy Team / Moderation team** will assist you shortly.\n\n` +
              `Please explain your issue clearly and provide any relevant information.\n\n` +
              `🔒 This channel is private.`
            )
            .addFields(
              {
                name: "👤 User",
                value: `${user}`,
                inline: true
              },
              {
                name: "📌 Status",
                value: "🟢 Open",
                inline: true
              }
            )
            .setFooter({
              text: "Prophixy • Shape Africa’s Future"
            });

          // Close button
          const closeButton = new ButtonBuilder()
            .setCustomId("close_prophixy_ticket")
            .setLabel("Close Ticket")
            .setEmoji("🔒")
            .setStyle(ButtonStyle.Danger);

          const row = new ActionRowBuilder()
            .addComponents(closeButton);

          await ticketChannel.send({
            content: `${user}`,
            embeds: [embed],
            components: [row]
          });

          await interaction.editReply({
            content:
              `✅ Your support ticket has been created: ${ticketChannel}`
          });

          console.log(
            `🎫 Ticket created for ${user.tag}: #${ticketChannel.name}`
          );

        } catch (error) {

          console.error("❌ Ticket creation error:", error);

          if (interaction.deferred || interaction.replied) {

            await interaction.editReply({
              content:
                "❌ I couldn't create your ticket. Please contact a moderator."
            }).catch(() => {});

          }

        }

        return;
      }

      // ==============================
      // CLOSE SUPPORT TICKET
      // ==============================

      if (interaction.customId === "close_prophixy_ticket") {

        try {

          await interaction.deferReply({
            flags: MessageFlags.Ephemeral
          });

          const channel = interaction.channel;

          if (!channel || channel.type !== ChannelType.GuildText) {
            return interaction.editReply({
              content: "❌ This is not a ticket channel."
            });
          }

          await interaction.editReply({
            content:
              "🔒 Ticket closed. This channel will be deleted in 5 seconds."
          });

          setTimeout(async () => {

            await channel.delete(
              "Prophixy support ticket closed"
            ).catch(error => {
              console.error(
                "❌ Could not delete ticket:",
                error
              );
            });

          }, 5000);

        } catch (error) {

          console.error(
            "❌ Ticket close error:",
            error
          );

        }

        return;
      }

      // ==============================
      // VOTE BUTTONS
      // ==============================

      if (interaction.customId.startsWith("vote_")) {
        await handleVote(interaction);
        return;
      }

      return;
    }

    if (!interaction.isChatInputCommand()) return;

    console.log("Command received:", interaction.commandName);

    // =====================================================
    // TICKET PANEL
    // =====================================================
    if (interaction.commandName === "ticket-panel") {

      const embed = new EmbedBuilder()
        .setTitle("🎫 Prophixy Support")
        .setDescription(
          "Need help with Prophixy?\n\n" +
          "You can open a private ticket to talk directly with the Prophixy team or moderators.\n\n" +
          "You can use a ticket for:\n" +
          "• Account issues\n" +
          "• Prediction issues\n" +
          "• Rewards and points\n" +
          "• Wallet issues\n" +
          "• Market issues\n" +
          "• Reports or other private matters\n\n" +
          "🔒 Your ticket will only be visible to you and Prophixy staff."
        )
        .setFooter({
          text: "Prophixy • Shape Africa’s Future"
        });

      const button = new ButtonBuilder()
        .setCustomId("open_prophixy_ticket")
        .setLabel("Open Ticket")
        .setEmoji("🎫")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder()
        .addComponents(button);

      await interaction.channel.send({
        embeds: [embed],
        components: [row]
      });

      await interaction.reply({
        content: "✅ Support ticket panel posted.",
        flags: MessageFlags.Ephemeral
      });

      return;
    }


    // =====================================================
    // CONNECT WALLET
    // =====================================================
    if (interaction.commandName === "connectwallet") {

      await interaction.reply({
        content:
`# 🔗 Connect Your Wallet

Click the button below to securely connect your Prophixy wallet.

(No gas fee required.)`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel("Connect Wallet")
              .setStyle(ButtonStyle.Link)
              .setURL("https://example.com")
          )
        ]
      });

      return;
    }

    // =====================================================
    // PROFILE
    // =====================================================
    if (interaction.commandName === "profile") {

      let user = await getUser(interaction.user.id);

      if (!user) {
        user = await createUser(
          interaction.user.id,
          interaction.user.username
        );
      }

      await interaction.reply({

        content:

`# 👤 ${interaction.user.username}

💰 PHX: ${user.phx}

🏆 Wins: ${user.wins}

❌ Losses: ${user.losses}

📊 Predictions: ${user.totalPredictions}

🎯 Accuracy: ${user.accuracy}%

🔥 Streak: ${user.streak}

👥 Invites: ${user.invites}

👛 Wallet:
${user.wallet || "Not Connected"}

🎖 SBT:
${user.sbt.role}`

      });

      return;
    }

    // =====================================================
    // CREATE EVENT
    // =====================================================
    if (interaction.commandName === "event-create") {

      const category =
        interaction.options.getString("category");

      const question =
        interaction.options.getString("question");

      const options = [

        interaction.options.getString("option1"),

        interaction.options.getString("option2"),

        interaction.options.getString("option3"),

        interaction.options.getString("option4"),

        interaction.options.getString("option5"),

      ].filter(Boolean);

      const rewardPool =
        interaction.options.getInteger("reward");

      const duration =
interaction.options.getString("duration");

const match = duration.match(/^(\d+)(m|h|d|w)$/i);

if (!match) {

  return interaction.reply({
    content:
      "❌ Invalid duration.\nExamples: `30m`, `2h`, `3d`, `1w`"
  });

}

const amount = Number(match[1]);

const unit = match[2].toLowerCase();

let milliseconds = 0;

switch (unit) {

  case "m":
    milliseconds = amount * 60 * 1000;
    break;

  case "h":
    milliseconds = amount * 60 * 60 * 1000;
    break;

  case "d":
    milliseconds = amount * 24 * 60 * 60 * 1000;
    break;

  case "w":
    milliseconds = amount * 7 * 24 * 60 * 60 * 1000;
    break;

}

      const event = await createEvent(

        category,

        question,

        options,

        rewardPool,

        Date.now() + milliseconds

      );

const embed = new EmbedBuilder()
  .setColor(0x0099FF)

  .setTitle("📊 New Prediction Market")

  .setDescription(question)

  .addFields(

    {
      name: "📂 Category",
      value: category,
      inline: true
    },

    {
      name: "🏆 Reward Pool",
      value: `${rewardPool} PHX`,
      inline: true
    },

    {
      name: "👥 Participants",
      value: "0",
      inline: true
    },

    {
      name: "⏳ Duration",
      value: duration,
      inline: true
    },

    {
      name: "📌 Status",
      value: "🟢 Active",
      inline: true
    },

    {
      name: "🆔 Market ID",
      value: event.id,
      inline: true
    }

  )

  .setFooter({
    text: "One prediction per user • Results are based on real-world outcomes"
  })

  .setTimestamp();

      const row = new ActionRowBuilder();

      options.forEach((option, index) => {

        row.addComponents(

          new ButtonBuilder()

            .setCustomId(`vote_${event.id}_${index}`)

            .setLabel(option)

            .setStyle(ButtonStyle.Primary)

        );

      });

      await interaction.reply({

        embeds: [embed],

        components: [row]

      });

      return;
    }

  } catch (err) {

    console.error(err);

    if (!interaction.replied && !interaction.deferred) {

      try {

        await interaction.reply({

          content: "❌ Something went wrong."

        });

      } catch {}

    }

  }

});

// ==============================
// GENERATE INVITE BUTTON
// ==============================

async function handleGenerateInvite(interaction) {

  try {

    console.log(
      "🔎 INVITE INTERACTION:",
      interaction.id,
      "replied:", interaction.replied,
      "deferred:", interaction.deferred,
      "created:", new Date(interaction.createdTimestamp).toISOString(),
      "now:", new Date().toISOString()
    );

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

    const userId = interaction.user.id;

    let user = await getUser(userId);

    if (!user) {
      user = await createUser(
        userId,
        interaction.user.username
      );
    }

    const channel = guild.channels.cache.find(
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

    const invite = await channel.createInvite({
      maxAge: 7 * 24 * 60 * 60,
      maxUses: 0,
      unique: true,
      reason: `Prophixy invite for ${interaction.user.tag}`
    });

    console.log(`✅ Invite created: ${invite.code}`);

    const { db } = require("./services/database");

    await db.read();

    const dbUser = db.data.users.find(
      u => u.discordId === userId
    );

    if (dbUser) {

      dbUser.inviteCode = invite.code;

      dbUser.inviteCreatedAt =
        new Date().toISOString();

      dbUser.inviteExpiresAt =
        new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ).toISOString();

      await db.write();
    }

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

      if (interaction.deferred && !interaction.replied) {

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
        replyError.message
      );

    }
  }
}

// ==============================
// OPEN SUPPORT TICKET
// ==============================

async function handleOpenTicket(interaction) {

  try {

    const guild = interaction.guild;

    if (!guild) {
      return interaction.reply({
        content: "❌ This can only be used inside the Prophixy server.",
        flags: MessageFlags.Ephemeral
      });
    }

    // Prevent users from opening multiple tickets
    const existingTicket = guild.channels.cache.find(
      channel =>
        channel.type === ChannelType.GuildText &&
        channel.topic === `prophixy-ticket:${interaction.user.id}`
    );

    if (existingTicket) {
      return interaction.reply({
        content: `❌ You already have an open ticket: ${existingTicket}`,
        flags: MessageFlags.Ephemeral
      });
    }

    // Find staff roles
    const staffRoleNames = [
      "Mod",
      "Team"
    ];

    const staffRoles = guild.roles.cache.filter(
      role =>
        staffRoleNames.some(
          name => role.name.toLowerCase() === name.toLowerCase()
        )
    );

    // Ticket permissions
    const permissionOverwrites = [
      {
        id: guild.id,
        deny: [
          PermissionFlagsBits.ViewChannel
        ]
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      }
    ];

    // Give staff access
    for (const role of staffRoles.values()) {

      permissionOverwrites.push({
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      });

    }

    const ticketChannel = await guild.channels.create({
      name: `ticket-${interaction.user.username}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "")
        .slice(0, 90),

      type: ChannelType.GuildText,

      topic: `prophixy-ticket:${interaction.user.id}`,

      permissionOverwrites
    });

    const closeButton = new ButtonBuilder()
      .setCustomId("close_prophixy_ticket")
      .setLabel("Close Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder()
      .addComponents(closeButton);

    const embed = new EmbedBuilder()
      .setTitle("🎫 Prophixy Support Ticket")
      .setDescription(
        `Hello ${interaction.user} 👋\n\n` +
        "A member of the Prophixy team will assist you shortly.\n\n" +
        "Please describe your issue clearly and provide any relevant information.\n\n" +
        "🔒 When your issue has been resolved, use the **Close Ticket** button."
      )
      .setFooter({
        text: "Prophixy Support"
      })
      .setTimestamp();

    await ticketChannel.send({
      content: `${interaction.user} <@&${staffRoles.first()?.id || guild.id}>`,
      embeds: [embed],
      components: [row]
    });

    await interaction.reply({
      content: `✅ Your private ticket has been created: ${ticketChannel}`,
      flags: MessageFlags.Ephemeral
    });

    console.log(
      `🎫 Ticket created for ${interaction.user.tag}: ${ticketChannel.name}`
    );

  } catch (error) {

    console.error("❌ Ticket creation error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ Could not create your ticket. Please contact a moderator.",
        flags: MessageFlags.Ephemeral
      });
    }
  }
}

// ==============================
// CLOSE SUPPORT TICKET
// ==============================

async function handleCloseTicket(interaction) {

  try {

    const channel = interaction.channel;

    if (!channel || channel.type !== ChannelType.GuildText) {
      return interaction.reply({
        content: "❌ This is not a ticket channel.",
        flags: MessageFlags.Ephemeral
      });
    }

    // Make sure this is one of our tickets
    if (!channel.topic?.startsWith("prophixy-ticket:")) {
      return interaction.reply({
        content: "❌ This is not a Prophixy ticket.",
        flags: MessageFlags.Ephemeral
      });
    }

    // Only the ticket owner or staff can close it
    const ticketOwnerId =
      channel.topic.split(":")[1];

    const member = interaction.member;

    const isOwner =
      interaction.user.id === ticketOwnerId;

    const isStaff =
      member.roles.cache.some(role =>
        ["mod", "team"].includes(
          role.name.toLowerCase()
        )
      );

    if (!isOwner && !isStaff) {
      return interaction.reply({
        content: "❌ Only the ticket owner or Prophixy staff can close this ticket.",
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.reply({
      content: "🔒 This ticket will be closed in 5 seconds.",
    });

    console.log(
      `🔒 Ticket closed by ${interaction.user.tag}: ${channel.name}`
    );

    setTimeout(async () => {

      try {
        await channel.delete(
          `Prophixy ticket closed by ${interaction.user.tag}`
        );
      } catch (error) {
        console.error(
          "❌ Could not delete ticket:",
          error
        );
      }

    }, 5000);

  } catch (error) {

    console.error(
      "❌ Close ticket error:",
      error
    );

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ Could not close this ticket.",
        flags: MessageFlags.Ephemeral
      });
    }
  }
}
client.login(process.env.DISCORD_TOKEN);
