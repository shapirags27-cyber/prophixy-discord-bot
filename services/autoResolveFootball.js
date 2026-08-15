const {
  getFixtureResult,
  getMatchWinner
} = require("./apiFootball");

const {
  db,
  save
} = require("./database");

const {
  resolveEvent
} = require("../events/resolveEvent");

// ==========================================
// NORMALIZE MARKET OPTION
// ==========================================

function normalizeOption(option) {
  return String(option || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]/g, " ");
}

// ==========================================
// FIND WINNING OPTION
// ==========================================

function findWinningOption(event, result) {

  if (!event || !result || !result.fixture) {
    return null;
  }

  const winner =
    getMatchWinner(result.fixture);

  if (!winner) {
    return null;
  }

  const options =
    event.options || [];

  const homeTeam =
    normalizeOption(
      result.fixture.teams?.home?.name
    );

  const awayTeam =
    normalizeOption(
      result.fixture.teams?.away?.name
    );

  const homeGoals =
    result.fixture.goals?.home;

  const awayGoals =
    result.fixture.goals?.away;

  const totalGoals =
    Number(homeGoals || 0) +
    Number(awayGoals || 0);

  for (let i = 0; i < options.length; i++) {

    const option =
      normalizeOption(options[i]);

    // ========================================
    // MATCH WINNER
    // ========================================

    if (
      winner === "home" &&
      (
        option === "home" ||
        option === "home win" ||
        option === "home team" ||
        option === homeTeam ||
        option === `${homeTeam} win`
      )
    ) {
      return i;
    }

    if (
      winner === "away" &&
      (
        option === "away" ||
        option === "away win" ||
        option === "away team" ||
        option === awayTeam ||
        option === `${awayTeam} win`
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

    // ========================================
    // BOTH TEAMS TO SCORE
    // ========================================

    if (
      (
        option === "yes" ||
        option === "both teams score"
      ) &&
      Number(homeGoals) > 0 &&
      Number(awayGoals) > 0
    ) {
      return i;
    }

    if (
      (
        option === "no" ||
        option === "both teams do not score"
      ) &&
      (
        Number(homeGoals) === 0 ||
        Number(awayGoals) === 0
      )
    ) {
      return i;
    }

    // ========================================
    // TOTAL GOALS
    // ========================================

    if (
      option === "over 2.5 goals" &&
      totalGoals > 2.5
    ) {
      return i;
    }

    if (
      option === "under 2.5 goals" &&
      totalGoals < 2.5
    ) {
      return i;
    }

    // ========================================
    // TEAM GOAL OPTIONS
    // ========================================

    const goalMatch =
      option.match(
        /^(.*?)\s*(\d+)\s*(?:goals?)$/
      );

    if (goalMatch) {

      const team =
        goalMatch[1].trim();

      const expected =
        Number(goalMatch[2]);

      if (
        (
          team === homeTeam ||
          team === "home"
        ) &&
        Number(homeGoals) === expected
      ) {
        return i;
      }

      if (
        (
          team === awayTeam ||
          team === "away"
        ) &&
        Number(awayGoals) === expected
      ) {
        return i;
      }
    }

    // ========================================
    // 2+ / 3+ STYLE GOAL OPTIONS
    // ========================================

    const overGoalMatch =
      option.match(
        /^(.*?)\s*(\d+)\s*\+?\s*goals?$/
      );

    if (overGoalMatch) {

      const team =
        overGoalMatch[1].trim();

      const minimum =
        Number(overGoalMatch[2]);

      if (
        (
          team === homeTeam ||
          team === "home"
        ) &&
        Number(homeGoals) >= minimum
      ) {
        return i;
      }

      if (
        (
          team === awayTeam ||
          team === "away"
        ) &&
        Number(awayGoals) >= minimum
      ) {
        return i;
      }
    }
  }

  return null;
}

// ==========================================
// CLOSE MARKET WHEN MATCH STARTS
// ==========================================

async function closeFootballMarket(event) {

  if (
    !event ||
    event.status !== "active"
  ) {
    return false;
  }

  event.status = "in_progress";

  event.predictionsClosedAt =
    Date.now();

  event.resolution =
    event.resolution || {};

  event.resolution.type =
    event.resolution.type || "automatic";

  event.resolution.source =
    "API-Football";

  await save();

  console.log(
    `🔴 Predictions closed for football market ${event.id} — match has started.`
  );

  return true;
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

  if (
    event.status !== "active" &&
    event.status !== "in_progress"
  ) {
    return {
      success: false,
      resolved: false,
      message: "Market is no longer active."
    };
  }

  if (!event.fixtureId) {
    return {
      success: false,
      resolved: false,
      message:
        "This market does not have an API-Football fixture ID."
    };
  }

  console.log(
    `⚽ Checking fixture ${event.fixtureId} for market ${event.id}`
  );

  const result =
    await getFixtureResult(
      event.fixtureId
    );

  if (!result.found) {
    return {
      success: false,
      resolved: false,
      message:
        "Football fixture was not found."
    };
  }

  // ========================================
  // MATCH HAS STARTED
  // ========================================

  if (
    result.started &&
    !result.finished &&
    event.status === "active"
  ) {

    await closeFootballMarket(event);

    return {
      success: true,
      resolved: false,
      predictionsClosed: true,
      message:
        `Predictions closed. Match is now in progress (${result.status}).`,
      fixtureId: event.fixtureId,
      footballStatus: result.status
    };
  }

  // ========================================
  // MATCH NOT STARTED YET
  // ========================================

  if (
    !result.started &&
    !result.finished
  ) {

    return {
      success: true,
      resolved: false,
      predictionsClosed: false,
      message:
        `Match has not started yet. Status: ${result.status}`,
      fixtureId: event.fixtureId,
      footballStatus: result.status
    };
  }

  // ========================================
  // MATCH FINISHED
  // ========================================

  if (!result.finished) {

    return {
      success: true,
      resolved: false,
      predictionsClosed:
        event.status === "in_progress",
      message:
        `Match is still in progress. Status: ${result.status}`,
      fixtureId: event.fixtureId,
      footballStatus: result.status
    };
  }

  // If the market somehow remained active until FT,
  // close it before resolving.
  if (event.status === "active") {
    await closeFootballMarket(event);
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
        "The real match result could not be matched to this market's options.",
      fixtureId: event.fixtureId,
      footballStatus: result.status
    };
  }

  console.log(
    `🏆 Fixture ${event.fixtureId} resolved market ${event.id} with option ${winningOption}`
  );

  const resolution =
    await resolveEvent(
      event.id,
      winningOption,
      {
        type: "automatic",
        source: "API-Football"
      }
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
        (
          event.status === "active" ||
          event.status === "in_progress"
        ) &&
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
        `❌ Automatic football processing failed for ${event.id}:`,
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
  findWinningOption,
  closeFootballMarket
};
