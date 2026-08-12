const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ticket-panel")
    .setDescription("Post the Prophixy support ticket panel"),

  async execute(interaction) {

    const embed = new EmbedBuilder()
      .setTitle("🎫 Prophixy Support")
      .setDescription(
        "Need help with Prophixy?\n\n" +
        "You can open a private ticket to talk directly with the Prophixy team or moderators.\n\n" +
        "You can use a ticket for:\n" +
        "• Account issues\n" +
        "• Prediction issues\n" +
        "• Rewards and PHX\n" +
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
      ephemeral: true
    });
  }
};
