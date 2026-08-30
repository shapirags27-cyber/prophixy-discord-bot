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

const COMPETITION_ALIASES = [
  {
    code: "PL",
    patterns: [
      /\bpremier\s+league\b/i
    ]
  },
  {
    code: "PD",
    patterns: [
      /\bla\s+liga\b/i,
      /\bprimera\s+division\b/i
    ]
  },
  {
    code: "BL1",
    patterns: [
      /\bbundesliga\b/i
    ]
  },
  {
    code: "SA",
    patterns: [
      /\bserie\s+a\b/i
    ]
  },
  {
    code: "FL1",
    patterns: [
      /\bligue\s*1\b/i
    ]
  },
  {
    code: "DED",
    patterns: [
      /\beredivisie\b/i,
      /\bere\s*divisie\b/i
    ]
  },
  {
    code: "PPL",
    patterns: [
      /\bprimeira\s+liga\b/i
    ]
  },
  {
    code: "CL",
    patterns: [
      /\bchampions\s+league\b/i,
      /\buefa\s+champions\s+league\b/i
    ]
  },
  {
    code: "CLI",
    patterns: [
      /\bcopa\s+libertadores\b/i,
      /\blibertadores\b/i
    ]
  },
  {
    code: "BSA",
    patterns: [
      /\bbrasileir[aã]o\b/i,
      /\bbrazilian\s+serie\s+a\b/i,
      /\bbrasileiro\s+serie\s+a\b/i
    ]
  },
  {
    code: "ELC",
    patterns: [
      /\bchampionship\b/i,
      /\benglish\s+championship\b/i
    ]
  },
  {
    code: "WC",
    patterns: [
      /\bworld\s+cup\b/i,
      /\bfifa\s+world\s+cup\b/i
    ]
  },
  {
    code: "EC",
    patterns: [
      /\beuropean\s+championship\b/i,
      /\beuro\s+championship\b/i,
      /\beuros\b/i
    ]
  }
];

function extractCompetitionCode(subject) {
  const text = String(subject || "");

  for (const competition of COMPETITION_ALIASES) {
    for (const pattern of competition.patterns) {
      if (pattern.test(text)) {
        return competition.code;
      }
    }
  }

  return null;
}

function removeCompetitionFromPhrase(phrase) {
  let result = String(phrase || "");

  for (const competition of COMPETITION_ALIASES) {
    for (const pattern of competition.patterns) {
      result = result.replace(pattern, " ");
    }
  }

  return result
    .replace(/\b(?:in|for|the|their|his|her|next)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTeamPhrase(subject) {
  const originalText = String(subject || "").trim();

  if (!originalText || originalText.length > 80) {
    return null;
  }

  // Remove competition wording first.
  // Example:
  // "Arsenal next Champions League match"
  // -> "Arsenal next match"
  let text = removeCompetitionFromPhrase(originalText)
    .replace(/\s+/g, " ")
    .trim();

  // Remove common fixture wording that is not part of the team name.
  text = text
    .replace(/\b(?:next|their|his|her)\b/gi, " ")
    .replace(/\b(?:game|match|fixture)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Remove common market-intent wording.
  text = text
    .replace(/\b(?:will)\b/gi, " ")
    .replace(/\b(?:to)\s+(?:win|lose|draw|score|keep|have|get|beat)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Examples now become:
  //
  // "Arsenal next match"
  // -> "Arsenal"
  //
  // "Arsenal next Premier League match"
  // -> "Arsenal"
  //
  // "Real Madrid next Champions League match"
  // -> "Real Madrid"
  //
  // "Flamengo next Copa Libertadores match"
  // -> "Flamengo"

  if (!text) {
    return null;
  }

  return text;
}

async function resolveAIFootballSubject(subject) {
  const competitionCode = extractCompetitionCode(subject);
  const teamPhrase = extractTeamPhrase(subject);

  if (!teamPhrase) {
    return {
      resolved: false,
      reason:
        "Could not identify a football team from the subject."
    };
  }

  console.log(
    `⚽ AI football team detection: "${teamPhrase}"` +
    (competitionCode
      ? ` | competition: ${competitionCode}`
      : " | competition: ANY SUPPORTED")
  );

    // Football-data.org uses TLA FCB for FC Barcelona.
    // Use FCB to avoid matching RCD Espanyol de Barcelona.
    const footballSearchPhrase =
      normalizeText(teamPhrase) === "barcelona"
        ? "FCB"
        : teamPhrase;

  const teams = await searchFootballDataTeams(
    footballSearchPhrase,
    competitionCode
  );

  if (!Array.isArray(teams) || teams.length === 0) {
    return {
      resolved: false,
      reason:
        `No football team was found for "${teamPhrase}".`
    };
  }

    const normalizedPhrase = normalizeText(teamPhrase);

    /*
     * Football naming alias:
     * "Inter Milan" refers to Inter / FC Internazionale Milano.
     *
     * football-data.org exposes:
     *   name: FC Internazionale Milano
     *   shortName: Inter
     */
    const interMilanMatch =
      normalizedPhrase === "inter milan"
        ? teams.find(
            team =>
              normalizeText(team?.shortName) === "inter" ||
              normalizeText(team?.name).includes("internazionale")
          )
        : null;

    const exactMatch = teams.find(
      team =>
        normalizeText(team?.name) === normalizedPhrase ||
        normalizeText(team?.shortName) === normalizedPhrase ||
        normalizeText(team?.tla) === normalizedPhrase
    );

    /*
     * If there is no exact match, rank candidates.
     *
     * Example:
     * "Inter Milan"
     *   -> FC Internazionale Milano / Inter
     *   -> AC Milan / Milan
     *
     * The candidate matching more words from the user's
     * phrase should win.
     */
    const rankedTeams = teams
      .map(team => {
        const name = normalizeText(team?.name);
        const shortName = normalizeText(team?.shortName);
        const tla = normalizeText(team?.tla);

        const phraseWords = normalizedPhrase.split(" ");
        let score = 0;

        /*
         * Exact short-name word is a very strong signal.
         *
         * "Inter Milan" -> shortName "Inter"
         * should beat "Milan" -> shortName "Milan".
         */
        for (const word of phraseWords) {
          if (!word) continue;

          if (shortName === word) {
            score += 1000;
          }

          if (tla === word) {
            score += 900;
          }

          if (shortName.split(" ").includes(word)) {
            score += 200;
          }

          if (name.split(" ").includes(word)) {
            score += 20;
          }
        }

        /*
         * Full phrase matches remain strongest when available.
         */
        if (name === normalizedPhrase) {
          score += 800;
        }

        if (shortName === normalizedPhrase) {
          score += 1000;
        }

        if (tla === normalizedPhrase) {
          score += 900;
        }

        if (name.includes(normalizedPhrase)) {
          score += 300;
        }

        if (shortName.includes(normalizedPhrase)) {
          score += 400;
        }

        return {
          team,
          score
        };
      })
      .sort((a, b) => b.score - a.score);

      const selected =
        interMilanMatch ||
        exactMatch ||
        rankedTeams[0]?.team ||
        teams[0];

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

  const fixture = await getNextTeamFixture(
    selected.id,
    competitionCode
  );

  if (!fixture) {
    const competitionMessage = competitionCode
      ? ` in competition ${competitionCode}`
      : " across the supported competitions";

    return {
      resolved: false,
      reason:
        `No upcoming fixture was found for ${selected.name}${competitionMessage}.`
    };
  }

  console.log(
    `⚽ Football-data.org next fixture: ` +
    `${fixture.homeTeam} vs ${fixture.awayTeam} — ` +
    `${fixture.kickoff} | ${fixture.competitionCode}`
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
