const { db, save } = require("./database");

/**
 * Per-guild AI Analysis configuration.
 *
 * Structure:
 * db.data.aiAnalysis = [
 *   {
 *     guildId: "...",
 *     roleIds: ["...", "..."],
 *     updatedAt: 123456789
 *   }
 * ]
 */

async function ensureAIAnalysisStorage() {
  await db.read();

  if (!db.data) {
    db.data = {};
  }

  if (!Array.isArray(db.data.aiAnalysis)) {
    db.data.aiAnalysis = [];
    await db.write();
  }
}

async function getAIAnalysisConfig(guildId) {
  if (!guildId) {
    return {
      guildId: null,
      roleIds: []
    };
  }

  await ensureAIAnalysisStorage();

  const config = db.data.aiAnalysis.find(
    item => item.guildId === guildId
  );

  if (!config) {
    return {
      guildId,
      roleIds: []
    };
  }

  return {
    guildId,
    roleIds: Array.isArray(config.roleIds)
      ? config.roleIds
      : []
  };
}

async function setAIAnalysisRoles(guildId, roleIds) {
  if (!guildId) {
    throw new Error("Guild ID is required.");
  }

  await ensureAIAnalysisStorage();

  const cleanRoleIds = [
    ...new Set(
      (Array.isArray(roleIds) ? roleIds : [])
        .filter(Boolean)
        .map(String)
    )
  ];

  const index = db.data.aiAnalysis.findIndex(
    item => item.guildId === guildId
  );

  const config = {
    guildId,
    roleIds: cleanRoleIds,
    updatedAt: Date.now()
  };

  if (index === -1) {
    db.data.aiAnalysis.push(config);
  } else {
    db.data.aiAnalysis[index] = {
      ...db.data.aiAnalysis[index],
      ...config
    };
  }

  await db.write();

  return config;
}

async function clearAIAnalysisRoles(guildId) {
  return setAIAnalysisRoles(guildId, []);
}

async function canUseAIAnalysis(member) {
  if (!member || !member.guild) {
    return false;
  }

  // Server administrators always have access.
  if (
    member.permissions?.has("Administrator")
  ) {
    return true;
  }

  const config = await getAIAnalysisConfig(
    member.guild.id
  );

  // No configured roles means nobody except
  // administrators can use AI Analysis.
  if (!config.roleIds.length) {
    return false;
  }

  return config.roleIds.some(
    roleId => member.roles.cache.has(roleId)
  );
}

module.exports = {
  getAIAnalysisConfig,
  setAIAnalysisRoles,
  clearAIAnalysisRoles,
  canUseAIAnalysis
};
