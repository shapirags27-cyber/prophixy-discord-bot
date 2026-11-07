const {
  SlashCommandBuilder
} = require("discord.js");

const { db } = require("../services/database");

module.exports = {

  data: new SlashCommandBuilder()
    .setName("invite")
    .setDescription("Get your PhorvaGuard Discord invite link"),

  async execute(interaction) {

    try {

      const guild = interaction.guild;

      if (!guild) {
        return interaction.reply({
          content: "❌ This command can only be used inside the PhorvaGuard Discord server.",
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
          maxAge: 7 * 24 * 60 * 60,
          maxUses: 0,
          unique: true,
          reason:
            `PhorvaGuard invite requested by ${interaction.user.tag}`
        });

      // Remember which PhorvaGuard user owns this invite link.
      // Discord sees the bot as the technical invite creator,
      // so we keep our own owner mapping.
      await db.read();

      db.data.inviteLinks ||= [];

      db.data.inviteLinks.push({
        code: invite.code,
        inviterId: interaction.user.id,
        inviterUsername: interaction.user.username,
        createdAt: new Date().toISOString(),
        expiresAt: invite.expiresAt
          ? invite.expiresAt.toISOString()
          : null
      });

      await db.write();

      console.log(
        `🔗 Invite ${invite.code} linked to ${interaction.user.username} (${interaction.user.id})`
      );

      await interaction.reply({
        content:
`# 🔗 Your PhorvaGuard Invite

Share this invite with your friends:

${invite.url}

👥 When someone joins through your invite, it will count toward your PhorvaGuard invite total.

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
