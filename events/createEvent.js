const { db, save } = require("../services/database");

async function createEvent(
  category,
  question,
  options,
  endsAt,
  creatorId,
  footballFixture = null
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

    pool: 0,
    creatorReward: 0,
    winnerPool: 0,
    reserveAmount: 0,

    creatorId,

    // ==========================================
    // EXTERNAL FOOTBALL FIXTURE
    // ==========================================
    // football-data.org is the authoritative
    // source for AI football markets.
    //
    // Stored as metadata so the resolver does
    // not confuse this ID with API-Football IDs.
    footballFixture: footballFixture
      ? {
          id: Number(footballFixture.externalFixtureId),
          provider:
            footballFixture.externalFixtureProvider ||
            "football-data.org",

          homeTeam: footballFixture.homeTeam || null,
          awayTeam: footballFixture.awayTeam || null,

          kickoff: footballFixture.kickoff || null,
          kickoffTimestamp:
            Number(footballFixture.kickoffTimestamp) || null,

          competition: footballFixture.competition || null,
          competitionCode:
            footballFixture.competitionCode || null,

          status: footballFixture.status || null,
          season: footballFixture.season || null
        }
      : null,

    // Keep endsAt for compatibility with the existing
    // market infrastructure. For football markets,
    // this is the real football kickoff timestamp.
    endsAt,

    participants: 0,

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
