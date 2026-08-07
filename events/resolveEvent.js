const { db, getUser, updateUser, save } = require("../services/database");
const { updatePredictionStats } = require("../services/predictions");

async function resolveEvent(eventId, winningOption) {
  await db.read();

  const event = db.data.events.find(e => e.id === eventId);

  if (!event)
    return {
      success: false,
      message: "Event not found."
    };

 if (event.status !== "active")
    return {
      success: false,
      message: "Event already resolved."
    };

  event.status = "resolved";
  event.winner = winningOption;

  let winners = 0;

  for (const vote of event.votes) {

    const user = await getUser(vote.discordId);

    if (!user) continue;

    const won = vote.choice === winningOption;

    updatePredictionStats(user, won);

    if (won) {

      let reward = event.reward;

      if (user.sbt.role === "Top Forecaster")
        reward += 2;

      if (user.sbt.role === "Market Creator")
        reward += 1;

      user.points += reward;

      winners++;
    }

    await updateUser(user);
  }

  await save();

  return {
    success: true,
    winners
  };
}

module.exports = {
  resolveEvent
};
