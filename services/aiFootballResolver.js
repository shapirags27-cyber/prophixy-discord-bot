const {
  searchFootballDataTeams,
  getNextTeamFixture
} = require("./footballData");

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractTeamPhrase(subject) {
  const text = String(subject || "").trim();

  const patterns = [
    // "Will Everton win?"
    /will\s+(.+?)\s+(?:win|lose|draw|score|keep|have|get|beat)\b/i,

    // "Everton to win"
    /^(.+?)\s+to\s+(?:win|lose|draw|score|keep|have|get|beat)\b/i,

    // "Everton win their next match"
    /^(.+?)\s+(?:win|lose|draw|score|keep|have|get|beat)\b/i,

    // "Everton in their next match"
    /(.+?)\s+(?:in\s+)?their\s+next\s+(?:game|match|fixture)\b/i,

    // "Everton next game"
    /(.+?)\s+next\s+(?:game|match|fixture)\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match && match[1]) {
      return match[1]
        .replace(/\b(their|his|her|next)\b/gi, "")
        .trim();
    }
  }

  return null;
}

async function resolveAIFootballSubject(subject) {
  const teamPhrase = extractTeamPhrase(subject);

  if (!teamPhrase) {
    return {
      resolved: false,
      reason:
        "Could not identify a football team from the subject."
    };
  }

  console.log(
    `⚽ AI football team detection: "${teamPhrase}"`
  );

  const teams =
    await searchFootballDataTeams(teamPhrase);

  if (!Array.isArray(teams) || teams.length === 0) {
    return {
      resolved: false,
      reason:
        `No Premier League team was found for "${teamPhrase}".`
    };
  }

  const normalizedPhrase =
    normalizeText(teamPhrase);

  const exactMatch =
    teams.find(
      team =>
        normalizeText(team?.name) ===
        normalizedPhrase
    );

  const selected = exactMatch || teams[0];

  if (!selected?.id || !selected?.name) {
    return {
      resolved: false,
      reason:
        `Football-data.org returned an invalid team result for "${teamPhrase}".`
    };
  }

  console.log(
    `⚽ Football-data.org team resolved: ${selected.name} ` +
    `(ID ${selected.id})`
  );

  const fixture =
    await getNextTeamFixture(selected.id);

  if (!fixture) {
    return {
      resolved: false,
      reason:
        `No upcoming fixture was found for ${selected.name}.`
    };
  }

  console.log(
    `⚽ Football-data.org next fixture: ` +
    `${fixture.homeTeam} vs ${fixture.awayTeam} — ` +
    `${fixture.kickoff}`
  );

  return {
    resolved: true,

    team: {
      id: Number(selected.id),
      name: selected.name,
      shortName: selected.shortName || null,
      tla: selected.tla || null,
      country: selected.area?.name || null,
      logo: selected.crest || null
    },

    fixture: {
      fixtureId:
        Number(fixture.externalFixtureId),

      fixtureProvider:
        fixture.externalFixtureProvider ||
        "football-data.org",

      homeTeam:
        fixture.homeTeam || null,

      awayTeam:
        fixture.awayTeam || null,

      kickoff:
        fixture.kickoff || null,

      kickoffTimestamp:
        Number(fixture.kickoffTimestamp) || null,

      competition:
        fixture.competition || null,

      competitionCode:
        fixture.competitionCode || null,

      status:
        fixture.status || null,

      season:
        fixture.season || null
    }
  };
}

module.exports = {
  resolveAIFootballSubject
};
