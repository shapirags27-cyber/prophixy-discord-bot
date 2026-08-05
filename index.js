require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, (client) => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log("🚀 Prophixy Bot is online!");
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    console.log("Command received:", interaction.commandName);

    if (interaction.commandName === "connectwallet") {
      const button = new ButtonBuilder()
        .setLabel("🔗 Connect Wallet")
        .setStyle(ButtonStyle.Link)
        .setURL("https://example.com");

      const row = new ActionRowBuilder().addComponents(button);

      await interaction.deferReply({ ephemeral: true });

      await interaction.editReply({
        content: "Wallet connection is coming soon.",
        components: [row],
      });
    }
  } catch (err) {
    console.error("Interaction Error:");
    console.error(err);
  }
});

client.login(process.env.DISCORD_TOKEN);
