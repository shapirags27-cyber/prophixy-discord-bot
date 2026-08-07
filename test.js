const { Client, GatewayIntentBits, Events } = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, () => {
  console.log("Ready");
});

client.on(Events.InteractionCreate, async (interaction) => {
  console.log("Interaction received");

  try {
    await interaction.deferReply();
    console.log("Deferred successfully");

    await interaction.editReply("Hello!");
    console.log("Edited successfully");
  } catch (e) {
    console.error(e);
  }
});

client.login(process.env.DISCORD_TOKEN);
