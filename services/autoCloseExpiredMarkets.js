const { db, save } = require("./database");

/**
 * Automatically closes markets whose prediction window has ended.
 *
 * This service DOES NOT resolve a winner.
 * It only changes:
 *
 *     active -> closed
 *
 * Football markets are deliberately skipped because
 * football-data.org controls their lifecycle.
 */
async function autoCloseExpiredMarkets() {
  await db.read();

  const now = Date.now();
  const results = [];
  let changed = false;

  for (const event of db.data.events || []) {
    // Only generic non-football markets are handled here.
    if (
      event.category === "sports" ||
      (
        event.footballFixture &&
        event.footballFixture.id &&
        event.footballFixture.provider ===
          "football-data.org"
      )
    ) continue;

    // Already closed/resolved/etc.
    if (event.status !== "active") continue;

    const endsAt = Number(event.endsAt);

    // Invalid/missing expiry should never be auto-closed.
    if (!Number.isFinite(endsAt)) continue;

    // Market is still open.
    if (now < endsAt) continue;

    event.status = "closed";

    // Preserve the fact that closure happened automatically.
    event.closedAt = new Date(now).toISOString();

    event.closure = {
      type: "automatic",
      source: "market-expiry",
      closedAt: event.closedAt
    };

    changed = true;

    results.push({
      success: true,
      closed: true,
      resolved: false,
      eventId: event.id,
      question: event.question
    });

    console.log(
      `⏱️ Closed expired market ${event.id}: ${event.question}`
    );
  }

  if (changed) {
    await save();
  }

  return results;
}

module.exports = {
  autoCloseExpiredMarkets
};
