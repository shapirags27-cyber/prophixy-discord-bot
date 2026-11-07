const { GoogleGenAI } = require("@google/genai");

function getGemini() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing from .env");
  }

  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });
}

async function generateMarkets({
  category,
  subject,
  data = {}
}) {
  const ai = getGemini();

  const prompt = `
You are the prediction-market assistant for PhorvaGuard.

PhorvaGuard is an Africa-focused prediction market.
Its beta currency is PHX.

Generate high-quality prediction markets from the supplied real-world information.

CATEGORY:
${category}

SUBJECT:
${subject}

REAL-WORLD DATA:
${JSON.stringify(data, null, 2)}

RULES:

1. Generate exactly 5 distinct prediction markets.
2. Every question must have an objectively verifiable outcome.
3. Never invent facts, statistics, prices, teams, dates, events, or results.
4. Never create betting odds or gambling language.
5. Questions must be clear and easy for users to understand.
    6. For football, generate ONLY markets that the football resolver can currently settle:
       - MATCH: match winner
       - MATCH: both teams to score
       - MATCH: total goals over/under 2.5
       - HALF: half-time winner
       - HALF: half-time draw
       - HALF: first-half total goals over/under 0.5, 1.5, or 2.5
       - TEAMS: exact home-team goals
       - TEAMS: exact away-team goals
       - TEAMS: home-team 2+ or 3+ goals
       - TEAMS: away-team 2+ or 3+ goals
       Only generate markets that can be objectively resolved from available data.
    7. For football, use ONLY the verified fixture and score fields supplied in REAL-WORLD DATA.
       Currently supported football fields are:
       - fixture teams
       - full-time goals
       - half-time goals
       - match winner
       - competition
       - kickoff
       Do NOT generate first-team-to-score, corners, player statistics, player goals, assists,
       bookings, yellow cards, red cards, shots, shots on target, possession, or any other
       statistic that the current football resolver cannot settle.
    8. For football, make the 5 generated markets diverse. Prefer a mixture of MATCH, HALF,
       and TEAMS markets instead of generating five markets of the same type.
    9. HALF markets must be objectively resolvable from supplied halfTime home and away goals.
    10. TEAM markets must identify the actual home or away team by name whenever possible.
11. For crypto, use only supplied market/price data.
12. For economy, use only supplied economic data.
13. Do not use probabilities or phrases such as "likely" or "probably".
14. Each market must contain 2 to 5 answer options.
15. Options must be mutually exclusive whenever possible.
16. Return ONLY valid JSON.
17. Do not include markdown code fences.

Return exactly:

{
  "markets": [
    {
      "question": "string",
      "options": ["string", "string"],
      "category": "string",
      "resolutionType": "string",
      "resolutionSource": "string"
    }
  ]
}
`;

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: prompt,
    config: {
      temperature: 0.3,
      responseMimeType: "application/json"
    }
  });

  const text =
    response.text?.trim();

  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      "Gemini returned invalid JSON: " +
      text.slice(0, 500)
    );
  }

  if (!Array.isArray(parsed.markets)) {
    throw new Error(
      "Gemini response does not contain a markets array."
    );
  }

  return parsed.markets;
}

module.exports = {
  generateMarkets
};
