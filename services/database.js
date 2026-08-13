const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");

const adapter = new JSONFile("database/db.json");

const defaultData = {
  users: [],
  events: [],
  predictions: [],
  invites: [],
  inviteLinks: [],
  leaderboard: [],
  transactions: []
};

const db = new Low(adapter, defaultData);

// ==============================
// INITIALIZE DATABASE
// ==============================

async function initDB() {
  await db.read();

  if (!db.data) {
    db.data = {
      ...defaultData
    };
  }

  // Protect against older database versions
  db.data.users ||= [];
  db.data.events ||= [];
  db.data.predictions ||= [];
  db.data.invites ||= [];
  db.data.inviteLinks ||= [];
  db.data.leaderboard ||= [];
  db.data.transactions ||= [];

  // Add missing fields to existing users
  for (const user of db.data.users) {

    if (user.phx === undefined) {
      user.phx = 0;
    }

    if (user.invites === undefined) {
      user.invites = 0;
    }

    if (user.wins === undefined) {
      user.wins = 0;
    }

    if (user.losses === undefined) {
      user.losses = 0;
    }

    if (user.totalPredictions === undefined) {
      user.totalPredictions = 0;
    }

    if (user.accuracy === undefined) {
      user.accuracy = 0;
    }

    if (user.streak === undefined) {
      user.streak = 0;
    }

    if (user.bestStreak === undefined) {
      user.bestStreak = 0;
    }

    // Daily check-in system
    if (user.dailyCheckIns === undefined) {
      user.dailyCheckIns = 0;
    }

    if (user.lastDailyCheckIn === undefined) {
      user.lastDailyCheckIn = null;
    }

    if (user.dailyCheckInRewarded === undefined) {
      user.dailyCheckInRewarded = false;
    }

    if (!user.sbt) {
      user.sbt = {
        verified: false,
        role: "none",
        rewardClaimed: false
      };
    } else {
      if (user.sbt.verified === undefined) {
        user.sbt.verified = false;
      }

      if (user.sbt.role === undefined) {
        user.sbt.role = "none";
      }

      if (user.sbt.rewardClaimed === undefined) {
        user.sbt.rewardClaimed = false;
      }
    }

  }

  await db.write();
}

// ==============================
// SAVE
// ==============================

async function save() {
  await db.write();
}

// ==============================
// GET USER
// ==============================

async function getUser(discordId) {

  await db.read();

  return db.data.users.find(
    user => user.discordId === discordId
  );
}

// ==============================
// CREATE USER
// ==============================

async function createUser(discordId, username) {

  await db.read();

  let existing = db.data.users.find(
    user => user.discordId === discordId
  );

  if (existing) {
    return existing;
  }

  const user = {

    discordId,
    username,

    wallet: "",

    // PHX beta/test balance
    phx: 0,

    // Invite statistics
    invites: 0,

    wins: 0,
    losses: 0,

    totalPredictions: 0,

    accuracy: 0,

    streak: 0,
    bestStreak: 0,

    // Daily check-in system
    dailyCheckIns: 0,
    lastDailyCheckIn: null,
    dailyCheckInRewarded: false,

    sbt: {
      verified: false,
      role: "none"
    }

  };

  db.data.users.push(user);

  await db.write();

  return user;
}

// ==============================
// UPDATE USER
// ==============================

async function updateUser(user) {

  if (!user || !user.discordId) {
    return null;
  }

  await db.read();

  const index = db.data.users.findIndex(
    existing =>
      existing.discordId === user.discordId
  );

  if (index === -1) {
    return null;
  }

  db.data.users[index] = {
    ...db.data.users[index],
    ...user
  };

  await db.write();

  return db.data.users[index];
}

module.exports = {
  db,
  save,
  initDB,
  getUser,
  createUser,
  updateUser
};
