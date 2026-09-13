export type VouchRank = {
  name: string;
  emoji: string;
  minimum: number;
};

const RANKS: VouchRank[] = [
  { name: "Newcomer", emoji: "🌱", minimum: 0 },
  { name: "Trusted", emoji: "✨", minimum: 1 },
  { name: "Verified", emoji: "💎", minimum: 5 },
  { name: "Elite Middleman", emoji: "👑", minimum: 10 },
  { name: "Veteran", emoji: "🔥", minimum: 25 },
  { name: "Mythic Middleman", emoji: "🔮", minimum: 50 },
  { name: "Legend", emoji: "🌟", minimum: 100 },
];

export function getRank(count: number): VouchRank {
  return [...RANKS].reverse().find((rank) => count >= rank.minimum) ?? RANKS[0];
}