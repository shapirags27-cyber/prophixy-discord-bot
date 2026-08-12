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
    .setDescription("Connect and verify your wallet")
    .addStringOption(option =>
      option
        .setName("wallet")
        .setDescription("Your wallet address")
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({
      ephemeral: true
    });

    try {
      const walletAddress =
        interaction.options.getString("wallet");

      // ==========================================
      // GET / CREATE DISCORD USER
      // ==========================================

      let user = await getUser(interaction.user.id);

      if (!user) {
        user = await createUser(
          interaction.user.id,
          interaction.user.username
        );
      }

      // ==========================================
      // ONE DISCORD = ONE WALLET
      // ==========================================

      if (
        user.wallet &&
        user.wallet.toLowerCase() !== walletAddress.toLowerCase()
      ) {
        return interaction.editReply(
          "❌ This Discord account is already connected to another wallet."
        );
      }

      // ==========================================
      // VERIFY SBT
      // ==========================================

      const verification =
        await verifySBT(walletAddress);

      if (!verification.verified) {
        return interaction.editReply(
          "❌ No valid Prophixy SBT was found in this wallet."
        );
      }

      const verifiedWallet =
        verification.walletAddress.toLowerCase();

      // ==========================================
      // ONE WALLET = ONE DISCORD
      // ==========================================

      const allUsers = require("../services/database").db.data.users;

      const walletOwner = allUsers.find(
        existing =>
          existing.discordId !== interaction.user.id &&
          existing.wallet &&
          existing.wallet.toLowerCase() === verifiedWallet
      );

      if (walletOwner) {
        return interaction.editReply(
          "❌ This wallet is already connected to another Discord account."
        );
      }

      // ==========================================
      // ASSIGN SBT ROLE
      // ==========================================

      await assignSbtRole(
        interaction.guild,
        interaction.user.id,
        verification.role
      );

      // ==========================================
      // SAVE WALLET + SBT
      // ==========================================

      user.wallet = verification.walletAddress;

      user.sbt = {
        ...(user.sbt || {}),
        verified: true,
        role: verification.role
      };

      // ==========================================
      // ONE-TIME SBT PHX REWARD
      // ==========================================

      let rewardMessage = "";

      if (!user.sbt.rewardClaimed) {

        const reward =
          verification.role === "Top Forecaster"
            ? 20000
            : verification.role === "Market Creator"
              ? 15000
              : 0;

        if (reward > 0) {
          user.phx =
            Number(user.phx || 0) + reward;

          user.sbt.rewardClaimed = true;

          rewardMessage =
            `\n\n🎁 **SBT verification reward:** +${reward.toLocaleString()} PHX`;
        }
      }

      await save();

      // ==========================================
      // SUCCESS
      // ==========================================

      return interaction.editReply(
        `✅ **Wallet verified successfully!**\n\n` +
        `**Wallet:** \`${verification.walletAddress}\`\n` +
        `**SBT:** Prophixy SBT\n` +
        `**Role:** **${verification.role}**\n` +
        `**PHX Balance:** **${Number(user.phx || 0).toLocaleString()} PHX**` +
        rewardMessage
      );

    } catch (error) {

      console.error(
        "❌ Connect wallet error:",
        error
      );

      return interaction.editReply(
        `❌ Unable to verify wallet.\n\n` +
        `Reason: ${error.message}`
      );
    }
  }
};
