const { db } = require("./database");
const {
  getUser,
  createUser,
  updateUser
} = require("./database");

const { addReward } = require("./phxRewards");

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

  if (!inviterId || !invitedUserId) {
    return null;
  }

  // Prevent self-invites
  if (inviterId === invitedUserId) {
    return null;
  }

  let inviter =
    await getUser(inviterId);

  if (!inviter) {
    inviter =
      await createUser(
        inviterId,
        "Discord User"
      );
  }

  let invitedUser =
    await getUser(invitedUserId);

  if (!invitedUser) {
    invitedUser =
      await createUser(
        invitedUserId,
        invitedUsername
      );
  }

  await db.read();

  // Prevent the same Discord member
  // from generating another invite reward
  const alreadyRecorded =
    db.data.invites.some(
      invite =>
        invite.invitedUserId ===
        invitedUserId
    );

  if (alreadyRecorded) {
    console.log(
      `ℹ️ ${invitedUsername} was already recorded as an invite.`
    );

    return null;
  }

  const record = {
    id: Date.now(),

    inviterId,

    invitedUserId,

    invitedUsername,

    createdAt:
      new Date().toISOString()
  };

  // Save referral record
  db.data.invites.push(record);

  // Update inviter count directly
  const inviterIndex =
    db.data.users.findIndex(
      user =>
        user.discordId === inviterId
    );

  if (inviterIndex === -1) {
    return null;
  }

  db.data.users[inviterIndex].invites =
    (db.data.users[inviterIndex].invites || 0) + 1;

  await db.write();

  // Award configured invite reward.
  // Current config: +10 PHX.
  await addReward(
    inviterId,
    "invite"
  );

  console.log(
    `🎉 Invite recorded: ${inviterId} → ${invitedUserId}`
  );

  return record;
}

module.exports = {
  cacheGuildInvites,
  findUsedInvite,
  recordInvite
};
