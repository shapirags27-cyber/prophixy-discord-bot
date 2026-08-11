const express = require("express");

module.exports = (client) => {
  const app = express();

  app.use(express.json());

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        service: "Prophixy Discord Bot API",
        bot: client.user?.tag || "starting"
    });
});

  app.post("/assign-role", async (req, res) => {
    try {
      const { guildId, userId, roleName } = req.body;

      console.log("🔐 ROLE ASSIGN REQUEST:", {
        guildId,
        userId,
        roleName
      });

      if (!guildId || !userId || !roleName) {
        return res.status(400).json({
          success: false,
          message: "Missing guildId, userId, or roleName"
        });
      }

      // ==============================
      // GET GUILD
      // ==============================

      const guild = await client.guilds.fetch(guildId);

      console.log(
        `✅ Guild found: ${guild.name} (${guild.id})`
      );

      // ==============================
      // GET MEMBER
      // ==============================

      let member;

      try {
        member = await guild.members.fetch(userId);
      } catch (error) {
        console.error(
          "❌ Could not fetch Discord member:",
          error
        );

        return res.status(404).json({
          success: false,
          message: "Discord member not found in guild",
          error: error.message
        });
      }

      console.log(
        `✅ Discord member found: ${member.user.tag}`
      );

      // ==============================
      // FIND TARGET ROLE
      // ==============================

      const role = guild.roles.cache.find(
        r =>
          r.name.trim().toLowerCase() ===
          roleName.trim().toLowerCase()
      );

      if (!role) {
        console.error(
          `❌ Role not found: "${roleName}"`
        );

        console.log(
          "Available roles:",
          guild.roles.cache
            .filter(r => r.name !== "@everyone")
            .map(r => `${r.name} (${r.id})`)
            .join(", ")
        );

        return res.status(404).json({
          success: false,
          message: `Role "${roleName}" was not found`
        });
      }

      console.log(
        `🎖️ Target role: ${role.name} (${role.id})`
      );

      // ==============================
      // CHECK BOT ROLE HIERARCHY
      // ==============================

      const botMember = await guild.members.fetchMe();

      console.log(
        `🤖 Bot highest role: ${botMember.roles.highest.name} (${botMember.roles.highest.id})`
      );

      console.log(
        `🎖️ Target role position: ${role.position}`
      );

      console.log(
        `🤖 Bot highest role position: ${botMember.roles.highest.position}`
      );

      if (
        role.position >=
        botMember.roles.highest.position
      ) {
        console.error(
          "❌ ROLE HIERARCHY ERROR: Bot role is not above target role."
        );

        return res.status(403).json({
          success: false,
          message:
            "Bot cannot assign this role because its highest role is not above the target role."
        });
      }

      // ==============================
      // CREATOR ROLE EXCLUSIVITY
      // ==============================

      const creatorRoles = [
        "Top Forecaster",
        "Market Creator"
      ];

      for (const creatorRoleName of creatorRoles) {

        // Don't remove the role we're assigning
        if (
          creatorRoleName.toLowerCase() ===
          role.name.toLowerCase()
        ) {
          continue;
        }

        const otherRole =
          guild.roles.cache.find(
            r =>
              r.name.trim().toLowerCase() ===
              creatorRoleName.toLowerCase()
          );

        if (
          otherRole &&
          member.roles.cache.has(otherRole.id)
        ) {
          console.log(
            `🔄 Removing "${otherRole.name}" from ${member.user.tag}`
          );

          await member.roles.remove(otherRole);

          console.log(
            `✅ Removed "${otherRole.name}"`
          );
        }
      }

      // ==============================
      // CHECK IF ALREADY HAS ROLE
      // ==============================

      if (member.roles.cache.has(role.id)) {

        console.log(
          `ℹ️ ${member.user.tag} already has ${role.name}`
        );

        return res.json({
          success: true,
          alreadyHadRole: true,
          roleName: role.name,
          roleId: role.id
        });
      }

      // ==============================
      // ASSIGN ROLE
      // ==============================

      console.log(
        `🎖️ Assigning "${role.name}" to ${member.user.tag}...`
      );

      await member.roles.add(role);

      console.log(
        `✅ Successfully assigned "${role.name}" to ${member.user.tag}`
      );

      return res.json({
        success: true,
        roleName: role.name,
        roleId: role.id
      });

    } catch (err) {

      console.error(
        "❌ ROLE ASSIGNMENT ERROR:"
      );

      console.error(err);

      return res.status(500).json({
        success: false,
        error: err.message,
        code: err.code || null
      });
    }
  });

  // ==============================
  // START DISCORD BOT API
  // ==============================

  const PORT = process.env.PORT || 4000;

  app.listen(PORT, "0.0.0.0", () => {
    console.log(
      `Discord API listening on port ${PORT}`
    );
  });
};
