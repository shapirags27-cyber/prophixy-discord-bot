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

const footballDataTeamCache = new Map();

function normalizeFootballTeamSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SUPPORTED_FOOTBALL_COMPETITIONS = [
  "PL",   // Premier League
  "PD",   // La Liga
  "BL1",  // Bundesliga
  "SA",   // Serie A
  "FL1",  // Ligue 1
  "CL",   // UEFA Champions League
  "EL",   // UEFA Europa League
  "DED",  // Eredivisie
  "PPL",  // Primeira Liga
  "ELC",  // Championship
  "BSA"   // Brasileirão Série A
];

async function loadCompetitionTeams(client, competitionCode) {
  const cacheKey = `__COMPETITION_TEAMS_${competitionCode}__`;

  if (footballDataTeamCache.has(cacheKey)) {
    return footballDataTeamCache.get(cacheKey);
  }

  try {
    const response = await client.get(
      `/competitions/${competitionCode}/teams`
    );

    const teams = Array.isArray(response.data?.teams)
      ? response.data.teams
      : [];

    footballDataTeamCache.set(cacheKey, teams);

    return teams;
  } catch (error) {
    console.warn(
      `⚠️ Could not load ${competitionCode} teams: ` +
      `${error.response?.status || error.message}`
    );

    return [];
  }
}

function findMatchingFootballTeams(teams, normalizedQuery) {
  return teams.filter(team => {
    const normalizedName = normalizeFootballTeamSearch(team.name);
    const normalizedShortName =
      normalizeFootballTeamSearch(team.shortName);
    const normalizedTla =
      normalizeFootballTeamSearch(team.tla);

    return (
      normalizedName === normalizedQuery ||
      normalizedShortName === normalizedQuery ||
      normalizedTla === normalizedQuery ||
      normalizedName.includes(normalizedQuery) ||
      normalizedShortName.includes(normalizedQuery) ||
      normalizedQuery.includes(normalizedName) ||
      normalizedQuery.includes(normalizedShortName)
    );
  });
}

async function searchFootballDataTeams(
  name,
  requestedCompetitionCode = null
) {
  const query = String(name || "").trim();

  if (!query) {
    return [];
  }

  const client = getClient();
  const normalizedQuery =
    normalizeFootballTeamSearch(query);

  /*
   * Explicit competition:
   *
   * Only request that competition.
   *
   * This is critical for rate limiting.
   */
  if (requestedCompetitionCode) {
    const competitionCode =
      String(requestedCompetitionCode)
        .trim()
        .toUpperCase();

    if (
      !SUPPORTED_FOOTBALL_COMPETITIONS.includes(
        competitionCode
      )
    ) {
      throw new Error(
        `Unsupported football competition code: ${competitionCode}`
      );
    }

    const teams = await loadCompetitionTeams(
      client,
      competitionCode
    );

    return findMatchingFootballTeams(
      teams,
      normalizedQuery
    );
  }

  /*
   * No competition specified.
   *
   * Search only the supported domestic leagues.
   *
   * IMPORTANT:
   * We must rank partial matches across ALL
   * competitions before returning.
   *
   * Otherwise:
   *
   *   "Inter Milan"
   *
   * could encounter AC Milan first and become
   * permanently locked to AC Milan.
   */
  const competitionPriority = [
    "PL",   // Premier League
    "PD",   // La Liga
    "BL1",  // Bundesliga
    "SA",   // Serie A
    "FL1",  // Ligue 1
    "DED",  // Eredivisie
    "PPL",  // Primeira Liga
    "ELC",  // English Championship
    "BSA"   // Brasileirão Série A
  ];

  const partialMatches = [];

  for (const competitionCode of competitionPriority) {
    const teams = await loadCompetitionTeams(
      client,
      competitionCode
    );

    if (!Array.isArray(teams) || teams.length === 0) {
      continue;
    }

    /*
     * A true exact match is authoritative.
     *
     * We can safely return immediately because the
     * requested name exactly identifies this team.
     */
    const exactMatches = teams.filter(team => {
      const normalizedName =
        normalizeFootballTeamSearch(team.name);

      const normalizedShortName =
        normalizeFootballTeamSearch(team.shortName);

      const normalizedTla =
        normalizeFootballTeamSearch(team.tla);

      return (
        normalizedName === normalizedQuery ||
        normalizedShortName === normalizedQuery ||
        normalizedTla === normalizedQuery
      );
    });

      if (exactMatches.length > 0) {
        for (const team of exactMatches) {
          const normalizedShortName =
            normalizeFootballTeamSearch(team.shortName);

          const normalizedTla =
            normalizeFootballTeamSearch(team.tla);

          const normalizedName =
            normalizeFootballTeamSearch(team.name);

          let score = 0;

          if (normalizedShortName === normalizedQuery) {
            score = 3000;
          } else if (normalizedTla === normalizedQuery) {
            score = 2900;
          } else if (normalizedName === normalizedQuery) {
            score = 2800;
          }

          partialMatches.push({
            team,
            competitionCode,
            score
          });
        }

        continue;
      }

      /*
       * Single-word football identity:
       * prefer an exact shortName over a longer club name
       * that merely contains the requested word.
       *
       * Example:
       * "Barcelona" -> FC Barcelona
       * instead of RCD Espanyol de Barcelona.
       */
      if (!normalizedQuery.includes(" ")) {
        const exactShortName = teams.filter(team =>
          normalizeFootballTeamSearch(team.shortName) ===
          normalizedQuery
        );

        if (exactShortName.length > 0) {
          return exactShortName;
        }
      }

    /*
     * Score partial candidates.
     *
     * Short-name matches are weighted heavily because
     * they are usually the most useful football identity.
     *
     * Example:
     *
     * "Inter Milan"
     *
     * Inter:
     *   shortName = "Inter" -> strong match
     *
     * AC Milan:
     *   shortName = "Milan" -> only one generic word
     *
     * Therefore Inter wins.
     */
    for (const team of teams) {
      const normalizedName =
        normalizeFootballTeamSearch(team.name);

      const normalizedShortName =
        normalizeFootballTeamSearch(team.shortName);

      const normalizedTla =
        normalizeFootballTeamSearch(team.tla);

      const queryWords =
        normalizedQuery.split(" ");

      let score = 0;

      /*
       * Full-field matches.
       */
      if (normalizedName === normalizedQuery) {
        score += 1000;
      }

      if (normalizedShortName === normalizedQuery) {
        score += 1200;
      }

      if (normalizedTla === normalizedQuery) {
        score += 1100;
      }

      /*
       * Phrase contained in official name/short name.
       */
      if (
        normalizedName.includes(normalizedQuery)
      ) {
        score += 300;
      }

      if (
        normalizedShortName.includes(normalizedQuery)
      ) {
        score += 400;
      }

      /*
       * Word-level matching.
       */
      for (const word of queryWords) {
        if (!word) {
          continue;
        }

        if (
          normalizedShortName === word
        ) {
          score += 900;
        } else if (
          normalizedShortName
            .split(" ")
            .includes(word)
        ) {
          score += 500;
        }

        if (
          normalizedTla === word
        ) {
          score += 800;
        }

        if (
          normalizedName
            .split(" ")
            .includes(word)
        ) {
          score += 50;
        }
      }

      if (score > 0) {
        partialMatches.push({
          team,
          competitionCode,
          score
        });
      }
    }
  }

  /*
   * No exact match was found.
   *
   * Now rank ALL partial matches collected from
   * every domestic competition.
   */
  partialMatches.sort(
    (a, b) => b.score - a.score
  );

  if (partialMatches.length === 0) {
    return [];
  }

  /*
   * Return the strongest candidate only.
   *
   * This prevents ambiguous results such as:
   *
   *   AC Milan
   *   Inter
   *
   * from being handed to the AI resolver and allows
   * the football-data layer itself to make the choice.
   */
  return [partialMatches[0].team];
}

// FIND NEXT FIXTURE FOR A TEAM

// ==========================================

async function getNextTeamFixture(teamId, requestedCompetitionCode = null) {
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

  const SUPPORTED_COMPETITIONS = new Set([
    "PL",   // Premier League
    "PD",   // La Liga
    "BL1",  // Bundesliga
    "SA",   // Serie A
    "FL1",  // Ligue 1
    "DED",  // Eredivisie
    "PPL",  // Primeira Liga
    "CL",   // UEFA Champions League
    "CLI",  // Copa Libertadores
    "BSA",  // Brasileirão
    "ELC",  // Championship
    "WC",   // FIFA World Cup
    "EC"    // European Championship
  ]);

  const now = Date.now();

  const futureMatches = matches
    .filter(match => {
      const kickoff = Date.parse(match.utcDate);
      const competitionCode =
        match.competition?.code || null;

      return (
        Number.isFinite(kickoff) &&
        kickoff > now &&
        SUPPORTED_COMPETITIONS.has(competitionCode) &&
        (
          !requestedCompetitionCode ||
          competitionCode ===
            String(requestedCompetitionCode).trim().toUpperCase()
        )
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

  const halfTimeHomeGoals =
    match.score?.halfTime?.home;

  const halfTimeAwayGoals =
    match.score?.halfTime?.away;

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

      halfTime: {
        home:
          Number.isFinite(Number(halfTimeHomeGoals))
            ? Number(halfTimeHomeGoals)
            : null,

        away:
          Number.isFinite(Number(halfTimeAwayGoals))
            ? Number(halfTimeAwayGoals)
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
