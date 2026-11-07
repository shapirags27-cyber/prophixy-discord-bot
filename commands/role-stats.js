const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require("discord.js");

module.exports = {

  data: new SlashCommandBuilder()
    .setName("role-stats")
    .setDescription("View how many Discord members have each role")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    ),

  async execute(interaction) {

    if (
      !interaction.member ||
      !interaction.member.permissions.has(
        PermissionFlagsBits.Administrator
      )
    ) {
      return interaction.reply({
        content:
          "❌ You don't have permission to use this command.",
        ephemeral: true
      });
    }

    const guild = interaction.guild;

    if (!guild) {
      return interaction.reply({
        content:
          "❌ This command can only be used inside the PhorvaGuard server.",
        ephemeral: true
      });
    }

    await guild.members.fetch();

    const roles = guild.roles.cache
      .filter(role => role.id !== guild.id)
      .sort(
        (a, b) =>
          b.members.size - a.members.size
      );

    const lines = roles.map(role => {
      return (
        `${role} — **${role.members.size} members**`
      );
    });

    const description =
      lines.length
        ? lines.join("\n")
        : "No Discord roles found.";

    const embed =
      new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle("📊 PhorvaGuard Discord Role Statistics")
        .setDescription(description)
        .setFooter({
          text:
            `Total server members: ${guild.memberCount}`
        })
        .setTimestamp();

    return interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  }
};
