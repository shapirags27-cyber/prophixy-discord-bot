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

/**
 * Prophixy AI Analysis
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

  const prompt = `
You are Prophixy's football analysis engine.

Analyze the verified football fixture below.

IMPORTANT RULES:
1. Do NOT invent facts.
2. Use only the supplied verified data.
3. If information is missing, explicitly say it is unavailable.
4. This is analysis, not gambling advice.
5. Do not promise a guaranteed outcome.
6. Give probabilities as estimates, not certainties.
7. Explain the reasoning behind every major conclusion.
8. Consider recent form, matchup information, scoring trends and available data.
9. Clearly distinguish verified facts from AI interpretation.

Return ONLY valid JSON in this structure:

{
  "summary": "short overall assessment",
  "confidence": "Low|Medium|High",
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
  "bestOptions": [
    {
      "option": "description",
      "confidence": 0,
      "reason": "reasoning"
    }
  ],
  "keyFactors": [
    "factor 1",
    "factor 2",
    "factor 3"
  ],
  "risks": [
    "risk 1",
    "risk 2"
  ],
  "dataLimitations": [
    "limitation 1"
  ]
}

Probabilities must be numbers from 0 to 100.

Verified football data:
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
    !Array.isArray(parsed.bestOptions)
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
You are Prophixy's cryptocurrency analysis engine.

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
