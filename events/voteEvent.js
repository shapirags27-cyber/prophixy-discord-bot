const { db, save } = require("../services/database");

async function voteEvent(eventId, discordId, choice) {

  await db.read();

  const event = db.data.events.find(
    e => e.id === eventId
  );

  if (!event) {
    return {
      success: false,
      message: "Event not found."
    };
  }

  if (event.status !== "active") {
    return {
      success: false,
      message: "Voting is closed."
    };
  }

  const alreadyVoted = event.votes.find(
    vote => vote.discordId === discordId
  );

  if (alreadyVoted) {
    return {
      success: false,
      message:
        "You have already submitted your prediction."
    };
  }

  event.votes.push({
    discordId,
    choice,
    votedAt: Date.now()
  });

  await save();

  return {
    success: true
  };
}

module.exports = {
  voteEvent
};
