const {
  getFixtureResult,
  getMatchWinner
} = require("./apiFootball");

const {
  db
} = require("./database");

const {
  resolveEvent
} = require("../events/resolveEvent");

// ==========================================
// AUTOMATIC FOOTBALL MARKET RESOLUTION
// ==========================================
//
// Supported market options:
//   Home / Home Win
//   Away / Away Win
//   Draw
//
// The market must contain:
//   fixtureId
//
// Example:
//
// fixtureId: 123456
//
// options:
//   ["Home", "Away", "Draw"]
//
// ==========================================

function normalizeOption(option) {
  return String(option || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]/g, " ");
}

// ==========================================
// FIND OPTION MATCHING REAL RESULT
// ==========================================

function findWinningOption(event, result) {

  if (!event || !result) {
    return null;
  }

  const winner =
    getMatchWinner(result.fixture);

  if (!winner) {
    return null;
  }

  const options = event.options || [];

  for (let i = 0; i < options.length; i++) {

    const option =
      normalizeOption(options[i]);

    if (
      winner === "home" &&
      (
        option === "home" ||
        option === "home win" ||
        option === "home team"
      )
    ) {
      return i;
    }

    if (
      winner === "away" &&
      (
        option === "away" ||
        option === "away win" ||
        option === "away team"
      )
    ) {
      return i;
    }

    if (
      winner === "draw" &&
      (
        option === "draw" ||
        option === "tie"
      )
    ) {
      return i;
    }
  }

  return null;
}

// ==========================================
// RESOLVE ONE FOOTBALL MARKET
// ==========================================

async function autoResolveFootballMarket(eventId) {

  await db.read();

  const event =
    db.data.events.find(
      e => e.id === eventId
    );

  if (!event) {
    return {
      success: false,
      resolved: false,
      message: "Market not found."
    };
  }

  if (event.status !== "active") {
    return {
      success: false,
      resolved: false,
      message: "Market is already resolved."
    };
  }

  if (!event.fixtureId) {
    return {
      success: false,
      resolved: false,
      message: "This market does not have an API-Football fixture ID."
    };
  }

  console.log(
    `⚽ Checking API-Football fixture ${event.fixtureId} for market ${event.id}`
  );

  const result =
    await getFixtureResult(event.fixtureId);

  if (!result.found) {
    return {
      success: false,
      resolved: false,
      message: "Football fixture was not found."
    };
  }

  if (!result.finished) {
    return {
      success: true,
      resolved: false,
      message:
        `Fixture is not finished yet. Current status: ${result.status}`
    };
  }

  const winningOption =
    findWinningOption(
      event,
      result
    );

  if (winningOption === null) {

    return {
      success: false,
      resolved: false,
      message:
        "The real match result could not be matched to one of this market's options."
    };
  }

  console.log(
    `🏆 API-Football result matched to option ${winningOption}`
  );

  const resolution =
    await resolveEvent(
      event.id,
      winningOption
    );

  if (!resolution.success) {
    return {
      ...resolution,
      resolved: false
    };
  }

  return {
    ...resolution,
    resolved: true,
    fixtureId: event.fixtureId,
    footballStatus: result.status,
    winningOption
  };
}

// ==========================================
// CHECK ALL FOOTBALL MARKETS
// ==========================================

async function autoResolveFootballMarkets() {

  await db.read();

  const footballMarkets =
    db.data.events.filter(
      event =>
        event.status === "active" &&
        event.fixtureId
    );

  console.log(
    `⚽ Automatic football resolver found ${footballMarkets.length} market(s).`
  );

  const results = [];

  for (const event of footballMarkets) {

    try {

      const result =
        await autoResolveFootballMarket(
          event.id
        );

      results.push({
        eventId: event.id,
        ...result
      });

    } catch (error) {

      console.error(
        `❌ Automatic resolution failed for ${event.id}:`,
        error.message
      );

      results.push({
        eventId: event.id,
        success: false,
        resolved: false,
        message: error.message
      });
    }
  }

  return results;
}

module.exports = {
  autoResolveFootballMarket,
  autoResolveFootballMarkets,
  findWinningOption
};
