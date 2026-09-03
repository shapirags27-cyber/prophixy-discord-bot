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


// ==========================================
// FOOTBALL AI ANALYSIS DATA
// ==========================================

const footballAnalysisCache = new Map();

const FOOTBALL_ANALYSIS_CACHE_TTL =
  5 * 60 * 1000;

function analysisCacheGet(key) {
  const cached = footballAnalysisCache.get(key);

  if (!cached) {
    return null;
  }

  if (
    Date.now() - cached.createdAt >
    FOOTBALL_ANALYSIS_CACHE_TTL
  ) {
    footballAnalysisCache.delete(key);
    return null;
  }

  return cached.data;
}

function analysisCacheSet(key, data) {
  footballAnalysisCache.set(key, {
    createdAt: Date.now(),
    data
  });
}

function toNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function getMatchTeamGoals(match, teamId) {
  const homeId = Number(match.homeTeam?.id);
  const awayId = Number(match.awayTeam?.id);

  const homeGoals =
    toNumber(match.score?.fullTime?.home);

  const awayGoals =
    toNumber(match.score?.fullTime?.away);

  if (
    Number(teamId) === homeId
  ) {
    return {
      scored: homeGoals,
      conceded: awayGoals
    };
  }

  if (
    Number(teamId) === awayId
  ) {
    return {
      scored: awayGoals,
      conceded: homeGoals
    };
  }

  return {
    scored: null,
    conceded: null
  };
}

function calculateTeamStatistics(
  matches,
  teamId
) {
  const stats = {
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    cleanSheets: 0,
    failedToScore: 0,
    bothTeamsToScore: 0,
    over25: 0,
    under25: 0,
    form: [],
    matches: []
  };

  for (const match of matches || []) {
    const status =
      String(match.status || "").toUpperCase();

    if (status !== "FINISHED") {
      continue;
    }

    const goals =
      getMatchTeamGoals(match, teamId);

    if (
      goals.scored === null ||
      goals.conceded === null
    ) {
      continue;
    }

    stats.played += 1;
    stats.goalsFor += goals.scored;
    stats.goalsAgainst += goals.conceded;

    if (goals.conceded === 0) {
      stats.cleanSheets += 1;
    }

    if (goals.scored === 0) {
      stats.failedToScore += 1;
    }

    if (
      goals.scored > 0 &&
      goals.conceded > 0
    ) {
      stats.bothTeamsToScore += 1;
    }

    if (
      goals.scored + goals.conceded > 2.5
    ) {
      stats.over25 += 1;
    } else {
      stats.under25 += 1;
    }

    let result = "D";

    if (goals.scored > goals.conceded) {
      result = "W";
      stats.wins += 1;
    } else if (
      goals.scored < goals.conceded
    ) {
      result = "L";
      stats.losses += 1;
    } else {
      stats.draws += 1;
    }

    stats.form.push(result);

    const isHome =
      Number(match.homeTeam?.id) ===
      Number(teamId);

    const opponent =
      isHome
        ? match.awayTeam
        : match.homeTeam;

    stats.matches.push({
      id: Number(match.id),
      date: match.utcDate || null,
      competition:
        match.competition?.name || null,
      competitionCode:
        match.competition?.code || null,
      opponent: opponent?.name || null,
      opponentId:
        opponent?.id
          ? Number(opponent.id)
          : null,
      venue:
        isHome
          ? "HOME"
          : "AWAY",
      result,
      goalsFor: goals.scored,
      goalsAgainst: goals.conceded,
      halfTime: {
        scored:
          isHome
            ? toNumber(
                match.score?.halfTime?.home
              )
            : toNumber(
                match.score?.halfTime?.away
              ),
        conceded:
          isHome
            ? toNumber(
                match.score?.halfTime?.away
              )
            : toNumber(
                match.score?.halfTime?.home
              )
      }
    });
  }

  stats.form = stats.form.slice(-10);

  stats.averageGoalsFor =
    stats.played > 0
      ? Number(
          (
            stats.goalsFor /
            stats.played
          ).toFixed(2)
        )
      : null;

  stats.averageGoalsAgainst =
    stats.played > 0
      ? Number(
          (
            stats.goalsAgainst /
            stats.played
          ).toFixed(2)
        )
      : null;

  stats.cleanSheetRate =
    stats.played > 0
      ? Number(
          (
            (stats.cleanSheets /
              stats.played) *
            100
          ).toFixed(1)
        )
      : null;

  stats.failedToScoreRate =
    stats.played > 0
      ? Number(
          (
            (stats.failedToScore /
              stats.played) *
            100
          ).toFixed(1)
        )
      : null;

  stats.bttsRate =
    stats.played > 0
      ? Number(
          (
            (stats.bothTeamsToScore /
              stats.played) *
            100
          ).toFixed(1)
        )
      : null;

  stats.over25Rate =
    stats.played > 0
      ? Number(
          (
            (stats.over25 /
              stats.played) *
            100
          ).toFixed(1)
        )
      : null;

  return stats;
}

function getRecentMatches(
  matches,
  teamId,
  limit = 10
) {
  return (matches || [])
    .filter(match =>
      String(match.status || "").toUpperCase() ===
      "FINISHED"
    )
    .sort(
      (a, b) =>
        Date.parse(a.utcDate || 0) -
        Date.parse(b.utcDate || 0)
    )
    .slice(-limit);
}

function findStandingForTeam(
  standings,
  teamId
) {
  for (const standing of standings || []) {
    const row =
      (standing.table || []).find(
        item =>
          Number(item.team?.id) ===
          Number(teamId)
      );

    if (row) {
      return {
        position:
          toNumber(row.position),
        played:
          toNumber(row.playedGames),
        wins:
          toNumber(row.won),
        draws:
          toNumber(row.draw),
        losses:
          toNumber(row.lost),
        points:
          toNumber(row.points),
        goalsFor:
          toNumber(row.goalsFor),
        goalsAgainst:
          toNumber(row.goalsAgainst),
        goalDifference:
          toNumber(row.goalDifference)
      };
    }
  }

  return null;
}

function calculateHeadToHead(
  headToHeadMatches,
  homeTeamId,
  awayTeamId
) {
  const result = {
    available: false,
    totalMeetings: 0,
    homeWins: 0,
    draws: 0,
    awayWins: 0,
    homeGoals: 0,
    awayGoals: 0,
    btts: 0,
    over25: 0,
    meetings: []
  };

  for (const match of headToHeadMatches || []) {
    const homeId =
      Number(match.homeTeam?.id);

    const awayId =
      Number(match.awayTeam?.id);

    const isRelevant =
      (
        homeId === Number(homeTeamId) &&
        awayId === Number(awayTeamId)
      ) ||
      (
        homeId === Number(awayTeamId) &&
        awayId === Number(homeTeamId)
      );

    if (!isRelevant) {
      continue;
    }

    const homeGoals =
      toNumber(match.score?.fullTime?.home);

    const awayGoals =
      toNumber(match.score?.fullTime?.away);

    if (
      homeGoals === null ||
      awayGoals === null
    ) {
      continue;
    }

    result.available = true;
    result.totalMeetings += 1;

    if (homeId === Number(homeTeamId)) {
      result.homeGoals += homeGoals;
      result.awayGoals += awayGoals;

      if (homeGoals > awayGoals) {
        result.homeWins += 1;
      } else if (
        homeGoals < awayGoals
      ) {
        result.awayWins += 1;
      } else {
        result.draws += 1;
      }
    } else {
      result.homeGoals += awayGoals;
      result.awayGoals += homeGoals;

      if (awayGoals > homeGoals) {
        result.homeWins += 1;
      } else if (
        awayGoals < homeGoals
      ) {
        result.awayWins += 1;
      } else {
        result.draws += 1;
      }
    }

    if (
      homeGoals > 0 &&
      awayGoals > 0
    ) {
      result.btts += 1;
    }

    if (
      homeGoals + awayGoals > 2.5
    ) {
      result.over25 += 1;
    }

    result.meetings.push({
      id: Number(match.id),
      date: match.utcDate || null,
      competition:
        match.competition?.name || null,
      homeTeam:
        match.homeTeam?.name || null,
      awayTeam:
        match.awayTeam?.name || null,
      homeGoals,
      awayGoals,
      winner:
        homeGoals > awayGoals
          ? "home"
          : awayGoals > homeGoals
            ? "away"
            : "draw"
    });
  }

  result.meetings.sort(
    (a, b) =>
      Date.parse(b.date || 0) -
      Date.parse(a.date || 0)
  );

  result.meetings =
    result.meetings.slice(0, 10);

  if (result.totalMeetings > 0) {
    result.bttsRate = Number(
      (
        (result.btts /
          result.totalMeetings) *
        100
      ).toFixed(1)
    );

    result.over25Rate = Number(
      (
        (result.over25 /
          result.totalMeetings) *
        100
      ).toFixed(1)
    );

    result.averageTotalGoals = Number(
      (
        (
          result.homeGoals +
          result.awayGoals
        ) /
        result.totalMeetings
      ).toFixed(2)
    );
  } else {
    result.bttsRate = null;
    result.over25Rate = null;
    result.averageTotalGoals = null;
  }

  return result;
}

async function getFootballMatchAnalysisData(
  matchId
) {
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

  const cacheKey =
    `football-analysis:${numericMatchId}`;

  const cached =
    analysisCacheGet(cacheKey);

  if (cached) {
    return cached;
  }

  const client = getClient();

  /*
   * First retrieve the verified fixture.
   */
  const matchResponse = await client.get(
    `/matches/${numericMatchId}`
  );

  const match = matchResponse.data;

  if (!match) {
    throw new Error(
      "Football-data match was not found."
    );
  }

  const homeTeamId =
    Number(match.homeTeam?.id);

  const awayTeamId =
    Number(match.awayTeam?.id);

  if (
    !Number.isInteger(homeTeamId) ||
    !Number.isInteger(awayTeamId)
  ) {
    throw new Error(
      "Football match is missing team IDs."
    );
  }

  const competitionCode =
    match.competition?.code || null;

  const seasonStart =
    match.season?.startDate || null;

  const season =
    seasonStart
      ? Number(
          String(seasonStart).slice(0, 4)
        )
      : null;

  /*
   * Team histories.
   *
   * We request the current season only so
   * the analysis reflects the current campaign
   * and avoids unnecessarily large responses.
   */
  const homeHistoryResponse =
    await client.get(
      `/teams/${homeTeamId}/matches`,
      {
        params: {
          status: "FINISHED",
          season,
          limit: 100
        }
      }
    );

  const awayHistoryResponse =
    await client.get(
      `/teams/${awayTeamId}/matches`,
      {
        params: {
          status: "FINISHED",
          season,
          limit: 100
        }
      }
    );

  /*
   * Head-to-head is a dedicated football-data.org
   * subresource of a match.
   */
  let headToHeadMatches = [];

  try {
    const h2hResponse =
      await client.get(
        `/matches/${numericMatchId}/head2head`,
        {
          params: {
            limit: 10
          }
        }
      );

    headToHeadMatches =
      Array.isArray(
        h2hResponse.data?.matches
      )
        ? h2hResponse.data.matches
        : [];
  } catch (error) {
    console.warn(
      "⚠️ Football H2H unavailable: " +
      `${error.response?.status || error.message}`
    );
  }

  /*
   * League standings.
   *
   * Some competitions such as cups do not
   * expose standings. Treat that as unavailable
   * rather than failing the entire analysis.
   */
  let standings = [];

  if (competitionCode) {
    try {
      const standingsResponse =
        await client.get(
          `/competitions/${competitionCode}/standings`,
          {
            params: {
              season
            }
          }
        );

      standings =
        Array.isArray(
          standingsResponse.data?.standings
        )
          ? standingsResponse.data.standings
          : [];
    } catch (error) {
      console.warn(
        "⚠️ Football standings unavailable: " +
        `${error.response?.status || error.message}`
      );
    }
  }

  const homeMatches =
    Array.isArray(
      homeHistoryResponse.data?.matches
    )
      ? homeHistoryResponse.data.matches
      : [];

  const awayMatches =
    Array.isArray(
      awayHistoryResponse.data?.matches
    )
      ? awayHistoryResponse.data.matches
      : [];

  const homeRecent =
    getRecentMatches(
      homeMatches,
      homeTeamId,
      10
    );

  const awayRecent =
    getRecentMatches(
      awayMatches,
      awayTeamId,
      10
    );

  const homeOnly =
    homeMatches.filter(
      item =>
        Number(item.homeTeam?.id) ===
        homeTeamId
    );

  const awayOnly =
    awayMatches.filter(
      item =>
        Number(item.awayTeam?.id) ===
        awayTeamId
    );

  const homeFormMatches =
    getRecentMatches(
      homeOnly,
      homeTeamId,
      10
    );

  const awayFormMatches =
    getRecentMatches(
      awayOnly,
      awayTeamId,
      10
    );

  const homeStatistics =
    calculateTeamStatistics(
      homeRecent,
      homeTeamId
    );

  const awayStatistics =
    calculateTeamStatistics(
      awayRecent,
      awayTeamId
    );

  const homeFormStatistics =
    calculateTeamStatistics(
      homeFormMatches,
      homeTeamId
    );

  const awayFormStatistics =
    calculateTeamStatistics(
      awayFormMatches,
      awayTeamId
    );

  const homeStanding =
    findStandingForTeam(
      standings,
      homeTeamId
    );

  const awayStanding =
    findStandingForTeam(
      standings,
      awayTeamId
    );

  const headToHead =
    calculateHeadToHead(
      headToHeadMatches,
      homeTeamId,
      awayTeamId
    );

  const result = {
    dataSource: "football-data.org",

    generatedAt:
      new Date().toISOString(),

    fixture: {
      id: numericMatchId,
      date: match.utcDate || null,
      status: match.status || null,
      venue: match.venue || null,
      matchday:
        toNumber(match.matchday),
      stage: match.stage || null,

      competition: {
        id:
          toNumber(match.competition?.id),
        name:
          match.competition?.name || null,
        code:
          competitionCode
      },

      season: {
        id:
          toNumber(match.season?.id),
        startDate:
          match.season?.startDate || null,
        endDate:
          match.season?.endDate || null,
        currentMatchday:
          toNumber(
            match.season?.currentMatchday
          )
      },

      homeTeam: {
        id: homeTeamId,
        name:
          match.homeTeam?.name || null,
        shortName:
          match.homeTeam?.shortName || null,
        tla:
          match.homeTeam?.tla || null
      },

      awayTeam: {
        id: awayTeamId,
        name:
          match.awayTeam?.name || null,
        shortName:
          match.awayTeam?.shortName || null,
        tla:
          match.awayTeam?.tla || null
      }
    },

    homeTeam: {
      name:
        match.homeTeam?.name || null,
      recentForm:
        homeStatistics,
      homeForm:
        homeFormStatistics,
      leagueStanding:
        homeStanding
    },

    awayTeam: {
      name:
        match.awayTeam?.name || null,
      recentForm:
        awayStatistics,
      awayForm:
        awayFormStatistics,
      leagueStanding:
        awayStanding
    },

    headToHead,

    currentSeason: {
      season,
      competitionCode,
      homeMatchesPlayed:
        homeStatistics.played,
      awayMatchesPlayed:
        awayStatistics.played
    }
  };

  analysisCacheSet(
    cacheKey,
    result
  );

  return result;
}

module.exports = {
  getTeam,
  searchFootballDataTeams,
  getNextTeamFixture,
  getMatch,
  getMatchResult,
  getFootballMatchAnalysisData
};
