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
You are the prediction-market assistant for Prophixy.

Prophixy is an Africa-focused prediction market.
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
6. For football, generate useful markets such as:
   - match winner
   - team goals
   - both teams to score
   - total goals
   - first team to score
   Only generate markets that can be objectively resolved from available data.
7. For crypto, use only supplied market/price data.
8. For economy, use only supplied economic data.
9. Do not use probabilities or phrases such as "likely" or "probably".
10. Each market must contain 2 to 5 answer options.
11. Options must be mutually exclusive whenever possible.
12. Return ONLY valid JSON.
13. Do not include markdown code fences.

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
