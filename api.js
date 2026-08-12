const express = require("express");

const {
  getUser,
  createUser,
  updateUser,
  db
} = require("./services/database");

module.exports = (client) => {
  const app = express();

  app.use(express.json());

  // ==============================
  // HEALTH
  // ==============================

  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      service: "Prophixy Discord Bot API",
      bot: client.user?.tag || "starting"
    });
  });

  // ==============================
  // ASSIGN ROLE + LINK WALLET
  // + VERIFY SBT
  // + AWARD PHX
  // ==============================

  app.post("/assign-role", async (req, res) => {

    // ==============================
    // VERIFY API AUTHENTICATION
    // ==============================

    const providedSecret =
      req.get("X-Verify-Secret");

    if (
      !process.env.VERIFY_API_SECRET ||
      providedSecret !== process.env.VERIFY_API_SECRET
    ) {
      console.error("❌ Unauthorized /assign-role request.");

      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    try {
      const {
        guildId,
        userId,
        roleName,
        wallet
      } = req.body;

      console.log("🔐 ROLE / WALLET REQUEST:", {
        guildId,
        userId,
        roleName,
        wallet
      });

      if (!guildId || !userId || !roleName) {
        return res.status(400).json({
          success: false,
          message:
            "Missing guildId, userId, or roleName"
        });
      }

      // ==============================
      // GET GUILD
      // ==============================

      const guild =
        await client.guilds.fetch(guildId);

      console.log(
        `✅ Guild found: ${guild.name} (${guild.id})`
      );

      // ==============================
      // GET MEMBER
      // ==============================

      let member;

      try {
        member =
          await guild.members.fetch(userId);
      } catch (error) {
        console.error(
          "❌ Could not fetch Discord member:",
          error
        );

        return res.status(404).json({
          success: false,
          message:
            "Discord member not found in guild",
          error: error.message
        });
      }

      console.log(
        `✅ Discord member found: ${member.user.tag}`
      );

      // ==============================
      // FIND TARGET ROLE
      // ==============================

      const role =
        guild.roles.cache.find(
          r =>
            r.name.trim().toLowerCase() ===
            roleName.trim().toLowerCase()
        );

      if (!role) {
        console.error(
          `❌ Role not found: "${roleName}"`
        );

        return res.status(404).json({
          success: false,
          message:
            `Role "${roleName}" was not found`
        });
      }

      console.log(
        `🎖️ Target role: ${role.name} (${role.id})`
      );

      // ==============================
      // CHECK BOT ROLE HIERARCHY
      // ==============================

      const botMember =
        await guild.members.fetchMe();

      if (
        role.position >=
        botMember.roles.highest.position
      ) {
        console.error(
          "❌ ROLE HIERARCHY ERROR"
        );

        return res.status(403).json({
          success: false,
          message:
            "Bot cannot assign this role because its highest role is not above the target role."
        });
      }

      // ==============================
      // GET / CREATE DATABASE USER
      // ==============================

      let user =
        await getUser(userId);

      if (!user) {
        user =
          await createUser(
            userId,
            member.user.username
          );

        console.log(
          `✅ Created database user for ${member.user.tag}`
        );
      }

      // ==============================
      // WALLET OWNERSHIP CHECK
      // ==============================

      if (wallet) {

        const normalizedWallet =
          wallet.toLowerCase();

        await db.read();

        const walletOwner =
          db.data.users.find(existing => {

            if (
              existing.discordId === userId
            ) {
              return false;
            }

            return (
              existing.wallet &&
              existing.wallet.toLowerCase() ===
                normalizedWallet
            );
          });

        if (walletOwner) {

          console.error(
            `❌ Wallet already linked to Discord ${walletOwner.discordId}`
          );

          return res.status(409).json({
            success: false,
            message:
              "This wallet is already linked to another Discord account."
          });
        }
      }

      // ==============================
      // CREATOR ROLE EXCLUSIVITY
      // ==============================

      const creatorRoles = [
        "Top Forecaster",
        "Market Creator"
      ];

      for (
        const creatorRoleName of creatorRoles
      ) {

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

          await member.roles.remove(
            otherRole
          );

          console.log(
            `✅ Removed "${otherRole.name}"`
          );
        }
      }

      // ==============================
      // ASSIGN DISCORD ROLE
      // ==============================

      if (
        !member.roles.cache.has(role.id)
      ) {

        console.log(
          `🎖️ Assigning "${role.name}" to ${member.user.tag}...`
        );

        await member.roles.add(role);

        console.log(
          `✅ Successfully assigned "${role.name}"`
        );

      } else {

        console.log(
          `ℹ️ ${member.user.tag} already has ${role.name}`
        );
      }

      // ==============================
      // UPDATE DATABASE
      // ==============================

      await db.read();

      const latestUser =
        db.data.users.find(
          existing =>
            existing.discordId === userId
        );

      if (!latestUser) {
        throw new Error(
          "Database user disappeared during verification."
        );
      }

      // Link wallet
      if (wallet) {
        latestUser.wallet = wallet;
      }

      // Save SBT information
      latestUser.sbt ||= {};

      latestUser.sbt.verified = true;
      latestUser.sbt.role = role.name;

      // ==============================
      // ONE-TIME SBT REWARD
      // ==============================

      let reward = 0;
      let rewardClaimed = false;

      if (
        latestUser.sbt.rewardClaimed !== true
      ) {

        if (
          role.name.toLowerCase() ===
          "top forecaster".toLowerCase()
        ) {

          reward = 20000;

        } else if (
          role.name.toLowerCase() ===
          "market creator".toLowerCase()
        ) {

          reward = 15000;
        }

        if (reward > 0) {

          latestUser.phx =
            Number(latestUser.phx || 0) +
            reward;

          latestUser.sbt.rewardClaimed = true;

          rewardClaimed = true;

          console.log(
            `🎁 Awarded ${reward} PHX to ${member.user.tag}`
          );
        }
      } else {

        console.log(
          `ℹ️ SBT reward already claimed by ${member.user.tag}`
        );
      }

      // ==============================
      // SAVE DATABASE
      // ==============================

      await db.write();

      console.log(
        `💾 Saved SBT/wallet data for ${member.user.tag}`
      );

      // ==============================
      // SUCCESS
      // ==============================

      return res.json({
        success: true,

        roleName: role.name,
        roleId: role.id,

        wallet:
          latestUser.wallet || "",

        sbt: {
          verified:
            latestUser.sbt.verified,
          role:
            latestUser.sbt.role,
          rewardClaimed:
            latestUser.sbt.rewardClaimed
        },

        reward,
        rewardClaimed,

        phxBalance:
          Number(latestUser.phx || 0),

        message:
          rewardClaimed
            ? "SBT verified, wallet linked, role assigned, and PHX reward granted."
            : "SBT verified, wallet linked, and role confirmed."
      });

    } catch (err) {

      console.error(
        "❌ ROLE / WALLET ASSIGNMENT ERROR:"
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

  const PORT =
    process.env.PORT || 4000;

  app.listen(
    PORT,
    "0.0.0.0",
    () => {
      console.log(
        `Discord API listening on port ${PORT}`
      );
    }
  );
};
