const { db } = require("./database");

// ==============================
// GET PHX LEADERBOARD
// ==============================

async function getLeaderboard(limit = 10) {
  await db.read();

  const users = db.data.users || [];

  return users
    .slice()
    .sort(
      (a, b) =>
        Number(b.phx || 0) - Number(a.phx || 0)
    )
    .slice(0, limit);
}

// ==============================
// GET INVITE LEADERBOARD
// ==============================

async function getInviteLeaderboard(limit = 10) {
  await db.read();

  const users = db.data.users || [];

  return users
    .filter(user => Number(user.invites || 0) > 0)
    .slice()
    .sort(
      (a, b) =>
        Number(b.invites || 0) - Number(a.invites || 0)
    )
    .slice(0, limit);
}

// ==============================
// GET USER PHX RANK
// ==============================

async function getUserRank(discordId) {
  await db.read();

  const users = (db.data.users || [])
    .slice()
    .sort(
      (a, b) =>
        Number(b.phx || 0) - Number(a.phx || 0)
    );

  const index = users.findIndex(
    user => user.discordId === discordId
  );

  if (index === -1) {
    return null;
  }

  return {
    rank: index + 1,
    phx: Number(users[index].phx || 0),
    user: users[index]
  };
}

module.exports = {
  getLeaderboard,
  getInviteLeaderboard,
  getUserRank
};
