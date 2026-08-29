const axios = require("axios");

const API_URL = "https://api.football-data.org/v4";

function getClient() {
  const token = process.env.FOOTBALL_DATA_API_TOKEN;

  if (!token) {
    throw new Error(
      "FOOTBALL_DATA_API_TOKEN is missing from .env"
    );
  }

  return axios.create({
    baseURL: API_URL,
    headers: {
      "X-Auth-Token": token,
      "Accept": "application/json"
    },
    timeout: 15000
  });
}

// ==========================================
// GET TEAM BY ID
// ==========================================

async function getTeam(teamId) {
  if (!teamId) {
    throw new Error(
      "Football-data team ID is required."
    );
  }

  const numericTeamId = Number(teamId);

  if (!Number.isInteger(numericTeamId)) {
    throw new Error(
      "Football-data team ID must be an integer."
    );
  }

  const client = getClient();

  const response = await client.get(
    `/teams/${numericTeamId}`
  );

  return response.data || null;
}

// ==========================================
// SEARCH TEAMS
// ==========================================

async function searchFootballDataTeams(name) {
  const query = String(name || "").trim();

  if (!query) {
    return [];
  }

  const client = getClient();

  // Premier League
  const response = await client.get(
    "/competitions/PL/teams"
  );

  const teams = Array.isArray(response.data?.teams)
    ? response.data.teams
    : [];

  const normalizedQuery =
    query
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  return teams
    .map(team => ({
      team,
      normalizedName:
        String(team.name || "")
          .toLowerCase()
          .replace(/[’']/g, "")
          .replace(/[^a-z0-9]+/g, " ")
          .trim()
    }))
    .filter(entry => {
      return (
        entry.normalizedName === normalizedQuery ||
        entry.normalizedName.includes(normalizedQuery) ||
        normalizedQuery.includes(entry.normalizedName)
      );
    })
    .map(entry => entry.team);
}

// ==========================================
// FIND NEXT FIXTURE FOR A TEAM
// ==========================================

async function getNextTeamFixture(teamId) {
  if (!teamId) {
    throw new Error(
      "Football-data team ID is required."
    );
  }

  const numericTeamId = Number(teamId);

  if (!Number.isInteger(numericTeamId)) {
    throw new Error(
      "Football-data team ID must be an integer."
    );
  }

  const client = getClient();

  const response = await client.get(
    `/teams/${numericTeamId}/matches`,
    {
      params: {
        status: "SCHEDULED"
      }
    }
  );

  const matches = Array.isArray(response.data?.matches)
    ? response.data.matches
    : [];

  const now = Date.now();

  const futureMatches = matches
    .filter(match => {
      const kickoff = Date.parse(match.utcDate);

      return (
        Number.isFinite(kickoff) &&
        kickoff > now
      );
    })
    .sort(
      (a, b) =>
        Date.parse(a.utcDate) -
        Date.parse(b.utcDate)
    );

  if (futureMatches.length === 0) {
    return null;
  }

  const match = futureMatches[0];

  return {
    externalFixtureId: Number(match.id),

    externalFixtureProvider:
      "football-data.org",

    homeTeam:
      match.homeTeam?.name || null,

    awayTeam:
      match.awayTeam?.name || null,

    kickoff:
      match.utcDate || null,

    kickoffTimestamp:
      Date.parse(match.utcDate),

    competition:
      match.competition?.name || null,

    competitionCode:
      match.competition?.code || null,

    status:
      match.status || null,

    season:
      match.season?.startDate || null
  };
}

// ==========================================
// GET ONE MATCH
// ==========================================

async function getMatch(matchId) {
  if (!matchId) {
    throw new Error(
      "Football-data match ID is required."
    );
  }

  const numericMatchId = Number(matchId);

  if (!Number.isInteger(numericMatchId)) {
    throw new Error(
      "Football-data match ID must be an integer."
    );
  }

  const client = getClient();

  const response = await client.get(
    `/matches/${numericMatchId}`
  );

  return response.data || null;
}

// ==========================================
// NORMALIZE FOOTBALL-DATA MATCH RESULT
// ==========================================

async function getMatchResult(matchId) {
  const match = await getMatch(matchId);

  if (!match) {
    return {
      found: false,
      started: false,
      finished: false,
      status: null,
      kickoffTimestamp: null,
      fixture: null
    };
  }

  const status =
    String(match.status || "").toUpperCase();

  const startedStatuses = new Set([
    "IN_PLAY",
    "PAUSED",
    "FINISHED"
  ]);

  const finishedStatuses = new Set([
    "FINISHED"
  ]);

  const started =
    startedStatuses.has(status);

  const finished =
    finishedStatuses.has(status);

  const homeName =
    match.homeTeam?.name || null;

  const awayName =
    match.awayTeam?.name || null;

  const homeGoals =
    match.score?.fullTime?.home;

  const awayGoals =
    match.score?.fullTime?.away;

  let winner = null;

  if (
    match.score?.winner === "HOME_TEAM"
  ) {
    winner = "home";
  } else if (
    match.score?.winner === "AWAY_TEAM"
  ) {
    winner = "away";
  } else if (
    match.score?.winner === "DRAW"
  ) {
    winner = "draw";
  }

  // Extra protection in case football-data.org
  // does not provide score.winner.
  if (
    finished &&
    winner === null &&
    Number.isFinite(Number(homeGoals)) &&
    Number.isFinite(Number(awayGoals))
  ) {
    if (
      Number(homeGoals) > Number(awayGoals)
    ) {
      winner = "home";
    } else if (
      Number(awayGoals) > Number(homeGoals)
    ) {
      winner = "away";
    } else {
      winner = "draw";
    }
  }

  return {
    found: true,

    started,

    finished,

    status,

    kickoffTimestamp:
      Date.parse(match.utcDate),

    fixture: {
      teams: {
        home: {
          name: homeName
        },

        away: {
          name: awayName
        }
      },

      goals: {
        home:
          Number.isFinite(Number(homeGoals))
            ? Number(homeGoals)
            : null,

        away:
          Number.isFinite(Number(awayGoals))
            ? Number(awayGoals)
            : null
      },

      winner,

      utcDate:
        match.utcDate || null,

      competition:
        match.competition?.name || null,

      competitionCode:
        match.competition?.code || null,

      status
    }
  };
}

module.exports = {
  getTeam,
  searchFootballDataTeams,
  getNextTeamFixture,
  getMatch,
  getMatchResult
};
