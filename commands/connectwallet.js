const { SlashCommandBuilder } = require("discord.js");

const {
  getUser,
  createUser,
  save
} = require("../services/database");

const { verifySBT } = require("../services/sbt");

const {
  assignSbtRole
} = require("../services/roles");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("connectwallet")
    .setDescription("Connect and verify your wallet"),

  async execute(interaction) {

    await interaction.deferReply({
      ephemeral: true
    });

    try {

      const walletAddress =
        interaction.options.getString("wallet");

      // --------------------------------
      // Validate wallet input
      // --------------------------------

      if (!walletAddress) {

        return interaction.editReply(
          "❌ Please provide your wallet address."
        );

      }

      // --------------------------------
      // Get or create Discord user
      // --------------------------------

      let user =
        await getUser(interaction.user.id);

      if (!user) {

        user = await createUser(
          interaction.user.id,
          interaction.user.username
        );

      }

      // --------------------------------
      // Verify SBT
      // --------------------------------

      const verification =
        await verifySBT(walletAddress);

      if (!verification.verified) {

        return interaction.editReply(
          "❌ No valid Prophixy SBT was found in this wallet."
        );

      }

      // --------------------------------
      // Assign Discord role
      // --------------------------------

      const roleResult =
        await assignSbtRole(
          interaction.guild,
          interaction.user.id,
          verification.role
        );

      // --------------------------------
      // Save verification
      // --------------------------------

      user.wallet =
        verification.walletAddress;

      user.sbt = {
        verified: true,
        role: verification.role
      };

      await save();

      // --------------------------------
      // Success
      // --------------------------------

      return interaction.editReply(
        `✅ Wallet verified successfully!\n\n` +
        `**Wallet:** \`${verification.walletAddress}\`\n` +
        `**SBT:** Prophixy SBT\n` +
        `**Role:** **${verification.role}**\n\n` +
        `🎉 Your Discord role has been assigned.`
      );

    } catch (error) {

      console.error(
        "Connect wallet error:",
        error
      );

      return interaction.editReply(
        `❌ Unable to verify wallet.\n\n` +
        `Reason: ${error.message}`
      );

    }

  }
};
