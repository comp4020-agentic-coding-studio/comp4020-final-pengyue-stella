// Wilson's lower bound estimates how confidently an account's votes support
// "Believable." It rewards broad corroboration without letting one lonely
// positive vote outrank a large, strongly positive sample.
export function wilsonLowerBound(positive, total) {
  if (total === 0) return -1;
  const z = 1.96;
  const phat = positive / total;
  const z2 = z * z;
  return (phat + z2 / (2 * total) - z * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total)) / (1 + z2 / total);
}

export function trustScore(account) {
  const total = Object.values(account.votes).reduce((sum, n) => sum + n, 0);
  return wilsonLowerBound(account.votes.Believable ?? 0, total);
}

// The original museum record remains the anchor. Later contributions sort
// by trust, then chronologically when their scores are identical.
export function sortAccountsForDisplay(accounts) {
  return [...accounts].sort((a, b) => {
    if (a.kind === "original" && b.kind !== "original") return -1;
    if (b.kind === "original" && a.kind !== "original") return 1;
    const scoreDiff = trustScore(b) - trustScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
}
