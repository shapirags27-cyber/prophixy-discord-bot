function updatePredictionStats(user, won) {

  if (!user) {
    return;
  }

  // ==========================================
  // ENSURE PREDICTION STATS EXIST
  // ==========================================

  user.predictions ||= {};

  user.predictions.total ??= 0;
  user.predictions.correct ??= 0;
  user.predictions.wrong ??= 0;
  user.predictions.currentStreak ??= 0;
  user.predictions.bestStreak ??= 0;
  user.predictions.accuracy ??= 0;

  // ==========================================
  // RECORD RESULT
  // ==========================================

  user.predictions.total++;

  if (won) {

    user.predictions.correct++;

    user.predictions.currentStreak++;

    if (
      user.predictions.currentStreak >
      user.predictions.bestStreak
    ) {
      user.predictions.bestStreak =
        user.predictions.currentStreak;
    }

  } else {

    user.predictions.wrong++;

    user.predictions.currentStreak = 0;

  }

  // ==========================================
  // CALCULATE ACCURACY
  // ==========================================

  user.predictions.accuracy =
    user.predictions.total > 0
      ? Math.round(
          (
            user.predictions.correct /
            user.predictions.total
          ) * 100
        )
      : 0;

  // ==========================================
  // SYNC TOP-LEVEL PROFILE STATISTICS
  // ==========================================
  //
  // These fields are used by the Discord profile
  // and admin-profile commands.
  //
  // Keep them synchronized with the canonical
  // nested prediction statistics so older database
  // records and existing UI continue to work.
  // ==========================================

  user.totalPredictions =
    user.predictions.total;

  user.accuracy =
    user.predictions.accuracy;

  user.streak =
    user.predictions.currentStreak;

  user.bestStreak =
    user.predictions.bestStreak;

  user.wins =
    Number(user.predictions.correct || 0);

  user.losses =
    Number(user.predictions.wrong || 0);
}


module.exports = {
  updatePredictionStats
};
