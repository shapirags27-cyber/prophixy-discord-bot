const {
  SlashCommandBuilder
} = require("discord.js");

module.exports = {

  data: new SlashCommandBuilder()
    .setName("invite")
    .setDescription("Get your Prophixy Discord invite link"),

  async execute(interaction) {

    try {

      const guild = interaction.guild;

      if (!guild) {
        return interaction.reply({
          content: "❌ This command can only be used inside the Prophixy Discord server.",
          ephemeral: true
        });
      }

      const channel =
        guild.systemChannel ||
        guild.channels.cache.find(
          channel =>
            channel.isTextBased() &&
            channel.permissionsFor(
              guild.members.me
            )?.has("CreateInstantInvite")
        );

      if (!channel) {
        return interaction.reply({
          content:
            "❌ I can't create an invite because I don't have permission to create invites.",
          ephemeral: true
        });
      }

      const invite =
        await channel.createInvite({
          maxAge: 0,
          maxUses: 0,
          unique: true,
          reason:
            `Prophixy invite created by ${interaction.user.tag}`
        });

      await interaction.reply({
        content:
`# 🔗 Your Prophixy Invite

Share this invite with your friends:

${invite.url}

👥 When someone joins through your invite, it will count toward your Prophixy invite total.

⭐ Successful invite reward: **+10 PHX**`,
        ephemeral: true
      });

    } catch (error) {

      console.error(
        "❌ /invite error:",
        error
      );

      if (!interaction.replied) {

        await interaction.reply({
          content:
            "❌ I couldn't create an invite. Make sure the bot has the **Create Invite** permission.",
          ephemeral: true
        });

      }

    }

  }

};
