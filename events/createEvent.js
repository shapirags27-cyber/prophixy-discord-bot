const { db, save } = require("../services/database");

async function createEvent(
  category,
  question,
  options,
  rewardPool,
  endsAt
) {
  await db.read();

  const event = {
    id: Date.now().toString(),

    category,
    question,

    options,

    rewardPool,

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
