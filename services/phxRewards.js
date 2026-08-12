const { getUser, updateUser } = require("./database");
const rewards = require("../config/rewards");

// ==========================================
// PHX BALANCE
// ==========================================

async function addPHX(userId, amount) {
  const user = await getUser(userId);

  if (!user) return null;

  user.phx = Number(user.phx || 0) + Number(amount || 0);

  await updateUser(user);

  return user.phx;
}

async function removePHX(userId, amount) {
  const user = await getUser(userId);

  if (!user) return null;

  user.phx = Math.max(
    0,
    Number(user.phx || 0) - Number(amount || 0)
  );

  await updateUser(user);

  return user.phx;
}

async function getPHX(userId) {
  const user = await getUser(userId);

  if (!user) return 0;

  return Number(user.phx || 0);
}

// ==========================================
// PHX REWARDS
// ==========================================

async function addReward(userId, type, bonus = 0) {
  let reward = 0;

  switch (type) {

    case "daily":
      reward = rewards.DAILY_CHECKIN;
      break;

    case "invite":
      reward = rewards.INVITE;
      break;

    case "campaign":
      reward =
        rewards.LIKE +
        rewards.REPOST +
        rewards.REPLY;
      break;

    case "marketCreatorSBT":
      reward = rewards.MARKET_CREATOR_SBT;
      break;

    case "topForecasterSBT":
      reward = rewards.TOP_FORECASTER_SBT;
      break;

    default:
      reward = 0;
  }

  reward += Number(bonus || 0);

  return await addPHX(userId, reward);
}

module.exports = {
  addPHX,
  removePHX,
  getPHX,
  addReward
};
