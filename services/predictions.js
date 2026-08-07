function updatePredictionStats(user, won) {

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

  user.predictions.accuracy =
    Math.round(
      (user.predictions.correct /
        user.predictions.total) * 100
    );
}

module.exports = {
  updatePredictionStats
};
