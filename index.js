require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  StringSelectMenuBuilder,
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
  getMarketsCreatedToday,
} = require("./services/database");

const { verifySBT } = require("./services/sbt");

const {
  MARKET_CREATION_FEE
} = require("./config/rewards");

const { assignSbtRole } = require("./services/roles");

const { createEvent } = require("./events/createEvent");
const { handleVote, handleStakeSubmit } = require("./interactions/vote");
const { resolveMarket } = require("./commands/resolve");
const { autoResolveFootballMarkets } = require("./services/autoResolveFootball");
const { generateMarkets } = require("./services/aiMarketGenerator");
const {
  getLeaderboard,
  getInviteLeaderboard,
  getUserRank
} = require("./services/leaderboard");

const {
  cacheGuildInvites,
  findUsedInvite,
  recordInvite
} = require("./services/invites");

// Temporary storage for AI suggestions awaiting creator selection.
// Nothing is created or charged until the creator confirms the final market.
const pendingAiMarkets = new Map();

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

  // Cache current Discord invites so we can detect
  // exactly which invite is used when someone joins.
  for (const guild of client.guilds.cache.values()) {
    guild.inviteCache = await cacheGuildInvites(guild);

    console.log(
      `📨 Cached ${Object.keys(guild.inviteCache).length} invites for ${guild.name}`
    );
  }

  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log("🚀 Prophixy Beta is online!");

  // ==========================================
  // AUTO FOOTBALL RESOLUTION
  // ==========================================

  // Run once immediately when the bot starts.
  try {
    const results = await autoResolveFootballMarkets();

    const resolved = results.filter(r => r.resolved);

    if (resolved.length > 0) {
      console.log(
        `⚽ Automatically resolved ${resolved.length} football market(s).`
      );
    }
  } catch (error) {
    console.error(
      "❌ Initial auto football resolver error:",
      error.message
    );
  }

  // ==========================================
  // REAL-TIME FOOTBALL MARKET MONITOR
  // ==========================================
  //
  // Check football fixtures every minute.
  //
  // The resolver itself decides whether a match:
  //   1. Has not started
  //   2. Has started → close predictions
  //   3. Is still playing
  //   4. Has finished → resolve automatically
  //
  // Other market categories are unaffected because
  // autoResolveFootballMarkets() only selects events
  // that contain a fixtureId.
  //
  setInterval(async () => {

    try {

      const results =
        await autoResolveFootballMarkets();

      const closed =
        results.filter(
          r => r.predictionsClosed
        );

      const resolved =
        results.filter(
          r => r.resolved
        );

      if (closed.length > 0) {

        console.log(
          `🔴 Closed predictions for ${closed.length} football market(s).`
        );

      }

      if (resolved.length > 0) {

        console.log(
          `🏆 Automatically resolved ${resolved.length} football market(s).`
        );

      }

    } catch (error) {

      console.error(
        "❌ Auto football resolver error:",
        error.message
      );

    }

  }, 60 * 1000); // every 1 minute

});

// =====================================================
// INVITE TRACKING
// =====================================================

client.on(Events.GuildMemberAdd, async (member) => {

  try {

    const guild = member.guild;

    // Get the previous invite cache.
    const oldInvites =
      guild.inviteCache || {};

    // Fetch the current invite usage.
    const newInvites =
      await cacheGuildInvites(guild);

    // Update cache immediately.
    guild.inviteCache = newInvites;

    // Determine which invite was used.
    const usedInvite =
      findUsedInvite(
        oldInvites,
        newInvites
      );

    if (!usedInvite) {

      console.log(
        `ℹ️ Could not determine inviter for ${member.user.tag}`
      );

      return;
    }

    // Discord reports the bot as the technical creator of
    // these invites. Use our saved Prophixy invite ownership
    // mapping to identify the actual person who shared it.
    let inviterId = null;

    await require("./services/database").db.read();

    const inviteLink =
      require("./services/database").db.data.inviteLinks?.find(
        link =>
          link.code === usedInvite.code
      );

    if (inviteLink) {
      inviterId = inviteLink.inviterId;

      console.log(
        `🔗 Prophixy invite ${usedInvite.code} belongs to ${inviteLink.inviterUsername} (${inviterId})`
      );
    } else {
      // Fallback for invites that were not generated through
      // the Prophixy invite system.
      inviterId = usedInvite.inviterId;
    }

    if (!inviterId || inviterId === client.user.id) {

      console.log(
        `ℹ️ Could not identify a Prophixy inviter for ${member.user.tag}`
      );

      return;
    }

    // Record the successful invite.
    const record =
      await recordInvite(
        inviterId,
        member.id,
        member.user.username
      );

    if (!record) {
      return;
    }

    // Find a suitable invite channel.
   const inviteChannel =
  guild.channels.cache.get(
    process.env.INVITE_CHANNEL_ID
  );

    if (inviteChannel) {

      await inviteChannel.send(
        `🎉 **New Prophixy Invite!**\n\n` +
        `👤 **${member.user.username}** was invited by <@${inviterId}>.\n` +
        `🎁 <@${inviterId}> earned **+10 PHX**.\n`+
        `👥 Their invite count has increased by **1**.`
      );

    }

    console.log(
      `🎉 ${member.user.username} was invited by ${inviterId}`
    );

  } catch (error) {

    console.error(
      "❌ Invite tracking error:",
      error
    );

  }

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

        await interaction.deferReply();

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
      // INVITE LEADERBOARD BUTTON
      // =====================================================

      if (interaction.customId === "prophixy_invite_leaderboard") {

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral
        });

        try {

          const users =
            await getInviteLeaderboard(10);

          if (!users.length) {

            return interaction.editReply({
              content:
                "🎁 The invite leaderboard is currently empty."
            });

          }

          const medals = ["🥇", "🥈", "🥉"];

          const lines =
            users.map((user, index) => {

              const position =
                medals[index] ||
                `**${index + 1}.**`;

              return (
                `${position} <@${user.discordId}> — ` +
                `**${Number(user.invites || 0)} invites**`
              );

            });

          const leaderboardEmbed =
            new EmbedBuilder()
              .setColor(0x00C853)
              .setTitle("🎁 Prophixy Invite Leaderboard")
              .setDescription(lines.join("\n"))
              .setFooter({
                text:
                  "Earn +10 PHX for every successful unique invite."
              })
              .setTimestamp();

          await interaction.editReply({
            embeds: [leaderboardEmbed]
          });

        } catch (error) {

          console.error(
            "❌ Invite leaderboard error:",
            error
          );

          await interaction.editReply({
            content:
              "❌ Unable to load the invite leaderboard."
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
    // AI MARKET SELECTION
    // =====================================================

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith("ai_market_select_")
    ) {

      const ownerId =
        interaction.customId.replace(
          "ai_market_select_",
          ""
        );

      // Only the creator who generated the suggestions
      // can select one of them.
      if (
        interaction.user.id !== ownerId
      ) {

        return interaction.reply({
          content:
            "❌ Only the creator who generated these AI suggestions can select one.",
          flags: MessageFlags.Ephemeral
        });

      }

      const selectedIndex =
        Number(
          interaction.values[0]
        );

      const pending =
        pendingAiMarkets.get(
          interaction.user.id
        );

      if (
        !pending ||
        !Array.isArray(pending.markets) ||
        !pending.markets[selectedIndex]
      ) {

        return interaction.reply({
          content:
            "❌ This AI market selection has expired. Please run `/ai` again.",
          flags: MessageFlags.Ephemeral
        });

      }

      pending.selectedIndex = selectedIndex;

      const selectedMarket =
        pending.markets[selectedIndex];

      console.log(
        `🤖 AI market selected: index ${selectedIndex} by ${interaction.user.tag}`
      );

      const durationModal =
        new ModalBuilder()
          .setCustomId(
            `ai_market_duration_${interaction.user.id}`
          )
          .setTitle(
            "Create AI Prediction Market"
          );

      const durationInput =
        new TextInputBuilder()
          .setCustomId(
            "duration"
          )
          .setLabel(
            "Market duration"
          )
          .setPlaceholder(
            "Examples: 30m, 2h, 3d, 1w"
          )
          .setStyle(
            TextInputStyle.Short
          )
          .setRequired(true)
          .setMaxLength(10);

      const durationRow =
        new ActionRowBuilder()
          .addComponents(
            durationInput
          );

      durationModal.addComponents(
        durationRow
      );

      await interaction.showModal(
        durationModal
      );

      return;
    }


    // =====================================================
    // STAKE MODAL SUBMISSION
    // =====================================================

    console.log(
      "🧪 INTERACTION TYPE CHECK:",
      "isModalSubmit=",
      interaction.isModalSubmit(),
      "customId=",
      interaction.customId || "NONE"
    );

    // =====================================================
    // AI MARKET DURATION SUBMISSION
    // =====================================================

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("ai_market_duration_")
    ) {

      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      try {

        const ownerId =
          interaction.customId.replace(
            "ai_market_duration_",
            ""
          );

        // Security: only the creator who generated the AI
        // suggestions can complete this market.
        if (interaction.user.id !== ownerId) {

          return interaction.editReply({
            content:
              "❌ You are not authorized to create this AI market."
          });

        }

        const pending =
          pendingAiMarkets.get(ownerId);

        if (
          !pending ||
          !Array.isArray(pending.markets)
        ) {

          return interaction.editReply({
            content:
              "❌ This AI market selection has expired. Please run `/ai` again."
          });

        }

        /*
         * The selected market is stored by the selection step.
         * We keep the selected index in the pending object.
         */
        const selectedIndex =
          Number(pending.selectedIndex);

        const selectedMarket =
          pending.markets[selectedIndex];

        if (!selectedMarket) {

          return interaction.editReply({
            content:
              "❌ The selected AI market could not be found. Please run `/ai` again."
          });

        }

        // =================================================
        // CREATOR CHECK
        // =================================================

        const creatorUser =
          await getUser(ownerId);

        const creatorRole =
          creatorUser?.sbt?.role || "none";

        const isAdmin =
          interaction.member?.permissions?.has(
            PermissionFlagsBits.Administrator
          );

        const allowedCreatorRoles = [
          "Top Forecaster",
          "Market Creator"
        ];

        if (
          !isAdmin &&
          !allowedCreatorRoles.includes(creatorRole)
        ) {

          return interaction.editReply({
            content:
              "❌ **You cannot create markets.**\n\n" +
              "Only users with the **Top Forecaster** or **Market Creator** SBT role can create prediction markets."
          });

        }

        // =================================================
        // DAILY MARKET CREATION LIMIT
        // =================================================

        const marketsCreatedToday =
          await getMarketsCreatedToday(ownerId);

        if (marketsCreatedToday >= 5) {

          return interaction.editReply({
            content:
              "❌ **Daily market limit reached.**\n\n" +
              "You can create a maximum of **5 prediction markets per day**.\n" +
              `📊 You have already created **${marketsCreatedToday}/5** today.`
          });

        }

        // =================================================
        // MARKET CREATION FEE
        // =================================================

        const creatorBalance =
          Number(creatorUser?.phx || 0);

        if (
          creatorBalance <
          MARKET_CREATION_FEE
        ) {

          return interaction.editReply({
            content:
              "❌ **Insufficient PHX to create this market.**\n\n" +
              `💰 Market creation fee: **${MARKET_CREATION_FEE.toLocaleString()} PHX**\n` +
              `💳 Your balance: **${creatorBalance.toLocaleString()} PHX**`
          });

        }

        // =================================================
        // DURATION
        // =================================================

        const duration =
          interaction.fields.getTextInputValue(
            "duration"
          ).trim();

        const match =
          duration.match(
            /^(\d+)(m|h|d|w)$/i
          );

        if (!match) {

          return interaction.editReply({
            content:
              "❌ Invalid duration.\n\n" +
              "Examples: `30m`, `2h`, `3d`, `1w`"
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

        // =================================================
        // CREATE EXACTLY ONE MARKET
        // =================================================

        const event =
          await createEvent(
            selectedMarket.category || pending.category,
            selectedMarket.question,
            selectedMarket.options,
            Date.now() + milliseconds,
            ownerId,
            null
          );

        // =================================================
        // CHARGE FEE ONLY AFTER SUCCESSFUL CREATION
        // =================================================

        creatorUser.phx =
          creatorBalance -
          MARKET_CREATION_FEE;

        await save();

        console.log(
          `💰 Charged ${MARKET_CREATION_FEE} PHX AI market creation fee from ${interaction.user.tag}`
        );

        // =================================================
        // PUBLISH MARKET
        // =================================================

        const embed =
          new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle(
              "📊 New AI Prediction Market"
            )
            .setDescription(
              selectedMarket.question
            )
            .addFields(
              {
                name: "📂 Category",
                value:
                  selectedMarket.category ||
                  pending.category,
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

        selectedMarket.options.forEach(
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

        if (interaction.channel) {

          await interaction.channel.send({
            embeds: [embed],
            components: [row]
          });

        }

        // No longer needed after successful creation.
        pendingAiMarkets.delete(ownerId);

        return interaction.editReply({
          content:
            "✅ **AI prediction market created successfully!**\n\n" +
            `📊 **${selectedMarket.question}**\n` +
            `💰 **${MARKET_CREATION_FEE.toLocaleString()} PHX** creation fee charged.\n` +
            `📈 Market ID: **${event.id}**\n` +
            `📊 Markets created today: **${marketsCreatedToday + 1}/5**`
        });

      } catch (error) {

        console.error(
          "❌ AI market creation error:",
          error
        );

        return interaction.editReply({
          content:
            `❌ **AI market creation failed.**\n\nReason: ${error.message}`
        }).catch(() => {});

      }

    }


    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("stake_")
    ) {

      await handleStakeSubmit(interaction);

      return;
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


        const inviteLeaderboardButton =
          new ButtonBuilder()
            .setCustomId(
              "prophixy_invite_leaderboard"
            )
            .setLabel(
              "Invite Leaderboard"
            )
            .setEmoji("🎁")
            .setStyle(
              ButtonStyle.Success
            );


        const leaderboardRow =
          new ActionRowBuilder()
            .addComponents(
              leaderboardButton,
              inviteLeaderboardButton
            );


        // =====================================================
        // UPDATE EXISTING LEADERBOARD PANEL
        // =====================================================

        const existingLeaderboardMessages =
          await leaderboardChannel.messages.fetch({
            limit: 50
          });

        const existingLeaderboardMessage =
          existingLeaderboardMessages.find(
            message =>
              message.author.id === client.user.id &&
              message.embeds.some(
                embed =>
                  embed.title ===
                  "🏆 Prophixy PHX Leaderboard"
              )
          );

        if (existingLeaderboardMessage) {

          await existingLeaderboardMessage.edit({
            embeds: [leaderboardEmbed],
            components: [leaderboardRow]
          });

          console.log(
            "♻️ Updated existing PHX leaderboard panel."
          );

        } else {

          await leaderboardChannel.send({
            embeds: [leaderboardEmbed],
            components: [leaderboardRow]
          });

          console.log(
            "🆕 Created PHX leaderboard panel."
          );

        }


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
    // ADMIN ROLE STATISTICS
    // =====================================================

    if (
      interaction.commandName === "role-stats"
    ) {

      if (
        !interaction.member ||
        !interaction.member.permissions.has(
          PermissionFlagsBits.Administrator
        )
      ) {
        return interaction.reply({
          content:
            "❌ You don't have permission to use this command.",
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

        await guild.members.fetch();

        const roles = guild.roles.cache
          .filter(role => role.id !== guild.id)
          .sort(
            (a, b) =>
              b.members.size - a.members.size
          );

        const lines = roles.map(
          (role, index) =>
            `**${index + 1}.** ${role} — **${role.members.size} members**`
        );

        const embed =
          new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle(
              "📊 Prophixy Discord Role Statistics"
            )
            .setDescription(
              lines.length
                ? lines.join("\n")
                : "No Discord roles found."
            )
            .setFooter({
              text:
                `Total server members: ${guild.memberCount} • ${roles.size} roles tracked`
            })
            .setTimestamp();

        await interaction.editReply({
          embeds: [embed]
        });

      } catch (error) {

        console.error(
          "❌ Role statistics error:",
          error
        );

        await interaction.editReply({
          content:
            "❌ Unable to load Discord role statistics."
        }).catch(() => {});
      }

      return;
    }


    // =====================================================
    // ADMIN PROFILE
    // =====================================================

    if (
      interaction.commandName === "admin-profile"
    ) {

      if (
        !interaction.member ||
        !interaction.member.permissions.has(
          PermissionFlagsBits.Administrator
        )
      ) {
        return interaction.reply({
          content:
            "❌ You don't have permission to use this command.",
          flags: MessageFlags.Ephemeral
        });
      }

      const target =
        interaction.options.getUser("user");

      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      try {

        const user =
          await getUser(target.id);

        if (!user) {
          return interaction.editReply({
            content:
              `❌ <@${target.id}> does not have a Prophixy account yet.`
          });
        }

        const embed =
          new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle("👤 Prophixy Admin Profile")
            .setThumbnail(target.displayAvatarURL())
            .addFields(
              {
                name: "Discord",
                value: `<@${target.id}>`,
                inline: true
              },
              {
                name: "PHX",
                value: `**${Number(user.phx || 0).toLocaleString()}**`,
                inline: true
              },
              {
                name: "Invites",
                value: `**${Number(user.invites || 0)}**`,
                inline: true
              },
              {
                name: "Wins",
                value: `**${Number(user.wins || 0)}**`,
                inline: true
              },
              {
                name: "Losses",
                value: `**${Number(user.losses || 0)}**`,
                inline: true
              },
              {
                name: "Predictions",
                value: `**${Number(user.totalPredictions || 0)}**`,
                inline: true
              },
              {
                name: "Accuracy",
                value: `**${Number(user.accuracy || 0)}%**`,
                inline: true
              },
              {
                name: "Streak",
                value: `**${Number(user.streak || 0)}**`,
                inline: true
              },
              {
                name: "Best Streak",
                value: `**${Number(user.bestStreak || 0)}**`,
                inline: true
              },
              {
                name: "SBT Role",
                value: user.sbt?.role || "none",
                inline: true
              },
              {
                name: "Wallet",
                value:
                  user.wallet ||
                  user.walletAddress ||
                  "Not connected",
                inline: false
              }
            )
            .setFooter({
              text: "Prophixy • Admin View"
            })
            .setTimestamp();

        return interaction.editReply({
          embeds: [embed]
        });

      } catch (error) {

        console.error(
          "❌ Admin profile error:",
          error
        );

        return interaction.editReply({
          content:
            "❌ Unable to load that member's profile."
        }).catch(() => {});
      }
    }


    // =====================================================
    // ADMIN ADD PHX
    // =====================================================

    if (
      interaction.commandName === "add-phx"
    ) {

      if (
        !interaction.member ||
        !interaction.member.permissions.has(
          PermissionFlagsBits.Administrator
        )
      ) {
        return interaction.reply({
          content:
            "❌ You don't have permission to use this command.",
          flags: MessageFlags.Ephemeral
        });
      }

      const target =
        interaction.options.getUser("user");

      const amount =
        interaction.options.getInteger("amount");

      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      try {

        let user =
          await getUser(target.id);

        if (!user) {
          user =
            await createUser(
              target.id,
              target.username
            );
        }

        const { db } =
          require("./services/database");

        await db.read();

        const dbUser =
          db.data.users.find(
            u => u.discordId === target.id
          );

        if (!dbUser) {
          return interaction.editReply({
            content:
              "❌ Could not find the member in the database."
          });
        }

        dbUser.phx =
          Number(dbUser.phx || 0) + amount;

        await db.write();

        return interaction.editReply({
          content:
            `✅ Added **${amount.toLocaleString()} PHX** to <@${target.id}>.\n\n` +
            `💰 New balance: **${Number(dbUser.phx).toLocaleString()} PHX**`
        });

      } catch (error) {

        console.error(
          "❌ Add PHX error:",
          error
        );

        return interaction.editReply({
          content:
            "❌ Unable to add PHX."
        }).catch(() => {});
      }
    }


    // =====================================================
    // ADMIN REMOVE PHX
    // =====================================================

    if (
      interaction.commandName === "remove-phx"
    ) {

      if (
        !interaction.member ||
        !interaction.member.permissions.has(
          PermissionFlagsBits.Administrator
        )
      ) {
        return interaction.reply({
          content:
            "❌ You don't have permission to use this command.",
          flags: MessageFlags.Ephemeral
        });
      }

      const target =
        interaction.options.getUser("user");

      const amount =
        interaction.options.getInteger("amount");

      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      try {

        const user =
          await getUser(target.id);

        if (!user) {
          return interaction.editReply({
            content:
              `❌ <@${target.id}> does not have a Prophixy account yet.`
          });
        }

        const { db } =
          require("./services/database");

        await db.read();

        const dbUser =
          db.data.users.find(
            u => u.discordId === target.id
          );

        if (!dbUser) {
          return interaction.editReply({
            content:
              "❌ Could not find the member in the database."
          });
        }

        const currentBalance =
          Number(dbUser.phx || 0);

        if (amount > currentBalance) {
          return interaction.editReply({
            content:
              `❌ Cannot remove **${amount.toLocaleString()} PHX**.\n\n` +
              `💰 Current balance: **${currentBalance.toLocaleString()} PHX**`
          });
        }

        dbUser.phx =
          currentBalance - amount;

        await db.write();

        return interaction.editReply({
          content:
            `✅ Removed **${amount.toLocaleString()} PHX** from <@${target.id}>.\n\n` +
            `💰 New balance: **${Number(dbUser.phx).toLocaleString()} PHX**`
        });

      } catch (error) {

        console.error(
          "❌ Remove PHX error:",
          error
        );

        return interaction.editReply({
          content:
            "❌ Unable to remove PHX."
        }).catch(() => {});
      }
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
            `👤 Creator reward (1%): **${Number(result.creatorReward || 0).toLocaleString()} PHX**\n` +
            `🏆 Winner pool (97%): **${Number(result.winnerPool || 0).toLocaleString()} PHX**\n` +
            `🏦 Reserve (2%): **${Number(result.reserveAmount || 0).toLocaleString()} PHX**\n\n` +
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
    // AI MARKET GENERATOR
    // =====================================================

    if (
      interaction.commandName === "ai"
    ) {

      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      // =================================================
      // MARKET CREATOR ROLE CHECK
      // =================================================

      const aiCreatorUser =
        await getUser(interaction.user.id);

      const aiCreatorRole =
        aiCreatorUser?.sbt?.role || "none";

      const aiIsAdmin =
        interaction.member?.permissions?.has(
          PermissionFlagsBits.Administrator
        );

      const allowedCreatorRoles = [
        "Top Forecaster",
        "Market Creator"
      ];

      if (
        !aiIsAdmin &&
        !allowedCreatorRoles.includes(aiCreatorRole)
      ) {

        return interaction.editReply({
          content:
            "❌ **You cannot use the AI market creator.**\n\n" +
            "Only users with the **Top Forecaster** or **Market Creator** SBT role can create prediction markets.\n\n" +
            "👤 Everyone else can participate in existing markets."
        });

      }

      try {

        const category =
          interaction.options.getString(
            "category"
          );

        const subject =
          interaction.options.getString(
            "subject"
          );

        console.log(
          `🤖 AI market generation requested: ${category} / ${subject}`
        );

        const markets =
          await generateMarkets({
            category,
            subject
          });

        if (
          !Array.isArray(markets) ||
          markets.length === 0
        ) {

          return interaction.editReply({
            content:
              "❌ AI did not generate any markets."
          });

        }

        // AI should suggest markets only.
        // It must NOT create or charge for anything yet.

        const limitedMarkets =
          markets.slice(0, 5);

        // Keep these suggestions temporarily so the creator's
        // selection can be continued through the next interaction.
        pendingAiMarkets.set(
          interaction.user.id,
          {
            category,
            subject,
            markets: limitedMarkets,
            createdAt: Date.now()
          }
        );

        const selectOptions =
          limitedMarkets.map(
            (market, index) => {

              let description =
                String(market.question || "AI market suggestion");

              if (description.length > 100) {
                description =
                  description.slice(0, 97) + "...";
              }

              return {
                label:
                  `Market ${index + 1}`,
                description,
                value:
                  String(index)
              };

            }
          );

        const selectMenu =
          new StringSelectMenuBuilder()
            .setCustomId(
              `ai_market_select_${interaction.user.id}`
            )
            .setPlaceholder(
              "Select one market to continue"
            )
            .addOptions(
              selectOptions
            );

        const row =
          new ActionRowBuilder()
            .addComponents(
              selectMenu
            );

        const formatted =
          limitedMarkets.map(
            (market, index) => {

              const options =
                Array.isArray(market.options)
                  ? market.options
                      .map(
                        (option, optionIndex) =>
                          `**${optionIndex + 1}.** ${option}`
                      )
                      .join("\n")
                  : "No options returned.";

              return (
                `### ${index + 1}. ${market.question}\n` +
                `📂 Category: **${market.category || category}**\n` +
                `🧾 Resolution: **${market.resolutionType || "Not specified"}**\n` +
                `🔎 Source: **${market.resolutionSource || "Not specified"}**\n` +
                `${options}`
              );

            }
          )
          .join("\n\n");

        return interaction.editReply({
          content:
            `🤖 **Prophixy AI Market Suggestions**\n\n` +
            `**Subject:** ${subject}\n\n` +
            `${formatted}\n\n` +
            `👇 **Select ONE suggestion below to continue.**\n` +
            `No market has been created and no PHX has been charged yet.`,
          components: [
            row
          ]
        });

      } catch (error) {

        console.error(
          "❌ AI market generation error:",
          error
        );

        return interaction.editReply({
          content:
            `❌ **AI market generation failed.**\n\n` +
            `Reason: ${error.message}`
        });

      }

    }


    // =====================================================
    // CREATE EVENT
    // =====================================================

    if (
      interaction.commandName === "event-create"
    ) {

      // =====================================================
      // ACKNOWLEDGE INTERACTION IMMEDIATELY
      // =====================================================

      await interaction.deferReply();

      // =====================================================
      // MARKET CREATOR ROLE CHECK
      // =====================================================

      const creatorUser =
        await getUser(interaction.user.id);

      const creatorRole =
        creatorUser?.sbt?.role || "none";

      const isAdmin =
        interaction.member?.permissions?.has(
          PermissionFlagsBits.Administrator
        );

      const allowedCreatorRoles = [
        "Top Forecaster",
        "Market Creator"
      ];

      if (
        !isAdmin &&
        !allowedCreatorRoles.includes(creatorRole)
      ) {

        return interaction.editReply({
          content:
            "❌ **You cannot create markets.**\\n\\n" +
            "Only users with the **Top Forecaster** or **Market Creator** SBT role can create prediction markets.\\n\\n" +
            "👤 Everyone else can participate in existing markets.",
          flags: MessageFlags.Ephemeral
        });

      }

      // =====================================================
      // DAILY MARKET CREATION LIMIT
      // =====================================================

      const marketsCreatedToday =
        await getMarketsCreatedToday(
          interaction.user.id
        );

      if (marketsCreatedToday >= 5) {

        return interaction.editReply({
          content:
            "❌ **Daily market limit reached.**\\n\\n" +
            "You can create a maximum of **5 prediction markets per day**.\\n" +
            `📊 You have already created **${marketsCreatedToday}/5** today.`,
          flags: MessageFlags.Ephemeral
        });

      }

      // =====================================================
      // MARKET CREATION FEE
      // =====================================================

      const creatorBalance =
        Number(creatorUser?.phx || 0);

      if (creatorBalance < MARKET_CREATION_FEE) {

        return interaction.editReply({
          content:
            "❌ **Insufficient PHX to create a market.**\\n\\n" +
            `💰 Market creation fee: **${MARKET_CREATION_FEE.toLocaleString()} PHX**\\n` +
            `💳 Your balance: **${creatorBalance.toLocaleString()} PHX**\\n\\n` +
            "You need enough PHX to pay the market creation fee.",
          flags: MessageFlags.Ephemeral
        });

      }

      // =====================================================
      // MARKET DETAILS
      // =====================================================

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

      const fixtureId =
        interaction.options.getString(
          "fixtureid"
        );


      const match =
        duration.match(
          /^(\d+)(m|h|d|w)$/i
        );


      if (!match) {

        return interaction.editReply({
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
            interaction.user.id,
            fixtureId
          );


      // =====================================================
      // CHARGE MARKET CREATION FEE
      // =====================================================

      creatorUser.phx =
        creatorBalance - MARKET_CREATION_FEE;

      await save();

      console.log(
        `💰 Charged ${MARKET_CREATION_FEE} PHX market creation fee from ${interaction.user.tag}`
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


      await interaction.editReply({
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

      const createdAt =
        new Date().toISOString();

      const expiresAt =
        new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ).toISOString();

      dbUser.inviteCode = invite.code;

      dbUser.inviteCreatedAt =
        createdAt;

      dbUser.inviteExpiresAt =
        expiresAt;

      // Save the exact Prophixy owner of this invite.
      // Discord may report the bot as the technical
      // inviter, so this mapping identifies the real user.
      db.data.inviteLinks ||= [];

      db.data.inviteLinks.push({
        code: invite.code,
        inviterId: userId,
        inviterUsername: interaction.user.username,
        createdAt,
        expiresAt
      });

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
