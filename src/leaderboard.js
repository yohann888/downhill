export function cleanText(value) {
  return String(value ?? '').replace(/[—–]/g, '-');
}

export function displayName(value) {
  return cleanText(value).trim().toUpperCase().slice(0, 3);
}

export function rivalLine(top, rank) {
  if (!Array.isArray(top) || !Number.isInteger(rank) || rank < 1 || rank > top.length) {
    return null;
  }
  if (rank === 1) return "You're #1!";

  const above = top[rank - 2];
  const current = top[rank - 1];
  const aboveTime = Number(above?.time);
  const currentTime = Number(current?.time);
  const name = displayName(above?.name);
  if (!name || !Number.isFinite(aboveTime) || !Number.isFinite(currentTime)) return null;

  return `${(currentTime - aboveTime).toFixed(1)} s behind #${rank - 1} ${name}`;
}

export function buildRankOverlayRows(entries, playerRank, playerRun = {}) {
  const rank = Number(playerRank);
  const hasRank = playerRank !== null
    && playerRank !== undefined
    && Number.isInteger(rank)
    && rank > 0;
  const rows = (Array.isArray(entries) ? entries : []).slice(0, 10).map((entry, index) => ({
    rank: index + 1,
    name: displayName(entry.name),
    time: Number(entry.time),
    highlighted: hasRank && rank === index + 1,
  }));

  if (hasRank && rank > 10) {
    rows.push({
      rank,
      name: displayName(playerRun.name || 'AAA'),
      time: Number(playerRun.time),
      highlighted: true,
    });
  }

  return rows;
}
