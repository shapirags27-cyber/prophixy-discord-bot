const axios = require("axios");

const API_URL = "https://v3.football.api-sports.io";

function getClient() {
  if (!process.env.API_FOOTBALL_KEY) {
    throw new Error("API_FOOTBALL_KEY is missing from .env");
  }

  return axios.create({
    baseURL: API_URL,
    headers: {
      "x-apisports-key": process.env.API_FOOTBALL_KEY,
      "Accept": "application/json"
    },
    timeout: 15000
  });
}

// ==========================================
// GET FIXTURE BY ID
// ==========================================

async function getFixture(fixtureId) {

  if (!fixtureId) {
    throw new Error("Fixture ID is required.");
  }

  const client = getClient();

  const response = await client.get("/fixtures", {
    params: {
      id: fixtureId
    }
  });

  const remaining =
    response.headers["x-ratelimit-requests-remaining"];

  if (remaining !== undefined) {
    console.log(
      `⚽ API-Football requests remaining today: ${remaining}`
    );
  }

  if (
    !response.data ||
    !Array.isArray(response.data.response) ||
    response.data.response.length === 0
  ) {
    return null;
  }

  return response.data.response[0];
}

// ==========================================
// GET FIXTURES
// ==========================================

async function getFixtures({
  league,
  season,
  team,
  date,
  next
} = {}) {

  const client = getClient();

  const params = {};

  if (league !== undefined) params.league = league;
  if (season !== undefined) params.season = season;
  if (team !== undefined) params.team = team;
  if (date !== undefined) params.date = date;
  if (next !== undefined) params.next = next;

  let response = await client.get("/fixtures", {
    params
  });

  let errors = response.data?.errors || {};

  const remaining =
    response.headers["x-ratelimit-requests-remaining"];

  if (remaining !== undefined) {
    console.log(
      `⚽ API-Football requests remaining today: ${remaining}`
    );
  }

  if (Object.keys(errors).length > 0) {
    console.error(
      "❌ API-Football errors:",
      errors
    );
  }

  if (
    !response.data ||
    !Array.isArray(response.data.response)
  ) {
    return [];
  }

  return response.data.response;
}

// ==========================================
// SEARCH TEAMS BY NAME
// ==========================================
async function searchTeams(teamName) {
  if (!teamName || !String(teamName).trim()) {
    return [];
  }

  const client = getClient();

  const response = await client.get("/teams", {
    params: {
      search: String(teamName).trim()
    }
  });

  const errors = response.data?.errors || {};

  if (Object.keys(errors).length > 0) {
    console.error("❌ API-Football team search errors:", errors);
  }

  if (
    !response.data ||
    !Array.isArray(response.data.response)
  ) {
    return [];
  }

  return response.data.response;
}

// ==========================================
// GET NEXT FIXTURE FOR A TEAM
// ==========================================
// Fetch the team's current-season fixtures in one request and
// select the first fixture whose kickoff is still in the future.
// This avoids repeated date requests and works with API-Football
// plans that require the season parameter.
async function getNextFixtureByTeam(teamId, {
  season = new Date().getUTCFullYear()
} = {}) {

  if (!teamId) {
    throw new Error("Team ID is required.");
  }

  const numericTeamId = Number(teamId);

  if (!Number.isInteger(numericTeamId)) {
    throw new Error("Team ID must be an integer.");
  }

  const numericSeason = Number(season);

  if (!Number.isInteger(numericSeason)) {
    throw new Error("Season must be an integer.");
  }

  const fixtures = await getFixtures({
    team: numericTeamId,
    season: numericSeason
  });

  const futureFixtures = fixtures
    .filter(fixture => {
      const kickoff =
        Number(fixture.fixture?.timestamp || 0) * 1000;

      return (
        kickoff > Date.now() &&
        fixture.fixture?.id
      );
    })
    .sort(
      (a, b) =>
        Number(a.fixture.timestamp) -
        Number(b.fixture.timestamp)
    );

  if (futureFixtures.length === 0) {
    return null;
  }

  const fixture = futureFixtures[0];

  return {
    externalFixtureId:
      fixture.fixture.id,

    externalFixtureProvider:
      "api-football",

    homeTeam:
      fixture.teams?.home?.name || null,

    awayTeam:
      fixture.teams?.away?.name || null,

    kickoff:
      fixture.fixture?.date || null,

    kickoffTimestamp:
      Number(fixture.fixture?.timestamp || 0) * 1000,

    competition:
      fixture.league?.name || null,

    competitionCode:
      fixture.league?.id || null,

    status:
      fixture.fixture?.status?.short || null,

    season:
      fixture.league?.season || numericSeason
  };
}

// ==========================================
// GET FIXTURE RESULT
// ==========================================

async function getFixtureResult(fixtureId) {

  const fixture =
    await getFixture(fixtureId);

  if (!fixture) {
    return {
      found: false,
      finished: false,
      fixture: null
    };
  }

  const status =
    fixture.fixture?.status?.short;

  const finishedStatuses = [
    "FT",
    "AET",
    "PEN"
  ];

  const finished =
    finishedStatuses.includes(status);

  // API-Football statuses that mean the match has actually started.
  // Predictions must be closed once any of these statuses is reached.
  const liveStatuses = [
    "1H",
    "HT",
    "2H",
    "ET",
    "P",
    "LIVE"
  ];

  const started =
    liveStatuses.includes(status);

  // ==========================================
  // REAL-TIME FIXTURE TIMING
  // ==========================================

  const kickoffTimestamp =
    Number(fixture.fixture?.timestamp || 0) * 1000;

  const now =
    Date.now();

  // The scheduled kickoff time is useful for
  // deciding when the market should be watched
  // closely. The API status remains the authority
  // for the actual match lifecycle.
  const kickoffPassed =
    kickoffTimestamp > 0 &&
    now >= kickoffTimestamp;

  return {
    found: true,
    started,
    finished,
    kickoffPassed,
    kickoffTimestamp,
    kickoffDate:
      fixture.fixture?.date || null,
    status,
    fixture
  };
}

// ==========================================
// DETERMINE MATCH WINNER
// ==========================================

function getMatchWinner(fixture) {

  if (!fixture) {
    return null;
  }

  const homeGoals =
    fixture.goals?.home;

  const awayGoals =
    fixture.goals?.away;

  if (
    homeGoals === null ||
    homeGoals === undefined ||
    awayGoals === null ||
    awayGoals === undefined
  ) {
    return null;
  }

  if (homeGoals > awayGoals) {
    return "home";
  }

  if (awayGoals > homeGoals) {
    return "away";
  }

  return "draw";
}

// ==========================================
// EXPORT
// ==========================================

module.exports = {
  getFixture,
  getFixtures,
  searchTeams,
  getNextFixtureByTeam,
  getFixtureResult,
  getMatchWinner
};
