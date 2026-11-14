const { db } = require("./database");
const {
  getUser,
  createUser,
  updateUser
} = require("./database");

const { addPHX } = require("./phxRewards");
const rewards = require("../config/rewards");

// ==============================
// CACHE SERVER INVITES
// ==============================

async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();

    const result = {};

    for (const invite of invites.values()) {
      result[invite.code] = {
        uses: invite.uses || 0,
        inviterId: invite.inviter?.id || null,
        expiresAt: invite.expiresAt || null
      };
    }

    return result;

  } catch (error) {
    console.error(
      "❌ Unable to fetch guild invites:",
      error.message
    );

    return {};
  }
}

// ==============================
// FIND USED INVITE
// ==============================

function findUsedInvite(oldInvites, newInvites) {
  for (const code of Object.keys(newInvites)) {

    const oldUses =
      oldInvites[code]?.uses || 0;

    const newUses =
      newInvites[code]?.uses || 0;

    if (newUses > oldUses) {
      return {
        code,
        inviterId:
          newInvites[code].inviterId
      };
    }
  }

  return null;
}

// ==============================
// RECORD SUCCESSFUL INVITE
// ==============================

async function recordInvite(
  inviterId,
  invitedUserId,
  invitedUsername
) {
  if (!inviterId || !invitedUserId) return null;

  // Prevent self-invites.
  if (inviterId === invitedUserId) return null;

  let inviter = await getUser(inviterId);
  if (!inviter) {
    inviter = await createUser(inviterId, "Discord User");
  }

  let invitedUser = await getUser(invitedUserId);
  if (!invitedUser) {
    invitedUser = await createUser(
      invitedUserId,
      invitedUsername
    );
  }

  await db.read();
  db.data.invites ||= [];

  // The same Discord member can only count once.
  const alreadyRecorded = db.data.invites.some(
    invite => invite.invitedUserId === invitedUserId
  );

  if (alreadyRecorded) {
    console.log(
      `ℹ️ ${invitedUsername} was already recorded as an invite.`
    );
    return null;
  }

  // Count only invite rewards, never other PHX earnings.
  // Older records without rewardAmount are treated as
  // having received the previous 10 PHX invite reward.
  const previousInviteRewards = db.data.invites
    .filter(invite => invite.inviterId === inviterId)
    .reduce((total, invite) => {
      const amount = invite.rewardAmount === undefined
        ? 10
        : Math.max(0, Number(invite.rewardAmount) || 0);

      return total + amount;
    }, 0);

  const remainingLifetimeReward = Math.max(
    0,
    100 - previousInviteRewards
  );

  const rewardAmount = Math.min(
    Math.max(0, Number(rewards.INVITE) || 0),
    remainingLifetimeReward
  );

  const record = {
    id: Date.now(),
    inviterId,
    invitedUserId,
    invitedUsername,
    rewardAmount,
    createdAt: new Date().toISOString()
  };

  db.data.invites.push(record);

  const inviterIndex = db.data.users.findIndex(
    user => user.discordId === inviterId
  );

  if (inviterIndex === -1) return null;

  db.data.users[inviterIndex].invites =
    (db.data.users[inviterIndex].invites || 0) + 1;

  await db.write();

  // A successful referral still counts after the reward cap.
  if (rewardAmount > 0) {
    await addPHX(inviterId, rewardAmount);
  }

  console.log(
    `🎉 Invite recorded: ${inviterId} → ${invitedUserId} (+${rewardAmount} PHX)`
  );

  return record;
}

module.exports = {
  cacheGuildInvites,
  findUsedInvite,
  recordInvite
};
