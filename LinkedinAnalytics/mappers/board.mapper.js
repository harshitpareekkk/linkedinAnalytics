export const mapStorageToBoardColumns = (data) => {
  const analytics = data.analytics || {};

  return {
    numeric_mkzwxzqk: analytics.impressions || 0,
    numeric_mkzw50bn:
      analytics.uniqueImpressions ||
      analytics.impressions ||
      0,
    numeric_mkzwsay8: analytics.likes || 0,
    numeric_mkzwwst3: analytics.comments || 0,
    numeric_mkzw9bxf: analytics.shares || 0,
    numeric_mkzwx7en: analytics.clicks || 0,
  };
};
