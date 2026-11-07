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
    .setDescription("Post the PhorvaGuard support ticket panel"),

  async execute(interaction) {

    const embed = new EmbedBuilder()
      .setTitle("🎫 PhorvaGuard Support")
      .setDescription(
        "Need help with PhorvaGuard?\n\n" +
        "You can open a private ticket to talk directly with the PhorvaGuard team or moderators.\n\n" +
        "You can use a ticket for:\n" +
        "• Account issues\n" +
        "• Prediction issues\n" +
        "• Rewards and PHX\n" +
        "• Wallet issues\n" +
        "• Market issues\n" +
        "• Reports or other private matters\n\n" +
        "🔒 Your ticket will only be visible to you and PhorvaGuard staff."
      )
      .setFooter({
        text: "PhorvaGuard • Shape Africa’s Future"
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
