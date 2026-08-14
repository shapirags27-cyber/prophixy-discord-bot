require("dotenv").config();

const {
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

const commands = [

  // ===========================
  // ADMIN COMMUNITY PANEL
  // ===========================
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Post the Prophixy community panel"),
  // ===========================
  // CONNECT WALLET
  // ===========================

  // ===========================
  // PROFILE
  // ===========================

  // ===========================
  // LEADERBOARD
  // ===========================

  // ===========================
  // INVITE PANEL
  // ===========================
  

  // ===========================
  // INVITE
  // ===========================

  // ===========================
  // ADMIN ROLE STATISTICS
  // ===========================
  new SlashCommandBuilder()
    .setName("role-stats")
    .setDescription("View how many Discord members have each role"),

  // ===========================
  // ADMIN PROFILE
  // ===========================
  new SlashCommandBuilder()
    .setName("admin-profile")
    .setDescription("View a member's Prophixy profile")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Discord member to inspect")
        .setRequired(true)
    ),

  // ===========================
  // ADMIN ADD PHX
  // ===========================
  new SlashCommandBuilder()
    .setName("add-phx")
    .setDescription("Add PHX to a member")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Discord member")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("amount")
        .setDescription("Amount of PHX to add")
        .setRequired(true)
        .setMinValue(1)
    ),

  // ===========================
  // ADMIN REMOVE PHX
  // ===========================
  new SlashCommandBuilder()
    .setName("remove-phx")
    .setDescription("Remove PHX from a member")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Discord member")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("amount")
        .setDescription("Amount of PHX to remove")
        .setRequired(true)
        .setMinValue(1)
    ),

  // ===========================
  // CREATE MARKET
  // ===========================
  new SlashCommandBuilder()
    .setName("event-create")
    .setDescription("Create a prediction market")
    .addStringOption(option =>
      option
        .setName("category")
        .setDescription("Market category")
        .setRequired(true)
        .addChoices(
          { name: "Africa", value: "africa" },
          { name: "Crypto", value: "crypto" },
          { name: "Sports", value: "sports" },
          { name: "Politics", value: "politics" },
          { name: "Economy", value: "economy" },
          { name: "Community", value: "community" }
        )
    )
    .addStringOption(option =>
      option
        .setName("question")
        .setDescription("Prediction question")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("option1")
        .setDescription("First option")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("option2")
        .setDescription("Second option")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("duration")
        .setDescription("Examples: 30m, 2h, 3d, 1w")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("option3")
        .setDescription("Third option (optional)")
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("option4")
        .setDescription("Fourth option (optional)")
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("option5")
        .setDescription("Fifth option (optional)")
        .setRequired(false)
    ),

  // ===========================
  // RESOLVE MARKET
  // ===========================
  new SlashCommandBuilder()
    .setName("resolve")
    .setDescription("Resolve a prediction market")
    .addStringOption(option =>
      option
        .setName("marketid")
        .setDescription("Market ID")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("winner")
        .setDescription("Winning option number (1-5)")
        .setRequired(true)
    ),

  // ===========================
  // TICKET PANEL
  // =========================== 

  // ===========================
  // WALLET VERIFICATION PANEL
  // ===========================

].map(command => command.toJSON());

const rest = new REST({ version: "10" })
  .setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {

    console.log("Registering slash commands...");

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log("✅ Slash commands registered successfully!");

    console.log(
      "Registered commands:",
      commands.map(command => "/" + command.name).join(", ")
    );

  } catch (err) {

    console.error("❌ Command registration failed:");
    console.error(err);

  }
})();
