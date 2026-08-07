const { db, save } = require("../services/database");

async function resolveMarket(marketId, winnerOption) {

  await db.read();

  const event = db.data.events.find(
    e => e.id === marketId
  );

  if (!event) {
    return { success: false, message: "Market not found." };
  }

  if (event.status !== "active") {
    return { success: false, message: "Market already resolved." };
  }

  event.status = "resolved";
  event.winner = winnerOption;

  const winners = db.data.predictions.filter(
    p =>
      p.eventId === marketId &&
      p.option === winnerOption
  );

  const rewardEach =
    winners.length > 0
      ? event.rewardPool / winners.length
      : 0;

  for (const prediction of winners) {

    const user = db.data.users.find(
      u => u.discordId === prediction.discordId
    );

    if (!user) continue;

    user.phx += rewardEach;
    user.wins++;
    user.totalPredictions++;
  }

  await save();

  return {
    success: true,
    winners: winners.length,
    rewardEach
  };
}

module.exports = {
  resolveMarket
};
