async function assignSbtRole(guild, userId, roleName) {
  const member = await guild.members.fetch(userId);

  if (!member) {
    throw new Error("Discord member not found");
  }

  const normalizedRole = roleName.trim().toLowerCase();

  const allowedRoles = {
    "top forecaster": "Top Forecaster",
    "market creator": "Market Creator"
  };

  const targetRoleName = allowedRoles[normalizedRole];

  if (!targetRoleName) {
    throw new Error(
      `Invalid PhorvaGuard SBT role: "${roleName}"`
    );
  }

  const targetRole = guild.roles.cache.find(
    role =>
      role.name.toLowerCase() ===
      targetRoleName.toLowerCase()
  );

  if (!targetRole) {
    throw new Error(
      `Discord role "${targetRoleName}" was not found`
    );
  }

  // These two roles are mutually exclusive.
  const creatorRoleNames = [
    "Top Forecaster",
    "Market Creator"
  ];

  // Remove the opposite PhorvaGuard creator role.
  for (const creatorRoleName of creatorRoleNames) {
    const existingRole = guild.roles.cache.find(
      role =>
        role.name.toLowerCase() ===
        creatorRoleName.toLowerCase()
    );

    if (
      existingRole &&
      existingRole.id !== targetRole.id &&
      member.roles.cache.has(existingRole.id)
    ) {
      await member.roles.remove(existingRole);

      console.log(
        `🔄 Removed ${existingRole.name} from ${member.user.tag}`
      );
    }
  }

  // Add the verified role.
  if (!member.roles.cache.has(targetRole.id)) {
    await member.roles.add(targetRole);

    console.log(
      `✅ Added ${targetRole.name} to ${member.user.tag}`
    );
  } else {
    console.log(
      `ℹ️ ${member.user.tag} already has ${targetRole.name}`
    );
  }

  return {
    success: true,
    roleId: targetRole.id,
    roleName: targetRole.name
  };
}

module.exports = {
  assignSbtRole
};
