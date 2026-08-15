const {
  db,
  getUser,
  updateUser,
  save
} = require("../services/database");

const { updatePredictionStats } =
  require("../services/predictions");

const CREATOR_PERCENT = 1;
const WINNER_PERCENT = 97;
const RESERVE_PERCENT = 2;

async function resolveEvent(eventId, winningOption) {

  await db.read();

  const event =
    db.data.events.find(
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
      message: "Event already resolved."
    };
  }

  const winnerOption =
    Number(winningOption);

  if (
    !Number.isInteger(winnerOption) ||
    !event.options[winnerOption]
  ) {
    return {
      success: false,
      message: "Invalid winning option."
    };
  }

  // ==========================================
  // GET ALL PREDICTIONS
  // ==========================================

  const predictions =
    db.data.predictions.filter(
      prediction =>
        prediction.eventId === eventId
    );

  // ==========================================
  // CALCULATE TOTAL MARKET POOL
  // ==========================================

  const totalPool =
    predictions.reduce(
      (total, prediction) =>
        total + Number(prediction.stake || 0),
      0
    );

  // ==========================================
  // FIND WINNERS
  // ==========================================

  const winners =
    predictions.filter(
      prediction =>
        Number(prediction.option) === winnerOption
    );

  const winningStake =
    winners.reduce(
      (total, prediction) =>
        total + Number(prediction.stake || 0),
      0
    );

  // ==========================================
  // CALCULATE DISTRIBUTION
  // ==========================================

  const creatorReward =
    Math.floor(
      totalPool * CREATOR_PERCENT / 100
    );

  const winnerPool =
    Math.floor(
      totalPool * WINNER_PERCENT / 100
    );

  const reserveAmount =
    Math.floor(
      totalPool * RESERVE_PERCENT / 100
    );

  // ==========================================
  // SAVE MARKET ACCOUNTING
  // ==========================================

  event.pool = totalPool;

  event.creatorReward =
    creatorReward;

  event.winnerPool =
    winnerPool;

  event.reserveAmount =
    reserveAmount;

  event.status = "resolved";

  event.winner =
    winnerOption;

  event.resolution = {
    type: "manual",
    source: "discord",
    resolvedAt: new Date().toISOString()
  };

  // ==========================================
  // CREATOR REWARD
  // ==========================================

  if (
    event.creatorId &&
    creatorReward > 0
  ) {

    const creator =
      await getUser(event.creatorId);

    if (creator) {

      if (creator.phx === undefined) {
        creator.phx = 0;
      }

      creator.phx += creatorReward;

      await updateUser(creator);

    }

  }

  // ==========================================
  // DISTRIBUTE WINNER POOL
  // ==========================================

  let distributedToWinners = 0;

  for (const prediction of predictions) {

    const user =
      await getUser(
        prediction.discordId
      );

    if (!user) continue;

    const won =
      Number(prediction.option) ===
      winnerOption;

    updatePredictionStats(
      user,
      won
    );

    user.totalPredictions =
      Number(user.totalPredictions || 0) + 1;

    if (won) {

      let reward = 0;

      if (winningStake > 0) {

        reward =
          Math.floor(
            winnerPool *
            Number(prediction.stake || 0) /
            winningStake
          );

      }

      user.phx =
        Number(user.phx || 0) +
        reward;

      user.wins =
        Number(user.wins || 0) + 1;

      distributedToWinners +=
        reward;

    } else {

      user.losses =
        Number(user.losses || 0) + 1;

    }

    await updateUser(user);

  }

  await save();

  return {

    success: true,

    winners:
      winners.length,

    totalPool,

    creatorReward,

    winnerPool,

    reserveAmount,

    winningStake,

    distributedToWinners

  };

}

module.exports = {
  resolveEvent
};
