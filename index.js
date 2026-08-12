require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  MessageFlags,
  ChannelType,
  PermissionFlagsBits
} = require("discord.js");

const {
  initDB,
  getUser,
  createUser,
  save,
} = require("./services/database");

const { verifySBT } = require("./services/sbt");

const { assignSbtRole } = require("./services/roles");

const { createEvent } = require("./events/createEvent");
const { handleVote, handleStakeSubmit } = require("./interactions/vote");
const { resolveMarket } = require("./commands/resolve");
const {
  getLeaderboard,
  getUserRank
} = require("./services/leaderboard");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Start the HTTP API used by prophixy-verify.onrender.com
require("./api")(client);

client.once(Events.ClientReady, async () => {
  await initDB();

  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log("🚀 Prophixy Beta is online!");
});

client.on(Events.InteractionCreate, async (interaction) => {

  console.log(
    "🔔 INTERACTION RECEIVED:",
    interaction.id,
    interaction.isButton() ? interaction.customId : interaction.type,
    "age:",
    `${Date.now() - interaction.createdTimestamp}ms`
  );

  try {

    // =====================================================
    // BUTTON INTERACTIONS
    // =====================================================

    if (interaction.isButton()) {

      // =====================================================
      // PROFILE BUTTON
      // =====================================================

      if (interaction.customId === "prophixy_profile") {

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral
        });

        try {

          let user = await getUser(interaction.user.id);

          if (!user) {
            user = await createUser(
              interaction.user.id,
              interaction.user.username
            );
          }

          await interaction.editReply({
            content:
`# 👤 ${interaction.user.username}

💰 PHX: ${Number(user.phx || 0).toLocaleString()}

🏆 Wins: ${user.wins || 0}

❌ Losses: ${user.losses || 0}

📊 Predictions: ${user.totalPredictions || 0}

🎯 Accuracy: ${user.accuracy || 0}%

🔥 Streak: ${user.streak || 0}

👥 Invites: ${user.invites || 0}

👛 Wallet:
${user.wallet || "Not Connected"}

🎖 SBT:
${user.sbt?.role || "Not Verified"}`
          });

        } catch (error) {

          console.error(
            "❌ Profile button error:",
            error
          );

          await interaction.editReply({
            content: "❌ Unable to load your profile."
          }).catch(() => {});

        }

        return;
      }


      // =====================================================
      // PHX LEADERBOARD BUTTON
      // =====================================================

      if (interaction.customId === "prophixy_leaderboard") {

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral
        });

        try {

          const users = await getLeaderboard(10);

          if (!users.length) {

            return interaction.editReply({
              content:
                "📊 The PHX leaderboard is currently empty."
            });

          }

          const medals = ["🥇", "🥈", "🥉"];

          const lines = users.map((user, index) => {

            const position =
              medals[index] || `**${index + 1}.**`;

            return (
              `${position} <@${user.discordId}> — ` +
              `**${Number(user.phx || 0).toLocaleString()} PHX**`
            );

          });

          const rank =
            await getUserRank(interaction.user.id);

          const leaderboardEmbed =
            new EmbedBuilder()
              .setColor(0x0099FF)
              .setTitle("🏆 Prophixy PHX Leaderboard")
              .setDescription(lines.join("\n"))
              .setFooter({
                text: rank
                  ? `Your rank: #${rank.rank} • ${Number(rank.phx || 0).toLocaleString()} PHX`
                  : "Your account is not yet ranked"
              })
              .setTimestamp();

          await interaction.editReply({
            embeds: [leaderboardEmbed]
          });

        } catch (error) {

          console.error(
            "❌ PHX leaderboard button error:",
            error
          );

          await interaction.editReply({
            content:
              "❌ Unable to load the PHX leaderboard."
          }).catch(() => {});

        }

        return;
      }


      // =====================================================
      // CLOSE SUPPORT TICKET
      // =====================================================

      if (interaction.customId === "close_prophixy_ticket") {

        try {

          const channel = interaction.channel;

          if (
            !channel ||
            channel.type !== ChannelType.GuildText
          ) {

            await interaction.reply({
              content:
                "❌ This is not a ticket channel.",
              flags: MessageFlags.Ephemeral
            }).catch(() => {});

            return;
          }

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


      // =====================================================
      // GENERATE INVITE
      // =====================================================

      if (
        interaction.customId ===
        "generate_prophixy_invite"
      ) {

        try {

          await interaction.deferReply({
            flags: MessageFlags.Ephemeral
          });

          console.log(
            "✅ Invite interaction acknowledged immediately."
          );

          await handleGenerateInvite(interaction);

        } catch (error) {

          console.error(
            "❌ Invite interaction error:",
            error
          );

          if (
            interaction.deferred &&
            !interaction.replied
          ) {

            await interaction.editReply({
              content:
                "❌ I couldn't generate your invite. Please try again."
            }).catch(() => {});

          }

        }

        return;
      }


      // =====================================================
      // CONNECT & VERIFY WALLET
      // =====================================================

      if (
        interaction.customId ===
        "connect_verify_wallet"
      ) {

        try {

          await interaction.reply({
            content:
              "🔐 **Prophixy Wallet Verification**\n\n" +
              "Click the link below to connect your Discord account and wallet, then verify your Prophixy SBT.\n\n" +
              "👉 https://prophixy-verify.onrender.com",
            flags: MessageFlags.Ephemeral
          });

        } catch (error) {

          console.error(
            "❌ Wallet verification redirect error:",
            error
          );

        }

        return;
      }


      // =====================================================
      // OPEN SUPPORT TICKET
      // =====================================================

      if (
        interaction.customId ===
        "open_prophixy_ticket"
      ) {

        try {

          await interaction.deferReply({
            flags: MessageFlags.Ephemeral
          });

          await handleOpenTicket(interaction);

        } catch (error) {

          console.error(
            "❌ Support ticket interaction error:",
            error
          );

          if (
            interaction.deferred &&
            !interaction.replied
          ) {

            await interaction.editReply({
              content:
                "❌ Could not create your support ticket."
            }).catch(() => {});

          }

        }

        return;
      }


      // =====================================================
      // PREDICTION BUTTON
      // =====================================================

      if (
        interaction.customId.startsWith("vote_")
      ) {

        await handleVote(interaction);

        return;
      }

    }


    // =====================================================
    // SLASH COMMANDS ONLY
    // =====================================================

    if (!interaction.isChatInputCommand()) {
      return;
    }

    console.log(
      "Command received:",
      interaction.commandName
    );


    // =====================================================
    // ADMIN COMMUNITY PANEL
    // =====================================================

    if (
      interaction.commandName === "panel"
    ) {

      if (
        !interaction.member ||
        !interaction.member.permissions.has(
          PermissionFlagsBits.Administrator
        )
      ) {

        return interaction.reply({
          content:
            "❌ You don't have permission to use the Prophixy panel command.",
          flags: MessageFlags.Ephemeral
        });

      }

      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      try {

        const guild = interaction.guild;

        if (!guild) {

          return interaction.editReply({
            content:
              "❌ This command can only be used inside the Prophixy server."
          });

        }


        // =====================================================
        // PROFILE CHANNEL
        // =====================================================

        let profileChannel =
          guild.channels.cache.find(
            channel =>
              channel.type === ChannelType.GuildText &&
              channel.name === "👤・profile"
          );

        if (!profileChannel) {

          profileChannel =
            await guild.channels.create({
              name: "👤・profile",
              type: ChannelType.GuildText
            });

          console.log(
            `✅ Created #${profileChannel.name}`
          );

        }


        const profileEmbed =
          new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle("👤 Prophixy Profile")
            .setDescription(
              "View your Prophixy account information.\n\n" +
              "Your profile shows:\n" +
              "💰 PHX balance\n" +
              "🏆 Wins\n" +
              "❌ Losses\n" +
              "📊 Predictions\n" +
              "🎯 Accuracy\n" +
              "🔥 Streak\n" +
              "👥 Invites\n" +
              "👛 Connected wallet\n" +
              "🎖️ SBT role\n\n" +
              "Click the button below to view your profile."
            )
            .setFooter({
              text:
                "Prophixy • Shape Africa's Future"
            });


        const profileButton =
          new ButtonBuilder()
            .setCustomId(
              "prophixy_profile"
            )
            .setLabel(
              "View My Profile"
            )
            .setEmoji("👤")
            .setStyle(
              ButtonStyle.Primary
            );


        const profileRow =
          new ActionRowBuilder()
            .addComponents(
              profileButton
            );


        await profileChannel.send({
          embeds: [profileEmbed],
          components: [profileRow]
        });


        // =====================================================
        // PHX LEADERBOARD CHANNEL
        // =====================================================

        let leaderboardChannel =
          guild.channels.cache.find(
            channel =>
              channel.type === ChannelType.GuildText &&
              channel.name ===
                "🏆・phx-leaderboard"
          );

        if (!leaderboardChannel) {

          leaderboardChannel =
            await guild.channels.create({
              name:
                "🏆・phx-leaderboard",
              type:
                ChannelType.GuildText
            });

          console.log(
            `✅ Created #${leaderboardChannel.name}`
          );

        }


        const leaderboardEmbed =
          new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle(
              "🏆 Prophixy PHX Leaderboard"
            )
            .setDescription(
              "See the top PHX holders in the Prophixy community.\n\n" +
              "Click the button below to view the current leaderboard."
            )
            .setFooter({
              text:
                "Prophixy • Shape Africa's Future"
            });


        const leaderboardButton =
          new ButtonBuilder()
            .setCustomId(
              "prophixy_leaderboard"
            )
            .setLabel(
              "View PHX Leaderboard"
            )
            .setEmoji("🏆")
            .setStyle(
              ButtonStyle.Primary
            );


        const leaderboardRow =
          new ActionRowBuilder()
            .addComponents(
              leaderboardButton
            );


        await leaderboardChannel.send({
          embeds: [leaderboardEmbed],
          components: [leaderboardRow]
        });


        // =====================================================
        // COMMUNITY PANEL
        // =====================================================

        const embed =
          new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle(
              "🔮 Prophixy Community"
            )
            .setDescription(
              "Predict Smarter. Decide Better. Shape Africa's Future.\n\n" +
              "Use the buttons below to access Prophixy features.\n\n" +
              "👤 **Profile** — View your Prophixy account\n" +
              "🏆 **PHX Leaderboard** — See the top PHX holders\n" +
              "🎁 **Generate Invite** — Create your personal invite\n" +
              "🔐 **Verify Wallet** — Verify your Prophixy SBT\n" +
              "🎫 **Support** — Open a private support ticket"
            )
            .setFooter({
              text:
                "Prophixy • Shape Africa's Future"
            })
            .setTimestamp();


        // NOTE:
        // Profile and Leaderboard are intentionally
        // NOT placed in this community panel.
        //
        // They have their own separate channels.


        const row =
          new ActionRowBuilder()
            .addComponents(

              new ButtonBuilder()
                .setCustomId(
                  "generate_prophixy_invite"
                )
                .setLabel(
                  "Generate Invite"
                )
                .setEmoji("🎁")
                .setStyle(
                  ButtonStyle.Success
                ),

              new ButtonBuilder()
                .setLabel(
                  "Verify Wallet"
                )
                .setEmoji("🔐")
                .setStyle(
                  ButtonStyle.Link
                )
                .setURL(
                  "https://prophixy-verify.onrender.com"
                ),

              new ButtonBuilder()
                .setCustomId(
                  "open_prophixy_ticket"
                )
                .setLabel(
                  "Support"
                )
                .setEmoji("🎫")
                .setStyle(
                  ButtonStyle.Primary
                )

            );


        await interaction.channel.send({
          embeds: [embed],
          components: [row]
        });


        await interaction.editReply({
          content:
            `✅ Prophixy panels created.\n\n` +
            `👤 Profile: ${profileChannel}\n` +
            `🏆 Leaderboard: ${leaderboardChannel}\n` +
            `🔮 Community panel: ${interaction.channel}`
        });


      } catch (error) {

        console.error(
          "❌ Community panel creation error:",
          error
        );

        await interaction.editReply({
          content:
            "❌ Could not create the Prophixy panels."
        }).catch(() => {});

      }

      return;
    }


    // =====================================================
    // RESOLVE MARKET
    // =====================================================

    if (
      interaction.commandName === "resolve"
    ) {

      const marketId =
        interaction.options.getString(
          "marketid"
        );

      const winnerNumber =
        interaction.options.getInteger(
          "winner"
        );

      const winnerOption =
        winnerNumber - 1;


      if (
        winnerNumber < 1 ||
        winnerNumber > 5
      ) {

        return interaction.reply({
          content:
            "❌ Winner must be between **1 and 5**.",
          flags: MessageFlags.Ephemeral
        });

      }


      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });


      try {

        const result =
          await resolveMarket(
            marketId,
            winnerOption
          );


        if (!result.success) {

          return interaction.editReply({
            content:
              `❌ ${result.message}`
          });

        }


        return interaction.editReply({
          content:
            `✅ **Market resolved successfully!**\n\n` +
            `🆔 Market: **${marketId}**\n` +
            `🏆 Winning option: **${winnerNumber}**\n\n` +
            `🏦 Total pool: **${Number(result.totalPool || 0).toLocaleString()} PHX**\n` +
            `👤 Creator reward (3%): **${Number(result.creatorReward || 0).toLocaleString()} PHX**\n` +
            `🏆 Winner pool (93%): **${Number(result.winnerPool || 0).toLocaleString()} PHX**\n` +
            `🏦 Reserve (4%): **${Number(result.reserveAmount || 0).toLocaleString()} PHX**\n\n` +
            `👥 Winners: **${result.winners}**\n` +
            `💰 Distributed to winners: **${Number(result.distributedToWinners || 0).toLocaleString()} PHX**`
        });

      } catch (error) {

        console.error(
          "❌ Market resolution error:",
          error
        );

        return interaction.editReply({
          content:
            `❌ Unable to resolve market.\n\nReason: ${error.message}`
        });

      }

    }


    // =====================================================
    // CREATE EVENT
    // =====================================================

    if (
      interaction.commandName === "event-create"
    ) {

      const category =
        interaction.options.getString(
          "category"
        );

      const question =
        interaction.options.getString(
          "question"
        );

      const options = [
        interaction.options.getString("option1"),
        interaction.options.getString("option2"),
        interaction.options.getString("option3"),
        interaction.options.getString("option4"),
        interaction.options.getString("option5")
      ].filter(Boolean);


      const duration =
        interaction.options.getString(
          "duration"
        );


      const match =
        duration.match(
          /^(\d+)(m|h|d|w)$/i
        );


      if (!match) {

        return interaction.reply({
          content:
            "❌ Invalid duration.\nExamples: `30m`, `2h`, `3d`, `1w`"
        });

      }


      const amount =
        Number(match[1]);

      const unit =
        match[2].toLowerCase();

      let milliseconds = 0;


      switch (unit) {

        case "m":
          milliseconds =
            amount * 60 * 1000;
          break;

        case "h":
          milliseconds =
            amount * 60 * 60 * 1000;
          break;

        case "d":
          milliseconds =
            amount * 24 * 60 * 60 * 1000;
          break;

        case "w":
          milliseconds =
            amount * 7 * 24 * 60 * 60 * 1000;
          break;

      }


      const event =
        await createEvent(
          category,
          question,
          options,
          Date.now() + milliseconds,
          interaction.user.id
        );


      const embed =
        new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle(
            "📊 New Prediction Market"
    )
          .setDescription(
            question
          )
          .addFields(

            {
              name: "📂 Category",
              value: category,
              inline: true
            },

            {
              name: "🏦 Market Pool",
              value: "0 PHX",
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
            text:
              "One prediction per user • Results are based on real-world outcomes"
          })
          .setTimestamp();


      const row =
        new ActionRowBuilder();


      options.forEach(
        (option, index) => {

          row.addComponents(
            new ButtonBuilder()
              .setCustomId(
                `vote_${event.id}_${index}`
              )
              .setLabel(option)
              .setStyle(
                ButtonStyle.Primary
              )
          );

        }
      );


      await interaction.reply({
        embeds: [embed],
        components: [row]
      });

      return;
    }

  } catch (err) {

    console.error(
      "Interaction error:",
      err
    );

    if (
      !interaction.replied &&
      !interaction.deferred
    ) {

      try {

        await interaction.reply({
          content:
            "❌ Something went wrong.",
          flags: MessageFlags.Ephemeral
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

    // Interaction is acknowledged by the main InteractionCreate handler.
    // Do not deferReply() again here.
    console.log("✅ Invite interaction already acknowledged.");

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

👥 **Reward:** +10 PHX for each successful invite

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

// =====================================================
// =====================================================
// DAILY CHECK-IN SYSTEM
// =====================================================

client.on(Events.MessageCreate, async (message) => {

  try {

    // Ignore bots
    if (message.author.bot) {
      return;
    }

    // Only the configured Daily Check-In channel
    const checkInChannelId =
      process.env.DAILY_CHECKIN_CHANNEL_ID;

    if (!checkInChannelId) {
      console.error(
        "❌ DAILY_CHECKIN_CHANNEL_ID is not configured."
      );
      return;
    }

    if (message.channel.id !== checkInChannelId) {
      return;
    }

    // Only accept gprophixy / Gprophixy
    if (message.content.trim().toLowerCase() !== "gprophixy") {
      return;
    }

    const userId = message.author.id;

    let user = await getUser(userId);

    if (!user) {
      user = await createUser(
        userId,
        message.author.username
      );
    }

    const now = Date.now();

    const lastCheckIn = user.lastDailyCheckIn
      ? new Date(user.lastDailyCheckIn).getTime()
      : 0;

    const twentyFourHours = 24 * 60 * 60 * 1000;

    // =====================================================
    // 24-HOUR CHECK
    // =====================================================

    if (
      lastCheckIn &&
      now - lastCheckIn < twentyFourHours
    ) {

      const remaining =
        twentyFourHours - (now - lastCheckIn);

      const hours =
        Math.floor(
          remaining / (60 * 60 * 1000)
        );

      const minutes =
        Math.floor(
          (remaining % (60 * 60 * 1000)) /
          (60 * 1000)
        );

      await message.reply(
        `⏳ You already checked in today.\n\n` +
        `Next check-in available in **${hours}h ${minutes}m**.\n` +
        `🔥 Progress: **${user.dailyCheckIns || 0}/7**`
      );

      return;
    }

    // =====================================================
    // QUALIFYING CHECK-IN
    // =====================================================

    user.dailyCheckIns =
      Number(user.dailyCheckIns || 0) + 1;

    user.lastDailyCheckIn =
      new Date(now).toISOString();

    // =====================================================
    // ADD CUSTOM PHX CHECK-IN EMOJI
    // =====================================================

    try {
      await message.react("<:phxcheck:1523759271785795756>");
    } catch (emojiError) {
      console.error(
        "❌ Could not add PHX check-in emoji:",
        emojiError.message
      );
    }

    let rewardMessage = "";

    // =====================================================
    // 7 CHECK-INS = 5 PHX
    // =====================================================

    if (user.dailyCheckIns >= 7) {

      user.phx =
        Number(user.phx || 0) + 5;

      // Start a new 7-day reward cycle
      user.dailyCheckIns = 0;

      user.dailyCheckInRewarded = true;

      rewardMessage =
        `\n\n🎁 **7-day check-in reward unlocked!**\n` +
        `💰 **+5 PHX**\n` +
        `🔥 New check-in cycle started: **0/7**`;

    } else {

      user.dailyCheckInRewarded = false;
    }

    await save();

    // =====================================================
    // SUCCESS MESSAGE
    // =====================================================

    await message.reply(
      `✅ **Daily check-in confirmed!**\n\n` +
      `👤 ${message.author}\n` +
      `🔥 Check-in progress: **${user.dailyCheckIns}/7**` +
      rewardMessage
    );

  } catch (error) {

    console.error(
      "❌ Daily check-in error:",
      error
    );

  }

});

client.login(process.env.DISCORD_TOKEN);
