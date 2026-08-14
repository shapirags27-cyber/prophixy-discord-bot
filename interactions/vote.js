const {
  db,
  save,
  getUser,
  updateUser
} = require("../services/database");

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} = require("discord.js");

const MIN_STAKE = 100;

// ==========================================
// VOTE BUTTON → OPEN STAKE MODAL
// ==========================================

async function handleVote(interaction) {

  if (!interaction.customId.startsWith("vote_")) return;

  await db.read();

  const [, eventId, optionIndex] =
    interaction.customId.split("_");

  const event = db.data.events.find(
    e => e.id === eventId
  );

  console.log(
    "🎯 EVENT CHECK:",
    event ? event.id : "NOT FOUND",
    event?.status,
    event?.endsAt
  );

  if (!event) {
    return interaction.reply({
      content: "❌ Prediction market not found.",
      ephemeral: true
    });
  }

  if (event.status !== "active") {
    return interaction.reply({
      content:
        "❌ This prediction market has already ended.",
      ephemeral: true
    });
  }

  if (
    event.endsAt &&
    Date.now() >= event.endsAt
  ) {
    return interaction.reply({
      content:
        "❌ This prediction market has ended.",
      ephemeral: true
    });
  }

  const selectedOption = Number(optionIndex);

  if (
    Number.isNaN(selectedOption) ||
    !event.options[selectedOption]
  ) {
    return interaction.reply({
      content: "❌ Invalid prediction option.",
      ephemeral: true
    });
  }

  // Prevent multiple predictions
  const alreadyPredicted =
    db.data.predictions.find(
      prediction =>
        prediction.eventId === eventId &&
        prediction.discordId === interaction.user.id
    );

  if (alreadyPredicted) {
    return interaction.reply({
      content:
        "❌ You have already submitted a prediction for this market.",
      ephemeral: true
    });
  }

  // ==========================================
  // OPEN STAKE MODAL
  // ==========================================

  const modal = new ModalBuilder()
    .setCustomId(
      `stake_${eventId}_${selectedOption}`
    )
    .setTitle("Enter your PHX stake");

  const stakeInput = new TextInputBuilder()
    .setCustomId("stake_amount")
    .setLabel("How much PHX do you want to stake?")
    .setPlaceholder("Minimum: 100 PHX")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(15);

  const row = new ActionRowBuilder()
    .addComponents(stakeInput);

  modal.addComponents(row);

  await interaction.showModal(modal);
}


// ==========================================
// STAKE MODAL SUBMISSION
// ==========================================

async function handleStakeSubmit(interaction) {

  console.log(
    "🎯 STAKE SUBMISSION RECEIVED:",
    interaction.customId,
    interaction.user.id
  );

  if (!interaction.customId.startsWith("stake_")) {
    console.log("⚠️ Not a stake interaction.");
    return;
  }

  console.log("🎯 Processing stake submission...");

  await db.read();

  console.log(
    "🎯 Database loaded. Users:",
    db.data.users.length,
    "Events:",
    db.data.events.length
  );

  const [, eventId, optionIndex] =
    interaction.customId.split("_");

  const event = db.data.events.find(
    e => e.id === eventId
  );

  if (!event) {
    return interaction.reply({
      content:
        "❌ Prediction market not found.",
      ephemeral: true
    });
  }

  if (event.status !== "active") {
    return interaction.reply({
      content:
        "❌ This prediction market has already ended.",
      ephemeral: true
    });
  }

  if (
    event.endsAt &&
    Date.now() >= event.endsAt
  ) {
    return interaction.reply({
      content:
        "❌ This prediction market has ended.",
      ephemeral: true
    });
  }

  // ==========================================
  // PREVENT MULTIPLE PREDICTIONS
  // ==========================================

  const alreadyPredicted =
    db.data.predictions.find(
      prediction =>
        prediction.eventId === eventId &&
        prediction.discordId === interaction.user.id
    );

  if (alreadyPredicted) {
    return interaction.reply({
      content:
        "❌ You have already submitted a prediction for this market.",
      ephemeral: true
    });
  }

  // ==========================================
  // READ STAKE
  // ==========================================

  const rawStake =
    interaction.fields
      .getTextInputValue("stake_amount")
      .trim();

  console.log(
    "🎯 STAKE INPUT:",
    rawStake
  );

  const stake = Number(rawStake);

  console.log(
    "🎯 STAKE NUMBER:",
    stake
  );

  if (
    !Number.isFinite(stake) ||
    !Number.isInteger(stake) ||
    stake < MIN_STAKE
  ) {
    return interaction.reply({
      content:
        `❌ Invalid stake.\n\n` +
        `Minimum stake: **${MIN_STAKE.toLocaleString()} PHX**`,
      ephemeral: true
    });
  }

  // ==========================================
  // GET USER
  // ==========================================

  const user =
    await getUser(interaction.user.id);

  console.log(
    "🎯 USER CHECK:",
    user
      ? {
          discordId: user.discordId,
          phx: user.phx,
          wallet: user.wallet,
          sbtRole: user.sbt?.role
        }
      : "USER NOT FOUND"
  );

  if (!user) {
    return interaction.reply({
      content:
        "❌ You don't have a Prophixy account yet.",
      ephemeral: true
    });
  }

  if (user.phx === undefined) {
    user.phx = 0;
  }

  // ==========================================
  // CHECK BALANCE
  // ==========================================

  if (user.phx < stake) {
    return interaction.reply({
      content:
        `❌ Insufficient PHX.\n\n` +
        `💰 Your stake: **${stake.toLocaleString()} PHX**\n` +
        `💳 Your balance: **${user.phx.toLocaleString()} PHX**`,
      ephemeral: true
    });
  }

  const selectedOption = Number(optionIndex);

  if (
    Number.isNaN(selectedOption) ||
    !event.options[selectedOption]
  ) {
    return interaction.reply({
      content:
        "❌ Invalid prediction option.",
      ephemeral: true
    });
  }

  console.log(
    "🎯 BALANCE CHECK PASSED:",
    "balance=", user.phx,
    "stake=", stake
  );

  // ==========================================
  // DEDUCT STAKE
  // ==========================================

  user.phx -= stake;

  console.log(
    "🎯 PHX DEDUCTED:",
    user.phx
  );

  // ==========================================
  // ADD TO MARKET POOL
  // ==========================================

  event.pool =
    Number(event.pool || 0) + stake;

  event.participants =
    Number(event.participants || 0) + 1;

  // ==========================================
  // RECORD PREDICTION
  // ==========================================

  db.data.predictions.push({

    eventId,

    discordId:
      interaction.user.id,

    option:
      selectedOption,

    stake,

    timestamp:
      Date.now()

  });

  await updateUser(user);

  await save();

  // ==========================================
  // CONFIRMATION
  // ==========================================

  await interaction.reply({

    content:
      `✅ **Prediction submitted successfully!**\n\n` +

      `📊 Market:\n` +
      `**${event.question}**\n\n` +

      `🔮 Prediction:\n` +
      `**${event.options[selectedOption]}**\n\n` +

      `💰 Stake:\n` +
      `**${stake.toLocaleString()} PHX**\n\n` +

      `🏦 Market pool:\n` +
      `**${event.pool.toLocaleString()} PHX**\n\n` +

      `💳 Remaining balance:\n` +
      `**${user.phx.toLocaleString()} PHX**\n\n` +

      `⚠️ Your prediction cannot be changed.`,

    ephemeral: true

  });
}


module.exports = {
  handleVote,
  handleStakeSubmit
};
