const { db, save } = require("../services/database");

async function handleVote(interaction) {

  if (!interaction.customId.startsWith("vote_")) return;

  await db.read();

  const [, eventId, optionIndex] = interaction.customId.split("_");

  const event = db.data.events.find(
    e => e.id === eventId
  );

  if (!event) {

    return interaction.reply({
      content: "❌ Prediction event not found.",
      ephemeral: true
    });

  }

  if (event.status !== "active") {

    return interaction.reply({
      content: "❌ This prediction has already ended.",
      ephemeral: true
    });

  }

  const alreadyPredicted = db.data.predictions.find(
    prediction =>
      prediction.eventId === eventId &&
      prediction.discordId === interaction.user.id
  );

  if (alreadyPredicted) {

    return interaction.reply({
      content: "❌ You have already submitted a prediction for this market.",
      ephemeral: true
    });

  }

  db.data.predictions.push({

    eventId,

    discordId: interaction.user.id,

    option: Number(optionIndex),

    timestamp: Date.now()

  });

  event.participants++;

  await save();

  await interaction.reply({

    content:
`✅ Prediction submitted successfully!

Your prediction:

**${event.options[optionIndex]}**

This prediction cannot be changed.`,

    ephemeral: true

  });

}

module.exports = {
  handleVote
};
