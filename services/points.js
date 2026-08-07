const { getUser, updateUser } = require("./database");
const rewards = require("../config/rewards");

async function addPoints(userId, amount) {
  const user = await getUser(userId);

  if (!user) return null;

  user.points += amount;

  await updateUser(user);

  return user.points;
}

async function removePoints(userId, amount) {
  const user = await getUser(userId);

  if (!user) return null;

  user.points = Math.max(0, user.points - amount);

  await updateUser(user);

  return user.points;
}

async function getPoints(userId) {
  const user = await getUser(userId);

  if (!user) return 0;

  return user.points;
}

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
  }

  reward += bonus;

  return await addPoints(userId, reward);
}

module.exports = {
  addPoints,
  removePoints,
  getPoints,
  addReward
};
