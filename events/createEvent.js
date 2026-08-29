const { db, save } = require("../services/database");

async function createEvent(
  category,
  question,
  options,
  endsAt,
  creatorId,
  fixtureId = null
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

    // 97% of the pool distributed to winning predictors
    winnerPool: 0,

    // 2% reserved for Prophixy
    reserveAmount: 0,

    creatorId,

    // ==========================================
    // EXTERNAL FIXTURE
    // ==========================================
    // Used for automatic real-world resolution.
    // Currently supported: API-Football.
    fixtureId:
      fixtureId ? Number(fixtureId) : null,

    endsAt,

    participants: 0,

    // Discord message used for live market updates.
    channelId: null,
    messageId: null,

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
