const { db, save } = require("../services/database");

async function createEvent(
  category,
  question,
  options,
  endsAt,
  creatorId
) {
  await db.read();

  const event = {
    id: Date.now().toString(),

    category,
    question,
    options,

    // ==========================================
    // PHX MARKET ACCOUNTING
    // ==========================================

    // Total PHX staked by all predictors
    pool: 0,

    // PHX paid to the market creator at resolution
    creatorReward: 0,

    // 93% of the pool distributed to winning predictors
    winnerPool: 0,

    // 4% reserved for Prophixy
    reserveAmount: 0,

    creatorId,

    endsAt,

    participants: 0,

    status: "active",

    winner: null,

    resolution: {
      type: "manual",
      source: null,
      resolvedAt: null
    }
  };

  db.data.events.push(event);

  await save();

  return event;
}

module.exports = {
  createEvent
};
