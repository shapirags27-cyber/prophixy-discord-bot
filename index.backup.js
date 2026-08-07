require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
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

  try {

    // -----------------------------
    // BUTTON INTERACTIONS
    // -----------------------------
    if (interaction.isButton()) {
      await handleVote(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    console.log("Command received:", interaction.commandName);

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

client.login(process.env.DISCORD_TOKEN);
