require("dotenv").config();
const fs = require("fs");

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
  db,
  initDB,
  getUser,
  createUser,
  updateUser,
  save,
  getMarketsCreatedToday,
} = require("./services/database");

const { verifySBT } = require("./services/sbt");
const { addPHX } = require("./services/phxRewards");

const {
  MARKET_CREATION_FEE
} = require("./config/rewards");

const { assignSbtRole } = require("./services/roles");

const { createEvent } = require("./events/createEvent");
const { handleVote, handleStakeSubmit } = require("./interactions/vote");
const { resolveMarket } = require("./commands/resolve");
const { autoResolveFootballMarkets } = require("./services/autoResolveFootball");
const { autoCloseExpiredMarkets } = require("./services/autoCloseExpiredMarkets");
const {
  getMatch,
  getMatchResult,
  getFootballMatchAnalysisData
} = require("./services/footballData");
const { generateMarkets } = require("./services/aiMarketGenerator");
const { resolveAIFootballSubject } = require("./services/aiFootballResolver");

const {
  analyzeFootball,
  analyzeCrypto
} = require("./services/aiAnalysis");

const {
  searchCoin,
  getCryptoMarketData
} = require("./services/cryptoMarketData");

const {
  getAIAnalysisConfig,
  setAIAnalysisRoles,
  clearAIAnalysisRoles,
  canUseAIAnalysis
} = require("./services/aiAnalysisConfig");
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

// PhorvaGuard role permissions
function memberHasNamedRole(member, names) {
  const wanted = new Set(names.map(name => name.toLowerCase()));
  return Boolean(member?.roles?.cache?.some(role =>
    wanted.has(role.name.toLowerCase())
  ));
}

function isSeniorGuardianOrAdmin(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    memberHasNamedRole(member, ["Senior Guardian"])
  );
}

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
  console.log("🚀 PhorvaGuard Beta is online!");

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

      // ==========================================
      // FOOTBALL MARKET LIFECYCLE
      // ==========================================

      const footballResults =
        await autoResolveFootballMarkets();

      const footballClosed =
        footballResults.filter(
          r => r.predictionsClosed
        );

      const footballResolved =
        footballResults.filter(
          r => r.resolved
        );

      if (footballClosed.length > 0) {

        console.log(
          `🔴 Closed predictions for ${footballClosed.length} football market(s).`
        );

      }

      if (footballResolved.length > 0) {

        console.log(
          `🏆 Automatically resolved ${footballResolved.length} football market(s).`
        );

      }

      // ==========================================
      // NON-FOOTBALL MARKET EXPIRY
      // ==========================================

      const expiredResults =
        await autoCloseExpiredMarkets();

      const expiredClosed =
        expiredResults.filter(
          r => r.closed
        );

      if (expiredClosed.length > 0) {

        console.log(
          `⏱️ Automatically closed ${expiredClosed.length} expired non-football market(s).`
        );

      }

    } catch (error) {

      console.error(
        "❌ Automatic market lifecycle error:",
        error.message
      );

    }

  }, 30 * 1000); // every 30 seconds

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
    // these invites. Use our saved PhorvaGuard invite ownership
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
        `🔗 PhorvaGuard invite ${usedInvite.code} belongs to ${inviteLink.inviterUsername} (${inviterId})`
      );
    } else {
      // Fallback for invites that were not generated through
      // the PhorvaGuard invite system.
      inviterId = usedInvite.inviterId;
    }

    if (!inviterId || inviterId === client.user.id) {

      console.log(
        `ℹ️ Could not identify a PhorvaGuard inviter for ${member.user.tag}`
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
        `🎉 **New PhorvaGuard Invite!**\n\n` +
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
      // AI ANALYSIS BUTTON
      // =====================================================

      if (interaction.customId === "prophixy_ai_analysis") {

        try {
          const allowed = await canUseAIAnalysis(
            interaction.member
          );

          if (!allowed) {
            return interaction.reply({
              content:
                "❌ **You don't have access to AI Analysis.**\\n\\n" +
                "Your server administrator must assign you an AI Analysis role before you can use this feature.",
              flags: MessageFlags.Ephemeral
            });
          }

          const row =
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId("prophixy_ai_football")
                  .setLabel("Football Analysis")
                  .setEmoji("⚽")
                  .setStyle(ButtonStyle.Primary),

                new ButtonBuilder()
                  .setCustomId("prophixy_ai_crypto")
                  .setLabel("Crypto Analysis")
                  .setEmoji("🪙")
                  .setStyle(ButtonStyle.Success)
              );

          await interaction.reply({
            content:
              "🤖 **PhorvaGuard AI Analysis**\\n\\n" +
              "Choose what you want PhorvaGuard AI to analyze:",
            components: [row],
            flags: MessageFlags.Ephemeral
          });

        } catch (error) {

          console.error(
            "❌ AI Analysis access error:",
            error
          );

          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content:
                "❌ Unable to open AI Analysis right now.",
              flags: MessageFlags.Ephemeral
            }).catch(() => {});
          }
        }

        return;
      }

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
              .setTitle("🏆 PhorvaGuard PHX Leaderboard")
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
              .setTitle("🎁 PhorvaGuard Invite Leaderboard")
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
      // CLAIM SUPPORT TICKET
      // =====================================================

      if (interaction.customId === "claim_prophixy_ticket") {
        await handleClaimTicket(interaction);
        return;
      }

      // =====================================================
      // CLOSE SUPPORT TICKET
      // =====================================================

      if (interaction.customId === "close_prophixy_ticket") {
        await handleCloseTicket(interaction);
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
              "🔐 **PhorvaGuard Wallet Verification**\n\n" +
              "Click the link below to connect your Discord account and wallet, then verify your PhorvaGuard SBT.\n\n" +
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
    // AI FOOTBALL ANALYSIS BUTTON
    // =====================================================

    if (interaction.isButton() &&
        interaction.customId === "prophixy_ai_football") {

      try {
        const allowed = await canUseAIAnalysis(
          interaction.member
        );

        if (!allowed) {
          return interaction.reply({
            content:
              "❌ **You don't have access to AI Analysis.**",
            flags: MessageFlags.Ephemeral
          });
        }

        const modal =
          new ModalBuilder()
            .setCustomId("prophixy_ai_football_modal")
            .setTitle("⚽ Football AI Analysis");

        const matchInput =
          new TextInputBuilder()
            .setCustomId("match")
            .setLabel("Football match")
            .setPlaceholder("e.g. Arsenal vs Aston Villa")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(200);

        const row =
          new ActionRowBuilder()
            .addComponents(matchInput);

        modal.addComponents(row);

        await interaction.showModal(modal);

      } catch (error) {
        console.error(
          "❌ Football AI Analysis button error:",
          error
        );

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content:
              "❌ Unable to open Football AI Analysis right now.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }

      return;
    }

    // =====================================================
    // AI CRYPTO ANALYSIS BUTTON
    // =====================================================

    if (
      interaction.isButton() &&
      interaction.customId === "prophixy_ai_crypto"
    ) {
      try {
        const allowed = await canUseAIAnalysis(
          interaction.member
        );

        if (!allowed) {
          return interaction.reply({
            content:
              "❌ **You don't have access to AI Analysis.**",
            flags: MessageFlags.Ephemeral
          });
        }

        const modal =
          new ModalBuilder()
            .setCustomId("prophixy_ai_crypto_modal")
            .setTitle("🪙 Crypto AI Analysis");

        const coinInput =
          new TextInputBuilder()
            .setCustomId("coin")
            .setLabel("Cryptocurrency")
            .setPlaceholder(
              "e.g. Bitcoin, BTC, Ethereum, ETH"
            )
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100);

        const row =
          new ActionRowBuilder()
            .addComponents(coinInput);

        modal.addComponents(row);

        await interaction.showModal(modal);

      } catch (error) {
        console.error(
          "❌ Crypto AI Analysis button error:",
          error
        );

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content:
              "❌ Unable to open Crypto AI Analysis right now.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }

      return;
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

      // =====================================================
      // FOOTBALL MARKETS
      // =====================================================
      // Football markets are controlled by the verified
      // football-data.org fixture. They MUST NOT use the
      // generic duration modal.
      //
      // The actual creator checks, fee charging and event
      // creation remain in the existing submission flow.
      // =====================================================

      const footballFixture =
        pending.realWorldData?.fixture || null;

      const isFootballMarket =
        pending.realWorldData?.sport === "football" &&
        footballFixture &&
        Number(footballFixture.fixtureId) > 0 &&
        footballFixture.fixtureProvider ===
          "football-data.org";

      if (isFootballMarket) {

        console.log(
          `⚽ Verified football market selected: ` +
          `${footballFixture.homeTeam} vs ` +
          `${footballFixture.awayTeam} ` +
          `(fixture ${footballFixture.externalFixtureId})`
        );

        // Football creation continues through the existing
        // AI duration submission handler, but with a hidden
        // marker instead of a user-controlled duration.
        const footballModal =
          new ModalBuilder()
            .setCustomId(
              `ai_football_confirm_${interaction.user.id}`
            )
            .setTitle(
              "Confirm Football Market"
            );

        const confirmInput =
          new TextInputBuilder()
            .setCustomId(
              "confirm"
            )
            .setLabel(
              "Confirm football market"
            )
            .setPlaceholder(
              `${footballFixture.homeTeam} vs ${footballFixture.awayTeam}`
            )
            .setValue(
              "CONFIRM"
            )
            .setStyle(
              TextInputStyle.Short
            )
            .setRequired(true)
            .setMaxLength(7);

        const confirmRow =
          new ActionRowBuilder()
            .addComponents(
              confirmInput
            );

        footballModal.addComponents(
          confirmRow
        );

        await interaction.showModal(
          footballModal
        );

        return;
      }

      // =====================================================
      // NON-FOOTBALL AI MARKETS
      // =====================================================
      // Existing duration behavior remains unchanged.
      // =====================================================

      // Non-football AI markets continue using the duration modal.
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
    // AI CRYPTO ANALYSIS SUBMISSION
    // =====================================================

    if (
      interaction.isModalSubmit() &&
      interaction.customId === "prophixy_ai_crypto_modal"
    ) {
      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      try {
        const allowed = await canUseAIAnalysis(
          interaction.member
        );

        if (!allowed) {
          return interaction.editReply({
            content:
              "❌ You no longer have access to AI Analysis."
          });
        }

        const subject =
          interaction.fields
            .getTextInputValue("coin")
            .trim();

        if (!subject) {
          return interaction.editReply({
            content:
              "❌ Please enter a cryptocurrency."
          });
        }

        console.log(
          "🪙 AI CRYPTO ANALYSIS REQUEST:",
          interaction.user.id,
          subject
        );

        // searchCoin returns a single verified CoinGecko coin object.
        const coin = await searchCoin(subject);

        if (!coin?.id) {
          return interaction.editReply({
            content:
              "❌ **I couldn't find that cryptocurrency.**\n\n" +
              "Try a name or symbol, for example:\n" +
              "`Bitcoin` or `BTC`\n" +
              "`Ethereum` or `ETH`"
          });
        }

        console.log(
          "🪙 AI CRYPTO ANALYSIS COIN:",
          JSON.stringify(coin, null, 2)
        );

        // This uses the supported /coins/markets endpoint.
        // No restricted CoinGecko market_chart endpoint is used.
        const marketData =
          await getCryptoMarketData(coin);

        if (!marketData) {
          return interaction.editReply({
            content:
              "❌ **Market data is currently unavailable for this cryptocurrency.**"
          });
        }

        console.log(
          "🪙 AI CRYPTO MARKET DATA:",
          JSON.stringify(marketData, null, 2)
        );

        const analysis =
          await analyzeCrypto({
            subject,
            coin,
            marketData,
            extraData: {
              provider: "CoinGecko",
              analysisTimestamp:
                new Date().toISOString()
            }
          });

        const scenarios =
          Array.isArray(analysis.scenarios)
            ? analysis.scenarios
            : [];

        const scenarioLines =
          scenarios
            .slice(0, 3)
            .map(
              scenario =>
                `**${scenario.scenario || "Scenario"}** — ` +
                `${Number(scenario.probability || 0)}%\n` +
                `${scenario.reason || "No reasoning provided."}`
            );

        const keyFactors =
          Array.isArray(analysis.keyFactors)
            ? analysis.keyFactors
            : [];

        const plainEnglish =
          analysis.plainEnglish &&
          typeof analysis.plainEnglish === "object"
            ? analysis.plainEnglish
            : {};

          const riskNotes =
          Array.isArray(
            analysis.riskManagement?.riskNotes
          )
            ? analysis.riskManagement.riskNotes
            : [];

        const profitTaking =
          Array.isArray(analysis.profitTaking)
            ? analysis.profitTaking
            : [];

        const limitations =
          Array.isArray(analysis.dataLimitations)
            ? analysis.dataLimitations
            : [];

        // Support the structured data returned by cryptoMarketData.js.
        const market =
          marketData.market ||
          {};

        const currentPrice =
          Number(
            market.priceUsd ??
            market.currentPriceUsd ??
            market.current_price ??
            marketData.currentPriceUsd ??
            marketData.priceUsd ??
            0
          );

        const priceText =
          currentPrice > 0
            ? `$${currentPrice.toLocaleString()}`
            : "Unavailable";

        const embed =
          new EmbedBuilder()
            .setColor(
              analysis.bias === "Bullish"
                ? 0x00C853
                : analysis.bias === "Bearish"
                  ? 0xD50000
                  : 0xFFB300
            )
            .setTitle(
              "🤖🪙 PhorvaGuard AI Crypto Analysis"
            )
            .setDescription(
              `**${coin.name || subject} (${String(
                coin.symbol || ""
              ).toUpperCase()})**\n` +
              `💰 Current Price: **${priceText}**`
            )
            .addFields(
              {
                name: "📋 Summary",
                value: String(
                  analysis.summary ||
                  "Unavailable"
                ).slice(0, 1024)
              },
              {
                name: "📊 Market Bias",
                value:
                  `**${analysis.bias || "Neutral"}**`,
                inline: true
              },
              {
                name: "🎯 Confidence",
                value:
                  `**${analysis.confidence || "Unknown"}**`,
                inline: true
              },
              {
                name: "📈 Market Structure",
                value:
                  `Trend: **${analysis.marketStructure?.trend || "Unknown"}**\n` +
                  `Momentum: **${analysis.marketStructure?.momentum || "Unknown"}**`,
                inline: true
              },
              {
                name: "🔮 Scenarios",
                value:
                  scenarioLines.length
                    ? scenarioLines
                        .join("\n\n")
                        .slice(0, 1024)
                    : "No scenarios available."
              },
              {
                name: "🧠 Plain-English Takeaway",
                value: (
                  `**What's happening:** ${plainEnglish.whatIsHappening || "Unavailable"}\n\n` +
                  `**What it means:** ${plainEnglish.whatItMeans || "Unavailable"}\n\n` +
                  `**AI takeaway:** ${plainEnglish.aiTakeaway || "Unavailable"}`
                ).slice(0, 1024)
              },
              {
                name: "🎯 Entry Strategy",
                value: (
                  `Status: **${analysis.entryStrategy?.status || "Unknown"}**\n` +
                  `Zone: **${analysis.entryStrategy?.preferredZone || "Unavailable"}**\n` +
                  `Confirmation: ${analysis.entryStrategy?.confirmation || "Unavailable"}\n` +
                  `Alternative: ${analysis.entryStrategy?.alternativeEntry || "Unavailable"}\n` +
                  `Why: ${analysis.entryStrategy?.why || "Unavailable"}`
                ).slice(0, 1024)
              },
              {
                name: "🛡️ Risk & Invalidation",
                value:
                  `Invalidation: **${analysis.riskManagement?.invalidation || "Unavailable"}**\n\n` +
                  (
                    riskNotes.length
                      ? riskNotes
                          .slice(0, 4)
                          .map(risk => `• ${risk}`)
                          .join("\n")
                      : "No additional risk notes."
                  )
              },
              {
                name: "💰 Profit-Taking",
                value:
                  profitTaking.length
                    ? profitTaking
                        .slice(0, 5)
                        .map(target => {
                            if (target && typeof target === "object") {
                              const price = target.target || "Target unavailable";
                              const reason = target.reason
                                ? ` — ${target.reason}`
                                : "";
                              return `• **${price}**${reason}`;
                            }

                            return `• ${String(target)}`;
                          })
                        .join("\n")
                    : "Unavailable from supplied data."
              },
              {
                name: "🔑 Key Factors",
                value:
                  keyFactors.length
                    ? keyFactors
                        .slice(0, 5)
                        .map(factor => `• ${factor}`)
                        .join("\n")
                    : "Unavailable."
              },
              {
                name: "⚠️ Data Limitations",
                value:
                  limitations.length
                    ? limitations
                        .slice(0, 5)
                        .map(
                          limitation =>
                            `• ${limitation}`
                        )
                        .join("\n")
                    : "No limitations reported."
              }
            )
            .setFooter({
              text:
                "PhorvaGuard AI • Educational analysis only • Not financial advice"
            })
            .setTimestamp();

        await interaction.editReply({
          embeds: [embed]
        });

      } catch (error) {
        console.error(
          "❌ AI Crypto Analysis error:",
          error
        );

        await interaction.editReply({
          content:
            "❌ **Crypto analysis failed.**\n\n" +
            `${error.message || "Unknown error."}`
        }).catch(() => {});
      }

      return;
    }

    // =====================================================
    // AI FOOTBALL ANALYSIS SUBMISSION
    // =====================================================

    if (
      interaction.isModalSubmit() &&
      interaction.customId === "prophixy_ai_football_modal"
    ) {

      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      try {

        const allowed = await canUseAIAnalysis(
          interaction.member
        );

        if (!allowed) {
          return interaction.editReply({
            content:
              "❌ You no longer have access to AI Analysis."
          });
        }

        const subject =
          interaction.fields.getTextInputValue("match")
            .trim();

        if (!subject) {
          return interaction.editReply({
            content:
              "❌ Please enter a football match."
          });
        }

        console.log(
          "🤖 AI FOOTBALL ANALYSIS REQUEST:",
          interaction.user.id,
          subject
        );

        const resolved =
          await resolveAIFootballSubject(subject);

        if (!resolved || !resolved.fixture) {
          return interaction.editReply({
            content:
              "❌ **I couldn't verify that football fixture.**\n\n" +
              "Please enter a specific upcoming match, for example:\n" +
              "`Arsenal vs Aston Villa`"
          });
        }

        console.log(
          "✅ AI FOOTBALL ANALYSIS FIXTURE:",
          JSON.stringify(resolved.fixture, null, 2)
        );

        let footballAnalysisData = {};

        const footballAnalysisMatchId =
          resolved.fixture.fixtureId ||
          resolved.fixture.externalFixtureId ||
          null;

        if (footballAnalysisMatchId) {
          try {
            footballAnalysisData =
              await getFootballMatchAnalysisData(
                footballAnalysisMatchId
              );

            console.log(
              "✅ AI FOOTBALL ANALYSIS DATA:",
              JSON.stringify(
                footballAnalysisData,
                null,
                2
              )
            );
          } catch (error) {
            console.error(
              "⚠️ Football deep analysis data unavailable:",
              error.message
            );
          }
        }

        const analysis =
          await analyzeFootball({
            subject,
            fixture: resolved.fixture,
            recentMatches:
              resolved.recentMatches || [],
            extraData: {
              ...(resolved.extraData || {}),
              footballAnalysisData
            }
          });

        const analyticalScenarios =
          Array.isArray(analysis.analyticalScenarios)
            ? analysis.analyticalScenarios
            : [];

        const safeText = (value, fallback = "Unavailable.") => {
          if (value === null || value === undefined) {
            return fallback;
          }

          if (typeof value === "string") {
            const text = value.trim();
            return text || fallback;
          }

          if (Array.isArray(value)) {
            return value.length
              ? value.map(item => safeText(item)).join("\n")
              : fallback;
          }

          if (typeof value === "object") {
            return Object.entries(value)
              .map(([key, item]) => {
                const label =
                  key.charAt(0).toUpperCase() + key.slice(1);
                return `**${label}:** ${safeText(item)}`;
              })
              .join("\n");
          }

          return String(value);
        };

        const limitText = (value, max = 1000) => {
          const text = safeText(value);

          if (text.length <= max) {
            return text;
          }

          return `${text.slice(0, max - 3).trim()}...`;
        };

        const listSection = (
          items,
          fallback = "None reported."
        ) => {
          if (!Array.isArray(items) || !items.length) {
            return fallback;
          }

          return items
            .slice(0, 5)
            .map(item => `• ${safeText(item)}`)
            .join("\n");
        };

        const formatAnalysisSection = (
          section,
          fallback = "Unavailable."
        ) => {
          if (!section) {
            return fallback;
          }

          if (typeof section === "string") {
            return section;
          }

          if (typeof section !== "object") {
            return String(section);
          }

          return Object.entries(section)
            .map(([key, value]) => {
              const label =
                key.charAt(0).toUpperCase() +
                key.slice(1);

              if (Array.isArray(value)) {
                return (
                  `**${label}:**\n` +
                  value
                    .slice(0, 5)
                    .map(item => `• ${safeText(item)}`)
                    .join("\n")
                );
              }

              return `**${label}:** ${safeText(value)}`;
            })
            .join("\n\n") || fallback;
        };

        const formatPreference = (
          preference,
          icon = "⭐"
        ) => {
          if (!preference || typeof preference !== "object") {
            return "No Strong Preference";
          }

          const outcome =
            safeText(
              preference.outcome,
              "No Strong Preference"
            );

          const confidence = Number(
            preference.confidence
          );

          const confidenceText =
            Number.isFinite(confidence)
              ? `${Math.max(0, Math.min(100, confidence))}% analytical confidence`
              : "Confidence unavailable";

          const reason = limitText(
            preference.reason,
            700
          );

          return (
            `${icon} **${outcome}**\n` +
            `_${confidenceText}_\n` +
            `${reason}`
          );
        };

        const scenarioLines =
          analyticalScenarios
            .slice(0, 4)
            .map((scenario, index) => {
              const confidence =
                Number(scenario?.confidence);

              const confidenceText =
                Number.isFinite(confidence)
                  ? ` • ${Math.max(0, Math.min(100, confidence))}%`
                  : "";

              return (
                `**${index + 1}. ${safeText(
                  scenario?.scenario,
                  "Analytical scenario"
                )}${confidenceText}**\n` +
                `${limitText(
                  scenario?.reason,
                  600
                )}`
              );
            });

        const statisticalAdvantages =
          listSection(
            analysis.statisticalAdvantages,
            "No major statistical advantage identified."
          );

        const conflictingSignals =
          listSection(
            analysis.conflictingSignals,
            "No major conflicting signal identified."
          );

        const keyFactors =
          listSection(
            analysis.keyFactors,
            "No key factors reported."
          );

        const risks =
          listSection(
            analysis.risks,
            "No specific risks reported."
          );

        const dataLimitations =
          listSection(
            analysis.dataLimitations,
            "No additional data limitations reported."
          );

        const preferred =
          analysis.preferredOutcomes || {};

        const preferredMatchResult =
          preferred.matchResult || {};

        const preferredGoals =
          preferred.goals || {};

        const preferredBTTS =
          preferred.bothTeamsToScore || {};

        const preferredCorrectScore =
          preferred.correctScore || {};

        const preferredAlternatives =
          Array.isArray(preferred.alternatives)
            ? preferred.alternatives
            : [];

        const matchOutlook =
          analysis.matchOutlook || {};

        const goalsOutlook =
          analysis.goalsOutlook || {};

        const bttsOutlook =
          analysis.bothTeamsToScore || {};

        const fixtureDate =
          resolved.fixture?.kickoff ||
          resolved.fixture?.date ||
          null;

        const formattedKickoff = fixtureDate
          ? (() => {
              const date = new Date(fixtureDate);

              if (Number.isNaN(date.getTime())) {
                return "Kickoff time unavailable";
              }

              return (
                date.toLocaleString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "UTC"
                }) + " UTC"
              );
            })()
          : "Kickoff time unavailable";

        const competitionName =
          resolved.fixture?.competition ||
          footballAnalysisData?.fixture?.competition?.name ||
          "Football";

        const matchday =
          footballAnalysisData?.fixture?.matchday ||
          "N/A";

        const coreEmbed =
          new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle(
              "🤖⚽ PHORVAGUARD FOOTBALL INTELLIGENCE"
            )
            .setDescription(
              [
                `### ${resolved.fixture.homeTeam} vs ${resolved.fixture.awayTeam}`,
                `**${competitionName}** • Matchday ${matchday}`,
                `📅 ${formattedKickoff}`,
                "",
                "📡 **Verified data:** football-data.org",
                "🧠 **Analysis:** PhorvaGuard AI",
                "",
                `> ${limitText(
                  analysis.summary,
                  900
                )}`
              ].join("\n")
            )
            .addFields(
              {
                name: "📋 Executive Assessment",
                value: limitText(
                  analysis.summary
                )
              },
              {
                name: "🎯 Analysis Confidence",
                value: safeText(
                  analysis.confidence,
                  "Unknown"
                ),
                inline: true
              },
              {
                name: "🏟️ Fixture Context",
                value: limitText(
                  formatAnalysisSection(
                    analysis.fixtureAnalysis
                  )
                )
              },
              {
                name: "📈 Current Form",
                value: limitText(
                  formatAnalysisSection(
                    analysis.formAnalysis
                  )
                )
              },
              {
                name: "🏠 Home vs Away",
                value: limitText(
                  formatAnalysisSection(
                    analysis.homeAwayAnalysis
                  )
                )
              },
              {
                name: "🤝 Head-to-Head",
                value: limitText(
                  formatAnalysisSection(
                    analysis.headToHeadAnalysis
                  )
                )
              },
              {
                name: "🏆 League Comparison",
                value: limitText(
                  formatAnalysisSection(
                    analysis.leagueComparison
                  )
                )
              },
              {
                name: "⚽ Scoring Analysis",
                value: limitText(
                  formatAnalysisSection(
                    analysis.scoringAnalysis
                  )
                )
              },
              {
                name: "🛡️ Defensive Analysis",
                value: limitText(
                  formatAnalysisSection(
                    analysis.defensiveAnalysis
                  )
                )
              },
              {
                name: "📌 Statistical Advantages",
                value: limitText(
                  statisticalAdvantages
                )
              },
              {
                name: "⚖️ Conflicting Signals",
                value: limitText(
                  conflictingSignals
                )
              }
            )
            .setFooter({
              text:
                "PhorvaGuard AI • Verified football-data.org analysis • Analysis only"
            })
            .setTimestamp();

        const outlookEmbed =
          new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle(
              "🎯 PHORVAGUARD AI OUTLOOK"
            )
            .setDescription(
              [
                `**${resolved.fixture.homeTeam} vs ${resolved.fixture.awayTeam}**`,
                "",
                "The preferences below are analytical estimates based on the verified football data.",
                "",
                "⚠️ **Not guarantees or betting instructions.**"
              ].join("\n")
            )
            .addFields(
              {
                name: "🏆 PREFERRED MATCH RESULT",
                value: formatPreference(
                  preferredMatchResult,
                  "⭐"
                ),
                inline: true
              },
              {
                name: "⚽ PREFERRED GOALS OUTCOME",
                value: formatPreference(
                  preferredGoals,
                  "⭐"
                ),
                inline: true
              },
              {
                name: "🔥 PREFERRED BTTS OUTCOME",
                value: formatPreference(
                  preferredBTTS,
                  "⭐"
                ),
                inline: true
              },
              {
                name: "🎯 PREFERRED CORRECT SCORE",
                value: formatPreference(
                  preferredCorrectScore,
                  "🎯"
                )
              },
              {
                name: "📊 STATISTICAL OUTLOOK",
                value: [
                  `🏠 Home win: **${Number(matchOutlook.homeWin || 0)}%**`,
                  `🤝 Draw: **${Number(matchOutlook.draw || 0)}%**`,
                  `✈️ Away win: **${Number(matchOutlook.awayWin || 0)}%**`,
                  "",
                  `⬆️ Over 2.5: **${Number(goalsOutlook.over25 || 0)}%**`,
                  `⬇️ Under 2.5: **${Number(goalsOutlook.under25 || 0)}%**`,
                  "",
                  `🔥 BTTS Yes: **${Number(bttsOutlook.yes || 0)}%**`,
                  `🚫 BTTS No: **${Number(bttsOutlook.no || 0)}%**`
                ].join("\n"),
                inline: true
              },
              {
                name: "🧠 ANALYTICAL SCENARIOS",
                value: limitText(
                  scenarioLines.length
                    ? scenarioLines.join("\n\n")
                    : "No scenarios available."
                ),
                inline: true
              },
              {
                name: "🔑 KEY FACTORS",
                value: limitText(
                  keyFactors
                )
              },
              {
                name: "⚠️ RISKS",
                value: limitText(
                  risks
                )
              },
              {
                name: "ℹ️ DATA LIMITATIONS",
                value: limitText(
                  dataLimitations
                )
              },
              {
                name: "🔄 ALTERNATIVE ANALYTICAL OUTCOMES",
                value: limitText(
                  preferredAlternatives.length
                    ? preferredAlternatives
                        .slice(0, 4)
                        .map((item, index) => {
                          const confidence =
                            Number(item?.confidence);

                          const confidenceText =
                            Number.isFinite(confidence)
                              ? ` • ${Math.max(0, Math.min(100, confidence))}%`
                              : "";

                          return [
                            `**${index + 1}. ${safeText(
                              item?.category,
                              "Alternative"
                            )}: ${safeText(
                              item?.outcome,
                              "No outcome specified"
                            )}${confidenceText}**`,
                            limitText(
                              item?.reason,
                              500
                            )
                          ].join("\n");
                        })
                        .join("\n\n")
                    : "No alternative analytical outcomes were identified."
                )
              }
            )
            .setFooter({
              text:
                "PhorvaGuard AI • Preferred outcomes are analytical estimates, not guarantees"
            })
            .setTimestamp();

        await interaction.editReply({
          embeds: [
            coreEmbed,
            outlookEmbed
          ]
        });

        await interaction.editReply({
          embeds: [embed]
        });

      } catch (error) {

        console.error(
          "❌ AI Football Analysis error:",
          error
        );

        await interaction.editReply({
          content:
            "❌ **Football analysis failed.**\n\n" +
            `${error.message || "Unknown error."}`
        }).catch(() => {});
      }

      return;
    }

    // =====================================================
    // AI MARKET SUBMISSION
    // =====================================================

    if (
      interaction.isModalSubmit() &&
      (
        interaction.customId.startsWith("ai_market_duration_") ||
        interaction.customId.startsWith("ai_football_confirm_")
      )
    ) {

      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      try {

        const ownerId =
          interaction.customId
            .replace("ai_market_duration_", "")
            .replace("ai_football_confirm_", "");

        // Football confirmation requires an explicit confirmation.
        if (
          interaction.customId.startsWith("ai_football_confirm_")
        ) {
          const confirmation =
            interaction.fields.getTextInputValue("confirm").trim();

          if (confirmation.toUpperCase() !== "CONFIRM") {
            return interaction.editReply({
              content:
                "❌ Please enter `CONFIRM` to create this football market."
            });
          }
        }

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
        // DETERMINE MARKET LIFECYCLE
        // =================================================
        // Football markets are controlled by the verified
        // football-data.org fixture kickoff.
        //
        // Non-football markets continue using the creator
        // supplied duration.
        // =================================================

        const isFootballConfirmation =
          interaction.customId.startsWith(
            "ai_football_confirm_"
          );

        // Football markets never request or read a creator-supplied duration.
        // Their lifecycle is locked to the verified football-data.org kickoff.
        let submittedDuration = "";

        if (!isFootballConfirmation) {
          submittedDuration =
            interaction.fields.getTextInputValue(
              "duration"
            ).trim();
        }

        const footballFixture =
          pending.realWorldData?.fixture || null;

        const isFootballMarket =
          pending.realWorldData?.sport === "football" &&
          footballFixture &&
          Number(footballFixture.fixtureId) > 0 &&
          footballFixture.fixtureProvider ===
            "football-data.org";

        let duration = "";
        let marketEndsAt;
        let eventFootballFixture = null;

        if (isFootballMarket) {

          const kickoffTimestamp =
            Number(
              footballFixture.kickoffTimestamp
            );

          if (
            !Number.isFinite(kickoffTimestamp) ||
            kickoffTimestamp <= 0
          ) {

            return interaction.editReply({
              content:
                "❌ **Invalid football fixture kickoff.**\n\n" +
                "The verified football-data.org fixture does not contain a valid kickoff time. " +
                "The market was not created."
            });

          }

          if (
            kickoffTimestamp <= Date.now()
          ) {

            return interaction.editReply({
              content:
                "❌ **This football fixture has already started.**\n\n" +
                "The market cannot be created because predictions must close before kickoff."
            });

          }

          marketEndsAt =
            kickoffTimestamp;

          eventFootballFixture =
            footballFixture;

          // Football markets have NO creator-supplied duration.
          // Their closing time is the verified fixture kickoff.
          duration = "";

          console.log(
            `⚽ Football market lifecycle locked to fixture kickoff: ` +
            `${new Date(kickoffTimestamp).toISOString()}`
          );

        } else {

          // =================================================
          // NON-FOOTBALL DURATION
          // =================================================

          const match =
            submittedDuration.match(
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

          marketEndsAt =
            Date.now() + milliseconds;
        }

        // =================================================
        // CREATE EXACTLY ONE MARKET
        // =================================================

        const event =
          await createEvent(
            selectedMarket.category || pending.category,
            selectedMarket.question,
            selectedMarket.options,
            marketEndsAt,
            ownerId,
            eventFootballFixture
          );

        // =================================================
        // CHARGE FEE ONLY AFTER SUCCESSFUL CREATION
        // =================================================

        // createEvent() performs its own db.read(), so the
        // original creatorUser object may reference stale data.
        // Persist the deduction through updateUser().

        const newCreatorBalance =
          creatorBalance - MARKET_CREATION_FEE;

        const updatedCreator =
          await updateUser({
            ...creatorUser,
            phx: newCreatorBalance
          });

        if (!updatedCreator) {

          console.error(
            `❌ Failed to persist ${MARKET_CREATION_FEE} PHX fee deduction for ${ownerId}`
          );

          return interaction.editReply({
            content:
              "⚠️ The market was created, but the creator balance could not be updated. Please contact support."
          });

        }

        console.log(
          `💰 Charged ${MARKET_CREATION_FEE} PHX AI market creation fee from ${interaction.user.tag}. ` +
          `Balance: ${creatorBalance} → ${newCreatorBalance}`
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
                name:
                  isFootballMarket
                    ? "⚽ Kickoff"
                    : "⏳ Duration",
                value:
                  isFootballMarket
                    ? new Date(
                        marketEndsAt
                      ).toISOString()
                    : duration,
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

          const marketMessage =
            await interaction.channel.send({
              embeds: [embed],
              components: [row]
            });

          // Store the public Discord message so the
          // market pool and participant count can be
          // updated after each successful stake.
          await db.read();

          const storedEvent =
            db.data.events.find(
              existing => existing.id === event.id
            );

          if (!storedEvent) {
            throw new Error(
              `Event ${event.id} not found while tracking public market message`
            );
          }

          storedEvent.channelId =
            marketMessage.channelId;

          storedEvent.messageId =
            marketMessage.id;

          await save();

          console.log(
            "📊 AI MARKET MESSAGE TRACKED:",
            storedEvent.id,
            `channel=${storedEvent.channelId}`,
            `message=${storedEvent.messageId}`
          );

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

      await handleStakeSubmit(interaction, client);

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
      // =====================================================
      // ADMIN AI ANALYSIS PANEL
      // =====================================================

      if (
        interaction.commandName === "ai-panel"
      ) {

        if (!isSeniorGuardianOrAdmin(interaction.member)) {
          return interaction.reply({
            content:
              "❌ You don't have permission to use the AI Analysis panel command.",
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
                "❌ This command can only be used inside a Discord server."
            });
          }

          let aiAnalysisChannel =
            guild.channels.cache.find(
              channel =>
                channel.type === ChannelType.GuildText &&
                channel.name === "🤖・ai-analysis"
            );

          if (!aiAnalysisChannel) {

            aiAnalysisChannel =
              await guild.channels.create({
                name: "🤖・ai-analysis",
                type: ChannelType.GuildText
              });

            console.log(
              `✅ Created #${aiAnalysisChannel.name}`
            );
          }

          const aiAnalysisEmbed =
            new EmbedBuilder()
              .setColor(0x0099FF)
              .setTitle("🤖 PhorvaGuard AI Analysis")
              .setDescription(
                "Use PhorvaGuard's AI to analyze football matches and cryptocurrencies.\n\n" +
                "⚽ **Football Analysis** — Analyze a verified football fixture.\n" +
                "🪙 **Crypto Analysis** — Analyze a cryptocurrency using available market data.\n\n" +
                "🔐 Access is controlled by roles configured by this server's administrators.\n\n" +
                "⚠️ AI analysis provides estimates and educational information. It does not guarantee outcomes or provide financial advice."
              )
              .setFooter({
                text:
                  "PhorvaGuard AI Analysis • Per-server access control"
              });

          const aiAnalysisButton =
            new ButtonBuilder()
              .setCustomId(
                "prophixy_ai_analysis"
              )
              .setLabel(
                "AI Analysis"
              )
              .setEmoji("🤖")
              .setStyle(
                ButtonStyle.Primary
              );

          const aiAnalysisRow =
            new ActionRowBuilder()
              .addComponents(
                aiAnalysisButton
              );

          const messages =
            await aiAnalysisChannel.messages.fetch({
              limit: 50
            });

          const existingPanel =
            messages.find(
              message =>
                message.author.id === client.user.id &&
                message.embeds.some(
                  embed =>
                    embed.title === "🤖 PhorvaGuard AI Analysis"
                )
            );

          if (existingPanel) {

            await existingPanel.edit({
              embeds: [aiAnalysisEmbed],
              components: [aiAnalysisRow]
            });

            console.log(
              "♻️ Updated existing AI Analysis panel."
            );

          } else {

            await aiAnalysisChannel.send({
              embeds: [aiAnalysisEmbed],
              components: [aiAnalysisRow]
            });

            console.log(
              "🆕 Created AI Analysis panel."
            );

          }

          await interaction.editReply({
            content:
              `✅ **AI Analysis panel ready.**\n\n` +
              `🤖 AI Analysis: ${aiAnalysisChannel}`
          });

        } catch (error) {

          console.error(
            "❌ AI Analysis panel creation error:",
            error
          );

          await interaction.editReply({
            content:
              "❌ Could not create the AI Analysis panel."
          }).catch(() => {});

        }

        return;
      }


    // ADMIN COMMUNITY PANEL
    // =====================================================

    if (interaction.commandName === "panel") {
      if (!isSeniorGuardianOrAdmin(interaction.member)) {
        return interaction.reply({
          content:
            "❌ You don't have permission to use the PhorvaGuard panel command.",
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
              "❌ This command can only be used inside the PhorvaGuard server."
          });
        }

        // Find existing channels or create missing ones.
        const getOrCreateTextChannel = async (name) => {
          let channel = guild.channels.cache.find(
            item =>
              item.type === ChannelType.GuildText &&
              item.name === name
          );

          if (!channel) {
            channel = await guild.channels.create({
              name,
              type: ChannelType.GuildText
            });

            console.log(`✅ Created #${channel.name}`);
          }

          return channel;
        };

        // Update the existing panel message when possible.
        // This prevents /panel from creating duplicate messages.
        const upsertPanelMessage = async (channel, title, payload, customId = null) => {
          const messages = await channel.messages.fetch({
            limit: 50
          });

          const existingMessage = messages.find(message => {
            if (message.author.id !== client.user.id) {
              return false;
            }

            const titleMatches = message.embeds.some(
              embed => embed.title === title
            );

            const buttonMatches = customId && message.components.some(
              row => row.components.some(
                component => component.customId === customId
              )
            );

            return titleMatches || buttonMatches;
          });

          if (existingMessage) {
            await existingMessage.edit(payload);
            console.log(`♻️ Updated panel: ${title}`);
          } else {
            await channel.send(payload);
            console.log(`🆕 Created panel: ${title}`);
          }
        };

        // Create or find all six dedicated feature channels.
        const profileChannel =
          await getOrCreateTextChannel("👤・profile");

        const leaderboardChannel =
          await getOrCreateTextChannel("🏆・phx-leaderboard");

        const inviteChannel =
          await getOrCreateTextChannel("🎁・invite-panel");

        const walletChannel =
          await getOrCreateTextChannel("🔐・wallet-verification");

        const supportChannel =
          await getOrCreateTextChannel("🎫・support");

        const aiAnalysisChannel =
          await getOrCreateTextChannel("🤖・ai-analysis");

        // DAILY CHECK-IN CHANNEL
        let dailyCheckInChannel = null;
        const configuredCheckInId =
          process.env.DAILY_CHECKIN_CHANNEL_ID;

        if (configuredCheckInId) {
          dailyCheckInChannel = await guild.channels
            .fetch(configuredCheckInId)
            .catch(() => null);
        }

        if (
          !dailyCheckInChannel ||
          dailyCheckInChannel.type !== ChannelType.GuildText
        ) {
          dailyCheckInChannel =
            await getOrCreateTextChannel("🔥・daily-check-in");

          const envPath = ".env";
          let envContent = fs.existsSync(envPath)
            ? fs.readFileSync(envPath, "utf8")
            : "";

          const setting =
            `DAILY_CHECKIN_CHANNEL_ID=${dailyCheckInChannel.id}`;

          if (/^DAILY_CHECKIN_CHANNEL_ID=.*$/m.test(envContent)) {
            envContent = envContent.replace(
              /^DAILY_CHECKIN_CHANNEL_ID=.*$/m,
              setting
            );
          } else {
            envContent =
              envContent.replace(/\s*$/, "") +
              (envContent.trim() ? "\n" : "") +
              setting +
              "\n";
          }

          fs.writeFileSync(envPath, envContent);
          process.env.DAILY_CHECKIN_CHANNEL_ID =
            dailyCheckInChannel.id;

          console.log(
            `Daily check-in channel configured: ${dailyCheckInChannel.id}`
          );
        }

        // PROFILE PANEL
        const profileEmbed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle("👤 PhorvaGuard Profile")
          .setDescription(
            "View your PhorvaGuard account information.\n\n" +
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
            "Click below to view your profile."
          )
          .setFooter({
            text: "PhorvaGuard • Shape Africa's Future"
          });

        const profileRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId("prophixy_profile")
              .setLabel("View My Profile")
              .setEmoji("👤")
              .setStyle(ButtonStyle.Primary)
          );

        await upsertPanelMessage(
          profileChannel,
          "👤 PhorvaGuard Profile",
          {
            embeds: [profileEmbed],
            components: [profileRow]
          }
        );

        // PHX AND INVITE LEADERBOARD PANEL
        const leaderboardEmbed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle("🏆 PhorvaGuard PHX Leaderboard")
          .setDescription(
            "See the top PHX holders in the PhorvaGuard community.\n\n" +
            "Use the buttons below to view the PHX leaderboard or invite leaderboard."
          )
          .setFooter({
            text: "PhorvaGuard • Shape Africa's Future"
          });

        const leaderboardRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId("prophixy_leaderboard")
              .setLabel("View PHX Leaderboard")
              .setEmoji("🏆")
              .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
              .setCustomId("prophixy_invite_leaderboard")
              .setLabel("Invite Leaderboard")
              .setEmoji("🎁")
              .setStyle(ButtonStyle.Success)
          );

        await upsertPanelMessage(
          leaderboardChannel,
          "🏆 PhorvaGuard PHX Leaderboard",
          {
            embeds: [leaderboardEmbed],
            components: [leaderboardRow]
          }
        );

        // INVITE PANEL
        const inviteEmbed = new EmbedBuilder()
          .setColor(0x00B894)
          .setTitle("🎁 PhorvaGuard Invite Program")
          .setDescription(
            "Invite people to join the PhorvaGuard community.\n\n" +
            "Generate your personal invite link using the button below.\n\n" +
            "Your existing invite rewards and tracking rules remain unchanged."
          )
          .setFooter({
            text: "PhorvaGuard • Invite and grow the community"
          });

        const inviteRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId("generate_prophixy_invite")
              .setLabel("Generate My Invite")
              .setEmoji("🎁")
              .setStyle(ButtonStyle.Success)
          );

        await upsertPanelMessage(
          inviteChannel,
          "🎁 PhorvaGuard Invite Program",
          {
            embeds: [inviteEmbed],
            components: [inviteRow]
          },
          "generate_prophixy_invite"
        );

        // WALLET VERIFICATION PANEL
        // This links to the existing verification website.
        const walletEmbed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle("🔐 PhorvaGuard Wallet Verification")
          .setDescription(
            "Connect your wallet through the official PhorvaGuard verification page.\n\n" +
            "Use the button below to open the existing wallet verification service."
          )
          .setFooter({
            text: "PhorvaGuard • Wallet and SBT Verification"
          });

        const walletRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setLabel("Verify Wallet")
              .setEmoji("🔐")
              .setStyle(ButtonStyle.Link)
              .setURL("https://prophixy-verify.onrender.com")
          );

        await upsertPanelMessage(
          walletChannel,
          "🔐 PhorvaGuard Wallet Verification",
          {
            embeds: [walletEmbed],
            components: [walletRow]
          }
        );

        // SUPPORT PANEL
        // A private ticket is created only after a user clicks this button.
        const supportEmbed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle("🎫 PhorvaGuard Private Support")
          .setDescription(
            "Need help with PhorvaGuard?\n\n" +
            "Click the button below to open a private support ticket.\n" +
            "Your ticket will be visible to you and the configured support team."
          )
          .setFooter({
            text: "PhorvaGuard • Community Support"
          });

        const supportRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId("open_prophixy_ticket")
              .setLabel("Open Ticket")
              .setEmoji("🎫")
              .setStyle(ButtonStyle.Primary)
          );

        await upsertPanelMessage(
          supportChannel,
          "🎫 PhorvaGuard Private Support",
          {
            embeds: [supportEmbed],
            components: [supportRow]
          },
          "open_prophixy_ticket"
        );

        // AI ANALYSIS PANEL
        const aiAnalysisEmbed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle("🤖 PhorvaGuard AI Analysis")
          .setDescription(
            "Use PhorvaGuard's AI to analyze football matches and cryptocurrencies.\n\n" +
            "⚽ **Football Analysis** — Analyze a verified football fixture.\n" +
            "🪙 **Crypto Analysis** — Analyze a cryptocurrency using available market data.\n\n" +
            "🔐 Access is controlled by roles configured by this server's administrators.\n\n" +
            "⚠️ AI analysis provides estimates and educational information. It does not guarantee outcomes or provide financial advice."
          )
          .setFooter({
            text: "PhorvaGuard AI Analysis • Per-server access control"
          });

        const aiAnalysisRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId("prophixy_ai_analysis")
              .setLabel("AI Analysis")
              .setEmoji("🤖")
              .setStyle(ButtonStyle.Primary)
          );

        await upsertPanelMessage(
          aiAnalysisChannel,
          "🤖 PhorvaGuard AI Analysis",
          {
            embeds: [aiAnalysisEmbed],
            components: [aiAnalysisRow]
          }
        );

        // DAILY CHECK-IN PANEL
        const dailyCheckInEmbed = new EmbedBuilder()
          .setColor(0x00B894)
          .setTitle("🔥 PhorvaGuard Daily Check-In")
          .setDescription(
            "Send **gphorva** in this channel once every 24 hours.\\n\\n" +
            "🔥 Each successful check-in advances your progress.\\n" +
            "🎁 Complete 7 check-ins to receive **5 PHX**.\\n" +
            "🔄 Your progress resets after the 7th successful check-in.\\n\\n" +
            "⏳ You must wait 24 hours between successful check-ins."
          )
          .setFooter({
            text: "PhorvaGuard • Daily Community Rewards"
          });

        await upsertPanelMessage(
          dailyCheckInChannel,
          "🔥 PhorvaGuard Daily Check-In",
          {
            embeds: [dailyCheckInEmbed]
          }
        );

        // COMMUNITY ENTRY PANEL
        // Profile and leaderboard remain in their dedicated channels.
        const communityEmbed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle("🔮 PhorvaGuard Community")
          .setDescription(
            "Predict Smarter. Decide Better. Shape Africa's Future.\n\n" +
            "Use the dedicated channels for PhorvaGuard's features:\n\n" +
            `👤 **Profile:** ${profileChannel}\n` +
            `🏆 **PHX Leaderboard:** ${leaderboardChannel}\n` +
            `🎁 **Invite Program:** ${inviteChannel}\n` +
            `🔐 **Wallet Verification:** ${walletChannel}\n` +
            `🎫 **Private Support:** ${supportChannel}\n` +
            `🤖 **AI Analysis:** ${aiAnalysisChannel}\n` +
            `🔥 **Daily Check-In:** ${dailyCheckInChannel}`
          )
          .setFooter({
            text: "PhorvaGuard • Shape Africa's Future"
          });

        const communityRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId("generate_prophixy_invite")
              .setLabel("Generate Invite")
              .setEmoji("🎁")
              .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
              .setLabel("Verify Wallet")
              .setEmoji("🔐")
              .setStyle(ButtonStyle.Link)
              .setURL("https://prophixy-verify.onrender.com"),

            new ButtonBuilder()
              .setLabel("AI Analysis")
              .setEmoji("🤖")
              .setStyle(ButtonStyle.Link)
              .setURL(
                `https://discord.com/channels/${guild.id}/${aiAnalysisChannel.id}`
              ),

            new ButtonBuilder()
              .setCustomId("open_prophixy_ticket")
              .setLabel("Support")
              .setEmoji("🎫")
              .setStyle(ButtonStyle.Primary)
          );

        await upsertPanelMessage(
          interaction.channel,
          "🔮 PhorvaGuard Community",
          {
            embeds: [communityEmbed],
            components: [communityRow]
          }
        );

        await interaction.editReply({
          content:
            "✅ PhorvaGuard panels are ready.\n\n" +
            `👤 Profile: ${profileChannel}\n` +
            `🏆 Leaderboard: ${leaderboardChannel}\n` +
            `🎁 Invite: ${inviteChannel}\n` +
            `🔐 Wallet Verification: ${walletChannel}\n` +
            `🎫 Support: ${supportChannel}\n` +
            `🤖 AI Analysis: ${aiAnalysisChannel}\n` +
            `🔥 Daily Check-In: ${dailyCheckInChannel}\n` +
            `🔮 Community panel: ${interaction.channel}`
        });

      } catch (error) {
        console.error(
          "❌ Community panel creation error:",
          error
        );

        await interaction.editReply({
          content:
            "❌ Could not create or update all PhorvaGuard panels. Check the bot logs for details."
        }).catch(() => {});
      }

      return;
    }

    // ADMIN ROLE STATISTICS
    // =====================================================

    if (
      interaction.commandName === "role-stats"
    ) {

      if (!isSeniorGuardianOrAdmin(interaction.member)) {
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
              "❌ This command can only be used inside the PhorvaGuard server."
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
              "📊 PhorvaGuard Discord Role Statistics"
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

      if (!isSeniorGuardianOrAdmin(interaction.member)) {
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
              `❌ <@${target.id}> does not have a PhorvaGuard account yet.`
          });
        }

        const embed =
          new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle("👤 PhorvaGuard Admin Profile")
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
              text: "PhorvaGuard • Admin View"
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

      if (!isSeniorGuardianOrAdmin(interaction.member)) {
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

      if (!isSeniorGuardianOrAdmin(interaction.member)) {
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
              `❌ <@${target.id}> does not have a PhorvaGuard account yet.`
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

        // =====================================================
        // REAL-WORLD FOOTBALL CONTEXT
        // =====================================================
        // When the user asks about a football team's next game,
        // resolve the actual fixture through football-data.org
        // BEFORE asking Gemini to generate markets.
        let realWorldData = {};

        if (category === "sports") {
          const footballResult =
            await resolveAIFootballSubject(subject);

          if (footballResult.resolved) {
            realWorldData = {
              sport: "football",
              team: footballResult.team,
              fixture: footballResult.fixture
            };

            console.log(
              `⚽ AI football context attached: ` +
              `${footballResult.fixture.homeTeam} vs ` +
              `${footballResult.fixture.awayTeam}`
            );
          } else {
            console.log(
              `⚠️ AI football resolver did not resolve the subject: ` +
              footballResult.reason
            );

            return interaction.editReply({
              content:
                "❌ **I couldn't resolve the football fixture.**\\n\\n" +
                `${footballResult.reason}\\n\\n` +
                "Please include the team name and try again. " +
                "I won't invent a fixture or generate a market without verified football data."
            });
          }
        }

        const markets =
          await generateMarkets({
            category,
            subject,
            data: realWorldData
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

            // Preserve the verified real-world fixture
            // through the creator selection step.
            realWorldData,

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
            `🤖 **PhorvaGuard AI Market Suggestions**\n\n` +
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

      // =====================================================
      // FOOTBALL-DATA.ORG MARKET VALIDATION
      // =====================================================

      let footballFixture = null;

      if (category === "sports") {

        if (!fixtureId) {
          return interaction.editReply({
            content:
              "❌ **Sports markets require a football-data.org match ID.**\n\n" +
              "Please provide the `fixtureid` from football-data.org."
          });
        }

        const numericFixtureId =
          Number(fixtureId);

        if (
          !Number.isInteger(numericFixtureId) ||
          numericFixtureId <= 0
        ) {
          return interaction.editReply({
            content:
              "❌ **Invalid football-data.org match ID.**\n\n" +
              "Please provide a valid football-data.org match ID."
          });
        }

        try {

          const footballStatus =
            await getMatchResult(
              numericFixtureId
            );

          if (!footballStatus.found) {
            return interaction.editReply({
              content:
                "❌ **Football match not found.**\n\n" +
                `football-data.org could not find match **${numericFixtureId}**.\n` +
                "Please check the match ID and try again."
            });
          }

          if (footballStatus.finished) {
            return interaction.editReply({
              content:
                "❌ **This football match has already finished.**\n\n" +
                "A prediction market cannot be created for a completed match."
            });
          }

          if (footballStatus.started) {
            return interaction.editReply({
              content:
                "❌ **This football match has already started.**\n\n" +
                "Predictions must be created before kickoff."
            });
          }

          const matchData =
            await getMatch(
              numericFixtureId
            );

          if (!matchData) {
            return interaction.editReply({
              content:
                "❌ **Football match could not be loaded.**\n\n" +
                "The market was not created and no PHX was charged."
            });
          }

          const kickoffTimestamp =
            Date.parse(
              matchData.utcDate
            );

          if (
            !Number.isFinite(kickoffTimestamp) ||
            kickoffTimestamp <= 0
          ) {
            return interaction.editReply({
              content:
                "❌ **Football match has no valid kickoff time.**\n\n" +
                "The market was not created and no PHX was charged."
            });
          }

          if (
            kickoffTimestamp <= Date.now()
          ) {
            return interaction.editReply({
              content:
                "❌ **This football match has already started.**\n\n" +
                "Predictions must be created before kickoff."
            });
          }

          footballFixture = {
            externalFixtureId:
              numericFixtureId,

            externalFixtureProvider:
              "football-data.org",

            homeTeam:
              matchData.homeTeam?.name ||
              null,

            awayTeam:
              matchData.awayTeam?.name ||
              null,

            kickoff:
              matchData.utcDate ||
              null,

            kickoffTimestamp,

            competition:
              matchData.competition?.name ||
              null,

            competitionCode:
              matchData.competition?.code ||
              null,

            status:
              matchData.status ||
              null,

            season:
              matchData.season?.id ||
              null
          };

          console.log(
            `✅ Valid football-data.org match ${numericFixtureId}: ` +
            `${footballFixture.homeTeam} vs ${footballFixture.awayTeam}`
          );

          console.log(
            `⚽ Football market kickoff locked to ` +
            `${new Date(kickoffTimestamp).toISOString()}`
          );

        } catch (error) {

          console.error(
            "❌ Football-data.org validation failed:",
            error.message
          );

          return interaction.editReply({
            content:
              "⚠️ **Unable to verify the football match right now.**\n\n" +
              "The market was **not created** and no PHX was charged.\n" +
              "Please try again shortly."
          });
        }
      }


      // =====================================================
      // MARKET DURATION
      // =====================================================

      let milliseconds = 0;

      if (footballFixture) {

        // Football markets always close at real kickoff.
        milliseconds =
          footballFixture.kickoffTimestamp -
          Date.now();

      } else {

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
      }


      // =====================================================
      // MARKET END TIME
      // =====================================================

      const marketEndsAt =
        footballFixture
          ? footballFixture.kickoffTimestamp
          : Date.now() + milliseconds;


      // =====================================================
      // CREATE MARKET
      // =====================================================

      const event =
        await createEvent(
          category,
          question,
          options,
          marketEndsAt,
          interaction.user.id,
          footballFixture
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


      const marketMessage =
        await interaction.editReply({
          embeds: [embed],
          components: [row]
        });

      // Store the public Discord message so its pool and
      // participant count can be updated after each stake.
      await db.read();

      const storedEvent =
        db.data.events.find(
          existing => existing.id === event.id
        );

      if (!storedEvent) {
        throw new Error(
          `Event ${event.id} not found while tracking public market message`
        );
      }

      storedEvent.channelId =
        marketMessage.channelId;

      storedEvent.messageId =
        marketMessage.id;

      await save();

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
          "❌ This button can only be used inside the PhorvaGuard server."
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
      reason: `PhorvaGuard invite for ${interaction.user.tag}`
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

      // Save the exact PhorvaGuard owner of this invite.
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
`# 🔗 Your PhorvaGuard Invite

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
  let ticketChannel = null;

  try {
    const guild = interaction.guild;

    if (!guild) {
      return interaction.editReply({
        content: "❌ This can only be used inside the PhorvaGuard server."
      });
    }

    // Prevent multiple open tickets for the same member.
    const existingTicket = guild.channels.cache.find(channel => {
      if (
        channel.type !== ChannelType.GuildText ||
        !channel.topic?.startsWith("prophixy-ticket:")
      ) return false;

      const ownerId = channel.topic
        .split("|")[0]
        .slice("prophixy-ticket:".length);

      return ownerId === interaction.user.id;
    });

    if (existingTicket) {
      return interaction.editReply({
        content: `❌ You already have an open ticket: ${existingTicket}`
      });
    }

    // These roles can view tickets. Mod and Team remain for compatibility.
    const staffRoleNames = [
      "Phorva Guardian",
      "Senior Guardian",
      "Mod",
      "Team"
    ];

    const staffRoles = guild.roles.cache.filter(role =>
      staffRoleNames.some(
        name => role.name.toLowerCase() === name.toLowerCase()
      )
    );

    const permissionOverwrites = [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel]
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

    const safeUsername = interaction.user.username
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 80) || "member";

    ticketChannel = await guild.channels.create({
      name: `ticket-${safeUsername}`,
      type: ChannelType.GuildText,
      topic: `prophixy-ticket:${interaction.user.id}`,
      permissionOverwrites
    });

    const claimButton = new ButtonBuilder()
      .setCustomId("claim_prophixy_ticket")
      .setLabel("Claim Ticket")
      .setEmoji("🙋")
      .setStyle(ButtonStyle.Success);

    const closeButton = new ButtonBuilder()
      .setCustomId("close_prophixy_ticket")
      .setLabel("Close Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder()
      .addComponents(claimButton, closeButton);

    const embed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle("🎫 PhorvaGuard Support Ticket")
      .setDescription(
        `Hello ${interaction.user} 👋\n\n` +
        "A member of the PhorvaGuard support team will assist you.\n\n" +
        "Please describe your issue clearly and provide relevant information.\n\n" +
        "🙋 Authorized Guardians can claim this ticket.\n" +
        "🔒 The ticket owner or authorized staff can close it."
      )
      .setFooter({ text: "PhorvaGuard Support" })
      .setTimestamp();

    const roleMentions = staffRoles.map(role => `<@&${role.id}>`);

    await ticketChannel.send({
      content: [interaction.user.toString(), ...roleMentions].join(" "),
      embeds: [embed],
      components: [row],
      allowedMentions: {
        users: [interaction.user.id],
        roles: staffRoles.map(role => role.id)
      }
    });

    await interaction.editReply({
      content: `✅ Your private ticket has been created: ${ticketChannel}`
    });

    console.log(
      `Ticket created for ${interaction.user.tag}: ${ticketChannel.name}`
    );

  } catch (error) {
    console.error("Ticket creation error:", error);

    // If channel creation succeeded but sending the panel failed,
    // keep the channel and report its location instead of hiding it.
    const message = ticketChannel
      ? `⚠️ Your ticket channel was created: ${ticketChannel}, but its welcome message could not be sent. Please contact staff.`
      : "❌ Could not create your ticket. Please contact a moderator.";

    await interaction.editReply({
      content: message
    }).catch(() => {});
  }
}

// ==============================
// CLAIM SUPPORT TICKET
// ==============================

async function handleClaimTicket(interaction) {
  try {
    const channel = interaction.channel;
    const member = interaction.member;

    if (
      !channel ||
      channel.type !== ChannelType.GuildText ||
      !channel.topic?.startsWith("prophixy-ticket:")
    ) {
      return interaction.reply({
        content: "❌ This is not a PhorvaGuard ticket.",
        flags: MessageFlags.Ephemeral
      });
    }

    const canClaim =
      Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator)) ||
      memberHasNamedRole(member, [
        "Phorva Guardian",
        "Senior Guardian"
      ]);

    if (!canClaim) {
      return interaction.reply({
        content: "❌ Only Phorva Guardians, Senior Guardians, and Discord Administrators can claim tickets.",
        flags: MessageFlags.Ephemeral
      });
    }

    if (channel.topic.includes("|claimed:")) {
      const claimedBy = channel.topic.split("|claimed:")[1];

      return interaction.reply({
        content: `⚠️ This ticket has already been claimed by <@${claimedBy}>.`,
        flags: MessageFlags.Ephemeral
      });
    }

    await channel.setTopic(
      `${channel.topic}|claimed:${interaction.user.id}`
    );

    await interaction.reply({
      content: `🙋 ${interaction.user} has claimed this support ticket.`
    });

    console.log(
      `Ticket ${channel.name} claimed by ${interaction.user.tag}`
    );

  } catch (error) {
    console.error("Ticket claim error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ Could not claim this ticket.",
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  }
}

// ==============================
// CLOSE SUPPORT TICKET
// ==============================

async function handleCloseTicket(interaction) {
  try {
    const channel = interaction.channel;
    const member = interaction.member;

    if (
      !channel ||
      channel.type !== ChannelType.GuildText ||
      !channel.topic?.startsWith("prophixy-ticket:")
    ) {
      return interaction.reply({
        content: "❌ This is not a PhorvaGuard ticket.",
        flags: MessageFlags.Ephemeral
      });
    }

    const ticketOwnerId = channel.topic
      .split("|")[0]
      .slice("prophixy-ticket:".length);

    const isOwner = interaction.user.id === ticketOwnerId;

    const isAuthorizedStaff =
      Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator)) ||
      memberHasNamedRole(member, [
        "Phorva Guardian",
        "Senior Guardian",
        "Mod",
        "Team"
      ]);

    if (!isOwner && !isAuthorizedStaff) {
      return interaction.reply({
        content: "❌ Only the ticket owner or authorized PhorvaGuard staff can close this ticket.",
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.reply({
      content: "🔒 This ticket will be closed in 5 seconds.",
      flags: MessageFlags.Ephemeral
    });

    console.log(
      `Ticket closed by ${interaction.user.tag}: ${channel.name}`
    );

    setTimeout(async () => {
      try {
        await channel.delete(
          `PhorvaGuard ticket closed by ${interaction.user.tag}`
        );
      } catch (error) {
        console.error("Could not delete ticket:", error);
      }
    }, 5000);

  } catch (error) {
    console.error("Close ticket error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ Could not close this ticket.",
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  }
}

// =====================================================
// PHX MESSAGE REWARDS
// =====================================================

const messageRewardLocks = new Set();
const MESSAGE_REWARD_COOLDOWN = 60 * 1000;

client.on(Events.MessageCreate, async (message) => {
  if (
    message.author.bot ||
    !message.guild ||
    !message.content ||
    !message.content.trim()
  ) return;

  const userId = message.author.id;

  if (messageRewardLocks.has(userId)) return;
  messageRewardLocks.add(userId);

  try {
    let user = await getUser(userId);

    if (!user) {
      user = await createUser(userId, message.author.username);
    }

    const now = Date.now();
    const lastRewardAt = user.lastMessageRewardAt
      ? new Date(user.lastMessageRewardAt).getTime()
      : 0;

    if (
      Number.isFinite(lastRewardAt) &&
      lastRewardAt > 0 &&
      now - lastRewardAt < MESSAGE_REWARD_COOLDOWN
    ) return;

    const newBalance = await addPHX(userId, 1);

    if (newBalance === null) {
      console.error("Message reward skipped: user record not found.");
      return;
    }

    user = await getUser(userId);
    if (!user) return;

    user.lastMessageRewardAt = new Date(now).toISOString();

    if (!await updateUser(user)) {
      console.error("Could not save message reward timestamp:", userId);
      return;
    }

    console.log(
      `Message reward: +1 PHX for ${message.author.tag}. Balance: ${newBalance}`
    );

  } catch (error) {
    console.error("PHX message reward error:", error);
  } finally {
    messageRewardLocks.delete(userId);
  }
});

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

    // Only accept gphorva / Gphorva (case-insensitive)
    if (message.content.trim().toLowerCase() !== "gphorva") {
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
