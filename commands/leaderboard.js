const {
  SlashCommandBuilder,
  EmbedBuilder
} = require("discord.js");

const {
  getLeaderboard,
  getUserRank
} = require("../services/leaderboard");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View the Prophixy PHX leaderboard"),

  async execute(interaction) {
    try {
      const users = await getLeaderboard(10);

      if (!users.length) {
        return interaction.reply({
          content: "📊 The PHX leaderboard is currently empty.",
          ephemeral: true
        });
      }

      const medals = ["🥇", "🥈", "🥉"];

      const lines = users.map((user, index) => {
        const medal = medals[index] || `**${index + 1}.**`;

        return `${medal} <@${user.discordId}> — **${Number(user.phx || 0).toLocaleString()} PHX**`;
      });

      const rank = await getUserRank(interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle("🏆 Prophixy PHX Leaderboard")
        .setDescription(lines.join("\n"))
        .setFooter({
          text: rank
            ? `Your rank: #${rank.rank} • ${rank.phx.toLocaleString()} PHX`
            : "Your account is not yet ranked"
        })
        .setTimestamp();

      await interaction.reply({
        embeds: [embed]
      });

    } catch (error) {
      console.error("❌ Leaderboard error:", error);

      await interaction.reply({
        content: "❌ Unable to load the PHX leaderboard.",
        ephemeral: true
      }).catch(() => {});
    }
  }
};
