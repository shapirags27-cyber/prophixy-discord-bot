const {
  SlashCommandBuilder
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("wallet-panel")
    .setDescription("Post the PhorvaGuard wallet verification panel")
};
