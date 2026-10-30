function cleanText(value) {
  return String(value ?? '').replace(/[—–]/g, '-');
}

export function buildRankOverlayRows(entries, playerRank, playerRun = {}) {
  const rank = Number(playerRank);
  const hasRank = playerRank !== null
    && playerRank !== undefined
    && Number.isInteger(rank)
    && rank > 0;
  const rows = (Array.isArray(entries) ? entries : []).slice(0, 10).map((entry, index) => ({
    rank: index + 1,
    name: cleanText(entry.name),
    time: Number(entry.time),
    highlighted: hasRank && rank === index + 1,
  }));

  if (hasRank && rank > 10) {
    rows.push({
      rank,
      name: cleanText(playerRun.name || 'Rider'),
      time: Number(playerRun.time),
      highlighted: true,
    });
  }

  return rows;
}
