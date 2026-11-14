require("dotenv").config();

const {
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require("discord.js");

const commands = [

  // ===========================
  // ADMIN COMMUNITY PANEL
  // ===========================
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Post the PhorvaGuard community panel"),
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
    .setDescription("View a member's PhorvaGuard profile")
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
  // AI MARKET CREATOR
  // ===========================
  new SlashCommandBuilder()
    .setName("ai")
    .setDescription("Generate prediction markets with AI")
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
        .setName("subject")
        .setDescription("What should the AI create markets about?")
        .setRequired(true)
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
    )
    .addStringOption(option =>
      option
        .setName("fixtureid")
        .setDescription("API-Football fixture ID (football markets only)")
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

  // ===========================
  // ADMIN AI ANALYSIS PANEL
  // ===========================
  new SlashCommandBuilder()
    .setName("ai-panel")
    .setDescription("Create or update the PhorvaGuard AI Analysis panel"),


  // ADMIN ANNOUNCEMENT
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Post an announcement in a chosen channel")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel where the announcement will be posted")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("message")
        .setDescription("Announcement message")
        .setMaxLength(1900)
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("ping")
        .setDescription("Optional notification role to ping")
        .addChoices(
          { name: "X", value: "X" },
          { name: "Airdrop", value: "Airdrop" },
          { name: "Event", value: "Event" }
        )
        .setRequired(false)
    ),

  // CITIZEN VERIFICATION PANEL
  new SlashCommandBuilder()
    .setName("verification-panel")
    .setDescription("Post the Citizen member verification panel")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel for the verification panel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  // NOTIFICATION ROLE PANEL
  new SlashCommandBuilder()
    .setName("notification-panel")
    .setDescription("Post the X, Airdrop, and Event notification settings")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel where the notification panel will be posted")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),


  // ROLE MANAGEMENT
  new SlashCommandBuilder()
    .setName("create-role")
    .setDescription("Create a new server role")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option.setName("name")
        .setDescription("Name of the new role")
        .setMaxLength(100)
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("color")
        .setDescription("Optional hex colour, for example #5865F2")
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName("display_separately")
        .setDescription("Display members with this role separately")
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName("mentionable")
        .setDescription("Allow members to mention this role")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("delete-role")
    .setDescription("Delete a server role after confirmation")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(option =>
      option.setName("role")
        .setDescription("Role to delete")
        .setRequired(true)
    ),

  // MEMBER BAN
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member from this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(option =>
      option.setName("member")
        .setDescription("Member to ban")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("reason")
        .setDescription("Reason for the ban")
        .setMaxLength(500)
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("delete_days")
        .setDescription("Delete recent messages from the last 0 to 7 days")
        .setMinValue(0)
        .setMaxValue(7)
        .setRequired(false)
    ),



  // REMOVE MEMBER TIMEOUT
  new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Remove a member's active timeout")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName("member")
        .setDescription("Member whose timeout should be removed")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("reason")
        .setDescription("Reason for removing the timeout")
        .setMaxLength(500)
        .setRequired(true)
    ),

  // MEMBER TIMEOUT
  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Temporarily timeout a server member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName("member")
        .setDescription("Member to timeout")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("minutes")
        .setDescription("Timeout duration in minutes (1 to 40320)")
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("reason")
        .setDescription("Reason for the timeout")
        .setMaxLength(500)
        .setRequired(true)
    ),

  // STAFF RAFFLE
  new SlashCommandBuilder()
    .setName("raffle")
    .setDescription("Randomly draw winners from selected members")
    .addStringOption(option =>
      option
        .setName("participants")
        .setDescription("Mention all participants here")
        .setMaxLength(4000)
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("winners")
        .setDescription("Number of winners to draw")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),

].map(command => command.toJSON());


const rest = new REST({ version: "10" })
  .setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {

    console.log("Registering slash commands...");

    await rest.put(
      Routes.applicationCommands(
        process.env.CLIENT_ID
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
