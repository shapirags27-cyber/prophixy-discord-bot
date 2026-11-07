const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

module.exports = {

  data: new SlashCommandBuilder()
    .setName("invite-panel")
    .setDescription("Post the PhorvaGuard invite panel"),

  async execute(interaction) {

    // Acknowledge immediately so Discord does not expire the interaction
    await interaction.deferReply({ ephemeral: true });

    try {

      const channel = interaction.channel;

      if (!channel) {
        return interaction.editReply({
          content: "❌ Could not find this channel."
        });
      }

      const button = new ButtonBuilder()
        .setCustomId("generate_prophixy_invite")
        .setLabel("🎁 Generate My Invite")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder()
        .addComponents(button);

      await channel.send({
        content:
`# 🎁 PhorvaGuard Invite Program

Invite your friends to **PhorvaGuard** and earn PHX.

### How it works
1. Click **Generate My Invite**
2. The bot creates your unique invite
3. Your invite remains valid for **7 days**
4. When someone joins through your invite, it counts as a successful referral
5. You earn **+10 PHX** for each successful invite

🔗 **Your invite is unique to you.**
⏳ **Each generated invite expires after 7 days.**`,

        components: [row]
      });

      await interaction.editReply({
        content: "✅ Invite panel posted successfully."
      });

    } catch (error) {

      console.error("❌ /invite-panel error:", error);

      try {
        await interaction.editReply({
          content:
            "❌ I couldn't post the invite panel. Check the bot's channel permissions."
        });
      } catch (replyError) {
        console.error("❌ Could not edit invite-panel response:", replyError);
      }

    }
  }
};
