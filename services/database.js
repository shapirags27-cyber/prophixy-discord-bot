const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");

const adapter = new JSONFile("database/db.json");

const db = new Low(adapter, {
  users: [],
  events: [],
  predictions: [],
  invites: [],
  leaderboard: [],
  transactions: []
});

async function initDB() {
  await db.read();

  db.data ||= {
    users: [],
    events: [],
    predictions: [],
    invites: [],
    leaderboard: [],
    transactions: []
  };

  await db.write();
}

async function save() {
  await db.write();
}

async function getUser(discordId) {
  await db.read();

  return db.data.users.find(
    user => user.discordId === discordId
  );
}

async function createUser(discordId, username) {

  await db.read();

  const user = {

    discordId,
    username,

    wallet: "",

    phx: 0,

    invites: 0,

    wins: 0,

    losses: 0,

    totalPredictions: 0,

    accuracy: 0,

    streak: 0,

    bestStreak: 0,

    sbt: {
      verified: false,
      role: "none"
    }

  };

  db.data.users.push(user);

  await db.write();

  return user;
}

module.exports = {
  db,
  save,
  initDB,
  getUser,
  createUser
};
