const { resolveEvent } = require("../events/resolveEvent");

async function resolveMarket(marketId, winnerOption) {
  return await resolveEvent(marketId, winnerOption);
}

module.exports = {
  resolveMarket
};
