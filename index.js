require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Events
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});
require("./api")(client);

client.once(Events.ClientReady, () => {
  console.log("✅ Ready:", client.user.tag);
});

client.on(Events.InteractionCreate, async (interaction) => {

  console.log("===== INTERACTION =====");
  console.log("Type:", interaction.type);

  if (!interaction.isChatInputCommand()) return;

  console.log("Command:", interaction.commandName);
  console.log("Interaction timestamp:", interaction.createdTimestamp);
  console.log("Current timestamp:", Date.now());
  console.log("Difference (ms):", Date.now() - interaction.createdTimestamp);

  try {
    await interaction.reply({
      content: "✅ Test reply successful!"
    });

    console.log("Reply succeeded.");

  } catch (err) {
    console.error("Reply failed:");
    console.error(err);
  }

});

client.login(process.env.DISCORD_TOKEN);
