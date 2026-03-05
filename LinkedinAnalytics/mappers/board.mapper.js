
/**
 * Build the column_values object for creating/updating a Monday board item.
 * @param {object} postObj - Full post object from storage { details, analytics }
 * @param {object} columnMap - Map of { title → columnId } from fetchBoardColumns()
 * @returns {object} - { columnId: value, ... }
 */

// Map LinkedIn post types to Monday status labels (adjust as per your board's status labels)
const POST_TYPE_TO_STATUS = {
  "RICH": "Rich",
  "IMAGE": "Image",
  "DOCUMENT": "Document",
  "VIDEO": "Video",
  "TEXT": "Text",
  "ARTICLE": "Article",
  // Add more mappings as needed
};

export const mapPostToBoardColumns = (postObj, columnMap) => {
  const analytics = postObj.analytics || {};
  const details   = postObj.details   || {};

  // Map LinkedIn postType to Monday status label
  const postTypeLabel = POST_TYPE_TO_STATUS[details.postType?.toUpperCase()] || details.postType || "";

  // Title-to-value mapping — keys must match your board column titles exactly
  const titleToValue = {
    "Impressions":        analytics.impressionCount        ?? 0,
    "Unique Impressions": analytics.uniqueImpressionsCount ?? 0,
    "Likes":              analytics.likeCount              ?? 0,
    "Comments":           analytics.commentCount           ?? 0,
    "Shares":             analytics.shareCount             ?? 0,
    "Clicks":             analytics.clickCount             ?? 0,
    "Engagement":         parseFloat((analytics.engagement ?? 0).toFixed(4)),
    "Post URL":           details.postUrl   || "",
    "Post Type":          details.postType  || "",
    "Owner":              details.owner     || "",
    "Published Date":     details.createdAt || "",
  };

  // Build result using dynamic column map (fetched from board)
  // Falls through to hardcoded IDs if column title not in map
  const result = {};

  for (const [title, value] of Object.entries(titleToValue)) {
    const colId = columnMap?.[title.toLowerCase()];
    if (colId) {
      result[colId] = value;
    }
  }

  // Hardcoded fallback — always apply analytics columns even if dynamic fetch failed
  const hardcoded = {
    numeric_mkzwxzqk: analytics.impressionCount        ?? 0,
    numeric_mkzw50bn: analytics.uniqueImpressionsCount ?? 0,
    numeric_mkzwsay8: analytics.likeCount              ?? 0,
    numeric_mkzwwst3: analytics.commentCount           ?? 0,
    numeric_mkzw9bxf: analytics.shareCount             ?? 0,
    numeric_mkzwx7en: analytics.clickCount             ?? 0,
  };

  // Merge: dynamic columns override hardcoded ones
  return { ...hardcoded, ...result };
};

/**
 * Build only the analytics columns (used when updating an existing item).
 * @param {object} analytics - { likeCount, commentCount, impressionCount, ... }
 * @param {object} columnMap - Map of { title → columnId } from fetchBoardColumns()
 * @returns {object}
 */
export const mapAnalyticsToBoardColumns = (analytics, columnMap) => {
  return mapPostToBoardColumns({ analytics, details: {} }, columnMap);
};