require("dotenv").config();

const { GoogleGenAI } = require("@google/genai");

function getGemini() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });
}

async function generateFootballAnalysis(ai, prompt) {
  const models = [
    "gemini-3.6-flash",
    "gemini-3.5-flash"
  ];

  let lastError = null;

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(
          `🤖 Football AI generation: model=${model}, attempt=${attempt}`
        );

        return await ai.models.generateContent({
          model,
          contents: prompt
        });
      } catch (error) {
        lastError = error;

        const status =
          error?.status ||
          error?.code ||
          error?.error?.status ||
          error?.error?.code;

        const message = String(error?.message || "").toLowerCase();

        const isTemporary =
          status === 503 ||
          status === 429 ||
          message.includes("503") ||
          message.includes("429") ||
          message.includes("high demand") ||
          message.includes("unavailable");

        if (!isTemporary) {
          throw error;
        }

        console.warn(
          `⚠️ Football AI temporary Gemini error: model=${model}, attempt=${attempt}, status=${status}`
        );

        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
  }

  throw lastError || new Error("Football AI generation failed.");
}

/**
 * PhorvaGuard AI Analysis
 *
 * This service:
 * - DOES NOT create prediction markets.
 * - DOES NOT place bets.
 * - DOES NOT resolve markets.
 * - Only analyzes verified/provided information.
 *
 * It is intentionally reusable across Discord servers.
 */

async function analyzeFootball({
  subject,
  fixture,
  recentMatches = [],
  extraData = {}
}) {
  if (!fixture || !fixture.homeTeam || !fixture.awayTeam) {
    throw new Error("Verified football fixture is required.");
  }

  const ai = getGemini();

  const verifiedData = {
    type: "football",
    subject: subject || null,

    fixture: {
      id: fixture.fixtureId || null,
      provider: fixture.fixtureProvider || "football-data.org",
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      kickoff: fixture.kickoff || null,
      kickoffTimestamp: fixture.kickoffTimestamp || null,
      competition: fixture.competition || null,
      competitionCode: fixture.competitionCode || null,
      status: fixture.status || null
    },

    recentMatches: Array.isArray(recentMatches)
      ? recentMatches
      : [],

    extraData:
      extraData &&
      typeof extraData === "object"
        ? extraData
        : {}
  };

  const deepFootballData =
    verifiedData.extraData?.footballAnalysisData &&
    typeof verifiedData.extraData.footballAnalysisData === "object"
      ? verifiedData.extraData.footballAnalysisData
      : null;

  const prompt = `
You are PhorvaGuard's football analysis engine.

Your job is to produce a DEEP, DATA-DRIVEN analysis of the verified football fixture supplied below.

This is NOT market creation.
This is NOT market resolution.
This is NOT betting advice.

You must analyze the actual football matchup using only verified information supplied by football-data.org and the other verified data included below.

IMPORTANT RULES:

1. NEVER invent facts, statistics, injuries, suspensions, lineups, tactics, player information, xG, possession, shots, or other data.
2. Use ONLY the supplied verified data.
3. If a statistic or category is unavailable, explicitly say it is unavailable.
4. Do not assume that missing data means a team is stronger or weaker.
5. Distinguish VERIFIED FACTS from AI INTERPRETATION.
6. Do not promise or imply a guaranteed result.
7. Probabilities are estimates based only on the supplied evidence.
8. Consider sample size. If only a few matches have been played, explicitly reduce confidence.
9. Historical head-to-head should provide context but must not automatically override current form.
10. Current form should not automatically override a much larger historical sample.
11. Home/away performance must be considered separately when the relevant data exists.
12. League position and team statistics must be compared directly when available.
13. Identify both supporting evidence and conflicting evidence.
14. Do not create statistics from external knowledge.
15. If advanced statistics such as xG, possession, shots, injuries, suspensions, lineups or player availability are not supplied, state that they are unavailable.
16. Do not use gambling language such as "bet", "stake", "wager", "sure win" or "guaranteed".
17. "Analytical scenarios" are possible football outcomes for analysis only, not betting recommendations.
18. Keep the analysis grounded in the actual fixture.

ANALYSIS FRAMEWORK:

A. FIXTURE CONTEXT
- Identify the teams, competition, kickoff and match status.
- Mention venue only if verified.
- Identify whether the fixture is upcoming, live or completed.

B. RECENT FORM
Compare each team's recent results.
Look at:
- wins
- draws
- losses
- points/form sequence
- goals scored
- goals conceded
- average goals scored
- average goals conceded
- clean sheets
- failed-to-score matches
- BTTS frequency
- over/under 2.5 frequency when available

C. HOME VS AWAY FORM
For the home team, prioritize verified home-match statistics.
For the away team, prioritize verified away-match statistics.
Compare:
- wins/draws/losses
- goals for/against
- clean sheets
- failed to score
- scoring consistency
- defensive consistency

D. HEAD-TO-HEAD
Analyze the supplied previous meetings.
Consider:
- number of meetings
- wins for each side
- draws
- goals scored
- average total goals
- BTTS rate
- over/under 2.5 trend
- most recent meetings
- whether the historical pattern is still relevant to the current matchup

Never invent a head-to-head meeting.

E. LEAGUE/TABLE COMPARISON
When standings are available, compare:
- position
- points
- matches played
- wins
- draws
- losses
- goals for
- goals against
- goal difference

Explain what the table suggests, while recognizing early-season sample limitations.

F. ATTACKING COMPARISON
Use only supplied statistics.
Compare:
- scoring rate
- consistency of scoring
- failed-to-score rate
- recent goals
- home/away scoring

G. DEFENSIVE COMPARISON
Compare:
- goals conceded
- clean sheets
- failed-to-score opponents where the data supports it
- home/away defensive performance

H. STATISTICAL ADVANTAGES
Identify which team has the stronger statistical edge in each meaningful category.

I. CONFLICTING SIGNALS
Explicitly identify situations where the evidence points in different directions.
Example:
- one team has better current form
- the other has stronger historical H2H
- one has better home form
- the other has stronger scoring numbers

J. DATA QUALITY AND LIMITATIONS
Explain:
- sample size
- unavailable statistics
- whether advanced metrics are missing
- whether the fixture is early in the season
- any other important limitation

K. OVERALL FOOTBALL ASSESSMENT
Give a balanced conclusion based on the complete evidence.
Do not simply select the team with the better table position.
Explain WHY the evidence points toward a particular match profile.

L. ESTIMATED OUTLOOK
Provide estimated percentages for:
- home win
- draw
- away win
- over 2.5 goals
- under 2.5 goals
- BTTS yes
- BTTS no

These are analytical estimates only.

Return ONLY valid JSON using exactly this structure:

{
  "summary": "Detailed but concise overall assessment.",

  "confidence": "Low|Medium|High",

  "fixtureAnalysis": {
    "context": "Verified fixture context and status."
  },

  "formAnalysis": {
    "homeTeam": "Detailed analysis of the home team's recent form.",
    "awayTeam": "Detailed analysis of the away team's recent form.",
    "comparison": "Direct comparison of current form."
  },

  "homeAwayAnalysis": {
    "homeTeam": "Analysis of the home team's verified home performance.",
    "awayTeam": "Analysis of the away team's verified away performance.",
    "comparison": "Direct home-versus-away comparison."
  },

  "headToHeadAnalysis": {
    "summary": "Analysis of the verified historical meetings.",
    "recentPattern": "What the most recent meetings show.",
    "relevance": "How much weight the H2H evidence should receive in this matchup."
  },

  "leagueComparison": {
    "summary": "Comparison of verified league standings.",
    "homeTeamEdge": "Where the home team has an advantage, if any.",
    "awayTeamEdge": "Where the away team has an advantage, if any."
  },

  "scoringAnalysis": {
    "summary": "Comparison of attacking/scoring trends.",
    "homeTeam": "Home team's scoring profile.",
    "awayTeam": "Away team's scoring profile."
  },

  "defensiveAnalysis": {
    "summary": "Comparison of defensive trends.",
    "homeTeam": "Home team's defensive profile.",
    "awayTeam": "Away team's defensive profile."
  },

  "statisticalAdvantages": [
    "Verified statistical advantage 1",
    "Verified statistical advantage 2",
    "Verified statistical advantage 3"
  ],

  "conflictingSignals": [
    "Important conflicting signal 1",
    "Important conflicting signal 2"
  ],

  "analyticalScenarios": [
    {
      "scenario": "Possible football scenario",
      "confidence": 0,
      "reason": "Evidence-based explanation."
    }
  ],

  "preferredOutcomes": {
    "matchResult": {
      "outcome": "Home Win|Draw|Away Win|No Strong Preference",
      "confidence": 0,
      "reason": "Explain why this is the preferred match-result outcome using the verified evidence."
    },
    "goals": {
      "outcome": "Over 2.5 Goals|Under 2.5 Goals|No Strong Preference",
      "confidence": 0,
      "reason": "Explain why this is the preferred goals outcome using verified scoring trends."
    },
    "bothTeamsToScore": {
      "outcome": "Yes|No|No Strong Preference",
      "confidence": 0,
      "reason": "Explain why this is the preferred BTTS outcome using verified evidence."
    },
    "correctScore": {
      "outcome": "0-0|1-0|0-1|1-1|2-0|0-2|2-1|1-2|2-2|3-0|0-3|3-1|1-3|3-2|2-3|3-3|4-0|0-4|4-1|1-4|4-2|2-4|4-3|3-4|4-4|No Strong Preference",
      "confidence": 0,
      "reason": "Explain why this exact scoreline is the preferred analytical scenario."
    },
    "alternatives": [
      {
        "category": "Match Result|Goals|BTTS|Correct Score",
        "outcome": "Alternative analytical outcome",
        "confidence": 0,
        "reason": "Evidence-based explanation."
      }
    ]
  },

  "matchOutlook": {
    "homeWin": 0,
    "draw": 0,
    "awayWin": 0
  },

  "goalsOutlook": {
    "over25": 0,
    "under25": 0
  },

  "bothTeamsToScore": {
    "yes": 0,
    "no": 0
  },

  "keyFactors": [
    "Key verified factor 1",
    "Key verified factor 2",
    "Key verified factor 3"
  ],

  "risks": [
    "Important uncertainty or risk 1",
    "Important uncertainty or risk 2"
  ],

  "dataLimitations": [
    "Important data limitation 1"
  ]
}

PROBABILITY RULES:

- All probability values must be numbers from 0 to 100.
- homeWin + draw + awayWin MUST equal 100.
- over25 + under25 MUST equal 100.
- BTTS yes + no MUST equal 100.
- Do not use false precision to imply certainty.
- Keep confidence appropriate to the amount and quality of verified data.
- Preferred outcome confidence must also be from 0 to 100.
- A preferred outcome is an analytical preference, NOT a guaranteed result.
- Do not choose an outcome merely because it has the highest raw percentage.
- Compare form, home/away performance, H2H, league position, scoring, defensive records and sample size before selecting a preferred outcome.
- The preferred match result MUST be one of Home Win, Draw, Away Win, or No Strong Preference.
- The preferred goals outcome MUST be Over 2.5 Goals, Under 2.5 Goals, or No Strong Preference.
- The preferred BTTS outcome MUST be Yes, No, or No Strong Preference.
- The preferred correct score MUST be a realistic exact scoreline supported by the available evidence, or No Strong Preference.
- Correct-score confidence must reflect the uncertainty of predicting an exact score and should normally be lower than confidence in broader outcome categories.
- Never invent player information, injuries, xG, possession, shots, lineups, tactics or other statistics that are not present in the verified data.
- If the evidence is too weak or contradictory, use No Strong Preference instead of manufacturing certainty.

QUALITY RULE:

A good analysis must NOT merely repeat the raw statistics.

It must explain what those statistics mean when comparing these two teams.

For example:
- If one team has a better recent record but the sample is only two matches, explicitly say the evidence is promising but weak.
- If one team has historically dominated H2H but the current-season form differs, explain the conflict.
- If the home team has strong home defensive numbers and the away team has poor away scoring numbers, explain how those two facts interact.
- If the evidence is insufficient, say so rather than inventing certainty.

Verified football data:
${JSON.stringify(verifiedData, null, 2)}
`;

  const response = await generateFootballAnalysis(ai, prompt);

  const text =
    response?.text ||
    response?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("");

  if (!text) {
    throw new Error("Gemini returned an empty football analysis.");
  }

  let parsed;

  try {
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    parsed = JSON.parse(cleaned);
  } catch (error) {
    console.error("❌ Football AI JSON parse error:", text);
    throw new Error("Gemini returned invalid football analysis JSON.");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !parsed.summary ||
    !parsed.formAnalysis ||
    !parsed.homeAwayAnalysis ||
    !parsed.headToHeadAnalysis ||
    !parsed.leagueComparison ||
    !parsed.scoringAnalysis ||
    !parsed.defensiveAnalysis ||
    !Array.isArray(parsed.analyticalScenarios) ||
    !parsed.preferredOutcomes ||
    !parsed.preferredOutcomes.matchResult ||
    !parsed.preferredOutcomes.goals ||
    !parsed.preferredOutcomes.bothTeamsToScore ||
    !parsed.preferredOutcomes.correctScore ||
    !Array.isArray(parsed.preferredOutcomes.alternatives)
  ) {
    throw new Error(
      "Gemini returned an incomplete football analysis."
    );
  }

  return parsed;
}

async function analyzeCrypto({
  subject,
  coin,
  marketData = {},
  extraData = {}
}) {
  if (!coin && !subject) {
    throw new Error("A cryptocurrency or coin is required.");
  }

  const ai = getGemini();

  const verifiedData = {
    type: "crypto",
    subject: subject || null,
    coin: coin || null,
    marketData:
      marketData &&
      typeof marketData === "object"
        ? marketData
        : {},
    extraData:
      extraData &&
      typeof extraData === "object"
        ? extraData
        : {}
  };

  const prompt = `
You are PhorvaGuard's cryptocurrency analysis engine.

Analyze the supplied cryptocurrency information.

IMPORTANT:
1. Do not invent prices, volume, market cap, news or technical indicators.
2. Use only supplied data.
3. Clearly identify missing information.
4. This is educational market analysis, not financial advice.
5. Never claim certainty or guaranteed profit.
6. Identify possible bullish, bearish and neutral scenarios.
7. If enough information exists, identify possible entry zones, invalidation levels and profit-taking zones.
8. Do not manufacture exact levels when the required data is unavailable.
9. Explain the reasoning.

Return ONLY valid JSON:

{
  "summary": "short overall assessment in simple language",
  "bias": "Bullish|Bearish|Neutral",
  "confidence": "Low|Medium|High",

  "marketStructure": {
    "trend": "Bullish|Bearish|Sideways|Unknown",
    "momentum": "Strong|Moderate|Weak|Unknown"
  },

  "plainEnglish": {
    "whatIsHappening": "Explain what the market is doing in simple language.",
    "whatItMeans": "Explain what the technical data means for the user.",
    "aiTakeaway": "One clear practical takeaway."
  },

  "entryStrategy": {
    "status": "Enter|Wait|Possible|Insufficient Data",
    "preferredZone": "price zone or unavailable",
    "confirmation": "specific condition that should confirm the setup",
    "alternativeEntry": "alternative breakout or pullback entry if supported",
    "why": "simple explanation of why this entry makes sense"
  },

  "riskManagement": {
    "invalidation": "price level or condition that invalidates the setup",
    "riskLevel": "Low|Moderate|High|Unknown",
    "riskNotes": [
      "risk 1",
      "risk 2"
    ]
  },

  "profitTaking": [
    {
      "target": "price or zone",
      "reason": "why this target matters"
    }
  ],

  "scenarios": [
    {
      "scenario": "Bullish|Bearish|Neutral",
      "probability": 0,
      "reason": "simple explanation"
    }
  ],

  "keyFactors": [
    "factor 1",
    "factor 2",
    "factor 3"
  ],

  "dataLimitations": [
    "limitation 1"
  ]
}

Probabilities must be numbers from 0 to 100.

Supplied cryptocurrency data:
${JSON.stringify(verifiedData, null, 2)}
`;

  const response = await ai.models.generateContent({
    model: "gemini-3.6-flash",
    contents: prompt
  });

  const text =
    response?.text ||
    response?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("");

  if (!text) {
    throw new Error("Gemini returned an empty crypto analysis.");
  }

  let parsed;

  try {
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    parsed = JSON.parse(cleaned);
  } catch (error) {
    console.error("❌ Crypto AI JSON parse error:", text);
    throw new Error("Gemini returned invalid crypto analysis JSON.");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !parsed.summary ||
    !parsed.bias
  ) {
    throw new Error(
      "Gemini returned an incomplete crypto analysis."
    );
  }

  return parsed;
}

module.exports = {
  analyzeFootball,
  analyzeCrypto
};
