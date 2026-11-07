require("dotenv").config();

const axios = require("axios");

const client = axios.create({
  baseURL: "https://api.coingecko.com/api/v3",
  timeout: 15000,
  headers: {
    Accept: "application/json"
  }
});

const CACHE_TTL_MS = 60 * 1000;
const marketCache = new Map();

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function cleanCoinQuery(value) {
  return String(value || "")
    .trim()
    .replace(/^\$/, "")
    .replace(/\s+/g, " ");
}

function formatNumber(value) {
  return Number.isFinite(Number(value))
    ? Number(value)
    : null;
}


/**
 * Calculate a simple moving average.
 */
function calculateSMA(values, period) {
  if (!Array.isArray(values) || values.length < period) {
    return null;
  }

  const slice = values.slice(-period);
  const sum = slice.reduce((total, value) => total + Number(value), 0);

  return Number.isFinite(sum)
    ? sum / period
    : null;
}

/**
 * Calculate an exponential moving average.
 */
function calculateEMA(values, period) {
  if (!Array.isArray(values) || values.length < period) {
    return null;
  }

  const numericValues = values
    .map(Number)
    .filter(Number.isFinite);

  if (numericValues.length < period) {
    return null;
  }

  const multiplier = 2 / (period + 1);

  let ema = numericValues
    .slice(0, period)
    .reduce((sum, value) => sum + value, 0) / period;

  for (let i = period; i < numericValues.length; i++) {
    ema =
      (numericValues[i] - ema) * multiplier +
      ema;
  }

  return ema;
}

/**
 * Calculate RSI using the standard Wilder-style smoothing.
 */
function calculateRSI(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) {
    return null;
  }

  const prices = values
    .map(Number)
    .filter(Number.isFinite);

  if (prices.length <= period) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];

    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;

  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];

    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    averageGain =
      ((averageGain * (period - 1)) + gain) / period;

    averageLoss =
      ((averageLoss * (period - 1)) + loss) / period;
  }

  if (averageLoss === 0) {
    return 100;
  }

  const relativeStrength = averageGain / averageLoss;

  return 100 - (100 / (1 + relativeStrength));
}

/**
 * Calculate standard-deviation volatility from percentage returns.
 */
function calculateVolatilityPercent(values) {
  if (!Array.isArray(values) || values.length < 3) {
    return null;
  }

  const prices = values
    .map(Number)
    .filter(Number.isFinite);

  if (prices.length < 3) {
    return null;
  }

  const returns = [];

  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] <= 0) {
      continue;
    }

    returns.push(
      ((prices[i] - prices[i - 1]) / prices[i - 1]) * 100
    );
  }

  if (returns.length < 2) {
    return null;
  }

  const mean =
    returns.reduce((sum, value) => sum + value, 0) /
    returns.length;

  const variance =
    returns.reduce(
      (sum, value) => sum + Math.pow(value - mean, 2),
      0
    ) / returns.length;

  return Math.sqrt(variance);
}

/**
 * Find recent support and resistance from OHLC candles.
 *
 * These are analytical zones, not guaranteed price levels.
 */
function calculateSupportResistance(candles) {
  if (!Array.isArray(candles) || !candles.length) {
    return {
      support: [],
      resistance: []
    };
  }

  const recent = candles.slice(-30);

  const lows = recent
    .map(candle => Number(candle.low))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const highs = recent
    .map(candle => Number(candle.high))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const support = [];
  const resistance = [];

  if (lows.length) {
    support.push(lows[0]);

    if (lows.length >= 10) {
      support.push(
        lows[Math.floor(lows.length * 0.25)]
      );
    }
  }

  if (highs.length) {
    resistance.push(highs[highs.length - 1]);

    if (highs.length >= 10) {
      resistance.push(
        highs[Math.floor(highs.length * 0.75)]
      );
    }
  }

  return {
    support: [...new Set(
      support
        .filter(Number.isFinite)
        .map(value => Number(value.toFixed(8)))
    )],

    resistance: [...new Set(
      resistance
        .filter(Number.isFinite)
        .map(value => Number(value.toFixed(8)))
    )]
  };
}

/**
 * Determine broad trend from price versus moving averages.
 */
function calculateTrend(currentPrice, sma7, sma14, sma30) {
  if (
    !Number.isFinite(currentPrice) ||
    !Number.isFinite(sma7) ||
    !Number.isFinite(sma14) ||
    !Number.isFinite(sma30)
  ) {
    return "Unknown";
  }

  if (
    currentPrice > sma7 &&
    sma7 > sma14 &&
    sma14 > sma30
  ) {
    return "Bullish";
  }

  if (
    currentPrice < sma7 &&
    sma7 < sma14 &&
    sma14 < sma30
  ) {
    return "Bearish";
  }

  return "Sideways";
}

/**
 * Determine short-term momentum from RSI and recent price movement.
 */
function calculateMomentum(rsi14, prices) {
  if (!Number.isFinite(rsi14)) {
    return "Unknown";
  }

  const recentPrices = Array.isArray(prices)
    ? prices.slice(-7)
    : [];

  let changePercent = null;

  if (
    recentPrices.length >= 2 &&
    Number.isFinite(Number(recentPrices[0])) &&
    Number(recentPrices[0]) !== 0 &&
    Number.isFinite(Number(recentPrices[recentPrices.length - 1]))
  ) {
    changePercent =
      ((Number(recentPrices[recentPrices.length - 1]) -
        Number(recentPrices[0])) /
        Number(recentPrices[0])) * 100;
  }

  if (
    rsi14 >= 60 &&
    Number.isFinite(changePercent) &&
    changePercent > 0
  ) {
    return "Strong";
  }

  if (
    rsi14 >= 52 &&
    Number.isFinite(changePercent) &&
    changePercent >= 0
  ) {
    return "Moderate";
  }

  if (
    rsi14 <= 40 &&
    Number.isFinite(changePercent) &&
    changePercent < 0
  ) {
    return "Weak";
  }

  return "Moderate";
}

/**
 * Build technical indicators from historical OHLC candles.
 */
function calculateTechnicalIndicators(candles) {
  const closes = Array.isArray(candles)
    ? candles
        .map(candle => Number(candle.close))
        .filter(Number.isFinite)
    : [];

  if (!closes.length) {
    return {
      trend: "Unknown",
      momentum: "Unknown",
      sma7Usd: null,
      sma14Usd: null,
      sma30Usd: null,
      ema20Usd: null,
      rsi14: null,
      volatility30dPercent: null,
      support: [],
      resistance: []
    };
  }

  const sma7 = calculateSMA(closes, 7);
  const sma14 = calculateSMA(closes, 14);
  const sma30 = calculateSMA(closes, 30);
  const ema20 = calculateEMA(closes, 20);
  const rsi14 = calculateRSI(closes, 14);
  const volatility30dPercent =
    calculateVolatilityPercent(closes);

  const {
    support,
    resistance
  } = calculateSupportResistance(candles);

  const currentPrice = closes[closes.length - 1];

  return {
    trend: calculateTrend(
      currentPrice,
      sma7,
      sma14,
      sma30
    ),

    momentum: calculateMomentum(
      rsi14,
      closes
    ),

    sma7Usd: formatNumber(sma7),
    sma14Usd: formatNumber(sma14),
    sma30Usd: formatNumber(sma30),
    ema20Usd: formatNumber(ema20),
    rsi14: formatNumber(rsi14),
    volatility30dPercent:
      formatNumber(volatility30dPercent),

    support,
    resistance
  };
}

/**
 * Resolve a cryptocurrency using CoinGecko search.
 *
 * Important:
 * Do not blindly prefer symbol matches because CoinGecko
 * can return unrelated tokens whose symbol happens to match
 * the user's search text.
 */
async function searchCoin(query) {
  const cleanQuery = cleanCoinQuery(query);

  if (!cleanQuery) {
    throw new Error("A cryptocurrency name or symbol is required.");
  }

  const normalizedQuery = normalize(cleanQuery);

  try {
    const response = await client.get("/search", {
      params: {
        query: cleanQuery
      }
    });

    const coins = Array.isArray(response.data?.coins)
      ? response.data.coins
      : [];

    if (!coins.length) {
      return null;
    }

    // Exact CoinGecko ID is strongest.
    const exactId = coins.find(
      coin => normalize(coin.id) === normalizedQuery
    );

    if (exactId) {
      return exactId;
    }

    // Exact name is stronger than symbol.
    const exactName = coins.find(
      coin => normalize(coin.name) === normalizedQuery
    );

    if (exactName) {
      return exactName;
    }

    // Only use an exact symbol if it is a sensible symbol query.
    const exactSymbols = coins.filter(
      coin => normalize(coin.symbol) === normalizedQuery
    );

    if (exactSymbols.length) {
      // Prefer the highest-ranked result.
      exactSymbols.sort((a, b) => {
        const rankA = Number(a.market_cap_rank || 999999);
        const rankB = Number(b.market_cap_rank || 999999);

        return rankA - rankB;
      });

      return exactSymbols[0];
    }

    // CoinGecko search relevance fallback.
    return coins[0];
  } catch (error) {
    console.error(
      "❌ Crypto coin search failed:",
      error.response?.data || error.message
    );

    if (error.response?.status === 429) {
      throw new Error(
        "Crypto data provider rate limit reached. Please try again shortly."
      );
    }

    throw new Error(
      "Unable to verify that cryptocurrency right now."
    );
  }
}


/**
 * Retrieve historical OHLC candles from CoinGecko.
 *
 * CoinGecko returns:
 * [timestamp, open, high, low, close]
 */
async function getCryptoOHLC(coinId, days = 30) {
  if (!coinId) {
    throw new Error("A CoinGecko coin ID is required for OHLC data.");
  }

  try {
    const response = await client.get(
      `/coins/${encodeURIComponent(coinId)}/ohlc`,
      {
        params: {
          vs_currency: "usd",
          days
        }
      }
    );

    if (!Array.isArray(response.data)) {
      return [];
    }

    return response.data
      .map(candle => {
        if (!Array.isArray(candle) || candle.length < 5) {
          return null;
        }

        const [
          timestamp,
          open,
          high,
          low,
          close
        ] = candle;

        if (
          !Number.isFinite(Number(timestamp)) ||
          !Number.isFinite(Number(open)) ||
          !Number.isFinite(Number(high)) ||
          !Number.isFinite(Number(low)) ||
          !Number.isFinite(Number(close))
        ) {
          return null;
        }

        return {
          timestamp: Number(timestamp),
          time: new Date(Number(timestamp)).toISOString(),
          open: Number(open),
          high: Number(high),
          low: Number(low),
          close: Number(close)
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.error(
      "❌ Crypto OHLC request failed:",
      error.response?.data || error.message
    );

    if (error.response?.status === 429) {
      throw new Error(
        "Crypto historical-data provider rate limit reached. Please try again shortly."
      );
    }

    /*
     * Historical data is important, but current market data should
     * remain usable if OHLC temporarily fails.
     */
    return [];
  }
}

async function getCryptoMarketData(query) {
  const providedCoin =
    query && typeof query === "object" && query.id
      ? query
      : null;

  const cleanQuery = cleanCoinQuery(
    providedCoin?.symbol ||
    providedCoin?.name ||
    providedCoin?.id ||
    query
  );

  if (!cleanQuery) {
    throw new Error("A cryptocurrency name or symbol is required.");
  }

  const cacheKey = normalize(providedCoin?.id || cleanQuery);
  const cached = marketCache.get(cacheKey);

  if (
    cached &&
    Date.now() - cached.timestamp < CACHE_TTL_MS
  ) {
    console.log(
      `♻️ Using cached crypto market data for ${cleanQuery}`
    );

    return cached.data;
  }

  const coin = providedCoin || await searchCoin(cleanQuery);

  if (!coin?.id) {
    throw new Error(
      `Could not find a verified cryptocurrency matching "${query}".`
    );
  }

  let marketResponse;

  try {
    marketResponse = await client.get("/coins/markets", {
      params: {
        vs_currency: "usd",
        ids: coin.id,
        price_change_percentage: "1h,24h,7d,30d"
      }
    });
  } catch (error) {
    console.error(
      "❌ Crypto market data request failed:",
      error.response?.data || error.message
    );

    if (error.response?.status === 429) {
      throw new Error(
        "Crypto market-data provider rate limit reached. Please try again shortly."
      );
    }

    throw new Error(
      "Unable to retrieve current cryptocurrency market data."
    );
  }

  const market = Array.isArray(marketResponse.data)
    ? marketResponse.data[0]
    : null;

  if (!market) {
    throw new Error(
      `No current market data is available for ${coin.name || query}.`
    );
  }

  const currentPrice = formatNumber(market.current_price);

  // =====================================================
  // HISTORICAL OHLC DATA
  // =====================================================

  let candles = [];

  try {
    console.log(
      `📊 Getting ${cleanQuery} historical OHLC data...`
    );

    candles = await getCryptoOHLC(coin.id, 30);

    console.log(
      `🕯️ OHLC candles received: ${candles.length}`
    );
  } catch (error) {
    console.error(
      "❌ Failed to retrieve crypto OHLC data:",
      error.message
    );

    candles = [];
  }

  // =====================================================
  // TECHNICAL ANALYSIS
  // =====================================================

  const technical = calculateTechnicalIndicators(candles);

  console.log(
    "📈 Crypto technical indicators:",
    JSON.stringify(technical, null, 2)
  );

  const data = {
    source: "CoinGecko",
    retrievedAt: new Date().toISOString(),

    coin: {
      id: coin.id,
      name: market.name || coin.name || null,
      symbol: market.symbol || coin.symbol || null,
      image:
        market.image ||
        coin.large ||
        coin.thumb ||
        null
    },

    market: {
      priceUsd: currentPrice,

      marketCapUsd:
        formatNumber(market.market_cap),

      marketCapRank:
        formatNumber(market.market_cap_rank),

      volume24hUsd:
        formatNumber(market.total_volume),

      change1hPercent:
        formatNumber(
          market.price_change_percentage_1h_in_currency
        ),

      change24hPercent:
        formatNumber(
          market.price_change_percentage_24h
        ),

      change7dPercent:
        formatNumber(
          market.price_change_percentage_7d_in_currency
        ),

      change30dPercent:
        formatNumber(
          market.price_change_percentage_30d_in_currency
        ),

      high24hUsd:
        formatNumber(market.high_24h),

      low24hUsd:
        formatNumber(market.low_24h),

      circulatingSupply:
        formatNumber(market.circulating_supply),

      totalSupply:
        formatNumber(market.total_supply),

      maxSupply:
        formatNumber(market.max_supply),

      athUsd:
        formatNumber(market.ath),

      athChangePercent:
        formatNumber(market.ath_change_percentage),

      atlUsd:
        formatNumber(market.atl),

      atlChangePercent:
        formatNumber(market.atl_change_percentage)
    },

    // =====================================================
    // TECHNICAL INDICATORS
    // =====================================================

    technical: {
      ...technical,

      // Preserve this field for compatibility with
      // existing AI analysis code.
      thirtyDayChangePercent:
        formatNumber(
          market.price_change_percentage_30d_in_currency
        )
    },

    // =====================================================
    // DATA AVAILABILITY
    // =====================================================

    dataAvailability: {
      currentMarketData: true,
      historicalPriceSeries: candles.length > 0,
      movingAverages:
        Number.isFinite(technical.sma7Usd) ||
        Number.isFinite(technical.sma14Usd) ||
        Number.isFinite(technical.sma30Usd),

      historicalVolatility:
        Number.isFinite(
          technical.volatility30dPercent
        )
    },

    // =====================================================
    // HISTORICAL CANDLES
    // =====================================================

    history: {
      days: candles.length > 0 ? 30 : 0,
      candles
    }
  };

  marketCache.set(cacheKey, {
    timestamp: Date.now(),
    data
  });

  return data;
}

module.exports = {
  searchCoin,
  getCryptoMarketData
};
