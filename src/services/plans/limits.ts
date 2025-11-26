export const Limits = {
  free: {
    maxChatPerDay: 20,
    maxAnalysesPerDay: 3
  },
  pro: {
    maxChatPerDay: Number.POSITIVE_INFINITY,
    maxAnalysesPerDay: Number.POSITIVE_INFINITY
  }
} as const;

