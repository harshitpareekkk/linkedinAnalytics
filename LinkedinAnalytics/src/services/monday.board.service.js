/**
 * monday.board.service.js
 *
 * Board columns and what fills each one:
 * ┌─────────────────────┬────────────┬──────────────────────────────────────────────────┐
 * │ Board Column Title  │ Type       │ Value                                            │
 * ├─────────────────────┼────────────┼──────────────────────────────────────────────────┤
 * │ Post id             │ text       │ "7431996441511907329"  ← raw ID only             │
 * │ Posted By           │ text       │ "Shubham Mehta (urn:li:person:abc123)"           │
 * │ Post URL            │ link       │ https://linkedin.com/feed/update/urn:li:share:ID │
 * │ Post Type           │ status     │ { index: 4 }  (RICH=4, TEXT=3, IMAGE=0, ...)    │
 * │ Post Date           │ date       │ { date: "2026-01-02" }                           │
 * │ Post Description    │ long_text  │ { text: "Full post text..." }                    │
 * │ Impressions         │ numeric    │ 1755                                             │
 * │ Unique Impressions  │ numeric    │ 930                                              │
 * │ Likes               │ numeric    │ 70                                               │
 * │ Comments            │ numeric    │ 4                                                │
 * │ Shares              │ numeric    │ 1                                                │
 * │ Clicks              │ numeric    │ 271                                              │
 * │ Engagement Rate     │ numeric    │ 0.057                                            │
 * │ CTR                 │ numeric    │ 8.65  (percentage)                               │
 * └─────────────────────┴────────────┴──────────────────────────────────────────────────┘
 *
 * ITEM NAME (the bold title row on the board):
 *   → First 100 chars of post text  e.g. "The role of technology in creating agile..."
 *   → NOT "[postId] text" — postId belongs in its own column
 */

import axios from "axios";
import { logger } from "../utils/logger.js";

const MONDAY_URL = "https://api.monday.com/v2";

// ─── GraphQL helper ───────────────────────────────────────────────────────────

const gql = async (token, query, variables = {}) => {
  try {
    const res = await axios.post(
      MONDAY_URL,
      { query, variables },
      {
        headers: {
          Authorization:  token,
          "Content-Type": "application/json",
          "API-Version":  "2024-01",
        },
      }
    );

    if (res.data?.errors?.length) {
      const msg = res.data.errors.map((e) => e.message).join(" | ");
      throw new Error(`Monday API error: ${msg}`);
    }

    return res.data?.data;

  } catch (err) {
    const detail = err.response?.data ?? err.message;
    logger.error("[board] gql failed:", JSON.stringify(detail));
    throw err;
  }
};

// ─── Post type → Monday status index ─────────────────────────────────────────

// Your board's status labels (confirmed from the error message you received):
//   { 0: "Image", 1: "Document", 2: "Video", 3: "Text", 4: "Rich", 6: "Article" }
const POST_TYPE_INDEX = {
  IMAGE:    0,
  DOCUMENT: 1,
  VIDEO:    2,
  TEXT:     3,
  RICH:     4,
  ARTICLE:  6,
};

const toStatusValue = (postType) => {
  const index = POST_TYPE_INDEX[(postType || "").toUpperCase()];
  return index !== undefined ? { index } : null;
};

// ─── Format a single value for its column type ────────────────────────────────

const formatValue = (value, colType) => {
  if (value === null || value === undefined || value === "") return null;

  switch (colType) {
    case "numeric":
      return typeof value === "number" ? value : parseFloat(value) || 0;

    case "status":
      // MUST be { index: N } — never a plain string
      return toStatusValue(value);

    case "link":
      // { url: "...", text: "..." }
      return { url: String(value), text: String(value) };

    case "date":
      // { date: "YYYY-MM-DD" }
      const dateStr = String(value).split("T")[0];
      return dateStr ? { date: dateStr } : null;

    case "long_text":
      // { text: "..." }
      return { text: String(value) };

    case "text":
    default:
      return String(value);
  }
};

// ─── Fetch board columns ──────────────────────────────────────────────────────

export const fetchBoardColumns = async (token) => {
  const query = `
    query ($boardId: [ID!]!) {
      boards(ids: $boardId) {
        name
        columns { id title type }
      }
    }
  `;

  const data  = await gql(token, query, { boardId: [process.env.MONDAY_BOARD_ID] });
  const board = data?.boards?.[0];
  if (!board) throw new Error(`Board ${process.env.MONDAY_BOARD_ID} not found`);

  const columns   = board.columns || [];
  const columnMap = {};   // { "column title lowercased" → columnId }

  console.log(`\n[board] Board: "${board.name}" | ${columns.length} columns`);
  for (const col of columns) {
    console.log(`[board]   "${col.title}" → id="${col.id}" type="${col.type}"`);
    columnMap[col.title.toLowerCase().trim()] = col.id;
  }

  return { columns, columnMap };
};

// ─── Build column_values ──────────────────────────────────────────────────────

/**
 * Build the column_values JSON string.
 *
 * @param {object}   postObj      - { details, analytics }
 * @param {object}   columnMap    - { "title lowercased" → columnId }
 * @param {object[]} columns      - [{ id, title, type }] from fetchBoardColumns
 * @param {boolean}  analyticsOnly- true = only send analytics fields (for updates)
 */
export const buildColumnValues = (postObj, columnMap = {}, columns = [], analyticsOnly = false) => {
  const analytics = postObj.analytics || {};
  const details   = postObj.details   || {};

  // Build columnId → type lookup from live board data
  const colTypeMap = {};
  for (const col of columns) {
    colTypeMap[col.id] = col.type;
  }

  // ─── All column mappings ─────────────────────────────────────────────────
  //
  // title        → EXACT board column title in lowercase
  //                (must match what you see in Monday — check the terminal log)
  // value        → the value to store
  // hintType     → fallback type if board type lookup fails
  // isAnalytics  → true = sent on every sync (create + update)
  //                false = sent only on create (static post metadata)

  const allMappings = [
    // ── Analytics (updated every sync) ───────────────────────────────────
    { title: "impressions",         value: analytics.impressionCount        ?? 0,                           hintType: "numeric",   isAnalytics: true  },
    { title: "unique impressions",  value: analytics.uniqueImpressionsCount ?? 0,                           hintType: "numeric",   isAnalytics: true  },
    { title: "likes",               value: analytics.likeCount              ?? 0,                           hintType: "numeric",   isAnalytics: true  },
    { title: "comments",            value: analytics.commentCount           ?? 0,                           hintType: "numeric",   isAnalytics: true  },
    { title: "shares",              value: analytics.shareCount             ?? 0,                           hintType: "numeric",   isAnalytics: true  },
    { title: "clicks",              value: analytics.clickCount             ?? 0,                           hintType: "numeric",   isAnalytics: true  },
    { title: "engagement rate",     value: analytics.engagement             ?? 0,                           hintType: "numeric",   isAnalytics: true  },
    { title: "ctr",                 value: analytics.ctr                    ?? 0,                           hintType: "numeric",   isAnalytics: true  },

    // ── Static post metadata (set once on create) ─────────────────────────
    // NOTE: "Post id" is the item NAME column in Monday — it is set via item_name
    //       in the create_item mutation, NOT via column_values. Do NOT add it here.
    // "Posted By" → "Full Name (urn:li:person:abc123)"
    { title: "posted by",           value: buildPostedBy(details),                                          hintType: "text",      isAnalytics: false },
    // "Post URL" → real LinkedIn URL
    { title: "post url",            value: details.postUrl                  || null,                        hintType: "link",      isAnalytics: false },
    // "Post Type" → status { index: N }
    { title: "post type",           value: details.postType                 || null,                        hintType: "status",    isAnalytics: false },
    // "Post Date" → date column
    { title: "post date",           value: details.createdAt                || null,                        hintType: "date",      isAnalytics: false },
    // "Post Description" → full text (long_text column)
    { title: "post description",    value: details.text                     || "",                          hintType: "long_text", isAnalytics: false },
  ];

  // Filter: on analytics-only updates skip the static fields
  const mappings = analyticsOnly
    ? allMappings.filter((m) => m.isAnalytics)
    : allMappings;

  // ─── Hardcoded numeric column ID fallback ────────────────────────────────
  // These IDs come from your existing board_mapper.js.
  // They are always applied for analytics — even if dynamic title matching misses them.
  const payload = {};

  if (!analyticsOnly || true) {
    // Always include hardcoded numeric analytics as safety net
    Object.assign(payload, {
      numeric_mkzwxzqk: analytics.impressionCount        ?? 0,
      numeric_mkzw50bn: analytics.uniqueImpressionsCount ?? 0,
      numeric_mkzwsay8: analytics.likeCount              ?? 0,
      numeric_mkzwwst3: analytics.commentCount           ?? 0,
      numeric_mkzw9bxf: analytics.shareCount             ?? 0,
      numeric_mkzwx7en: analytics.clickCount             ?? 0,
    });
  }

  // ─── Apply dynamic mappings ──────────────────────────────────────────────
  for (const { title, value, hintType, isAnalytics } of mappings) {
    if (analyticsOnly && !isAnalytics) continue;

    const colId = columnMap[title];
    if (!colId) {
      // Column title not found in board — log so user can fix title spelling
      if (!analyticsOnly) {
        console.log(`[board] ⚠️  Column not found on board: "${title}" — skipping`);
      }
      continue;
    }

    // Use actual board type (from live fetch), fall back to hint
    const actualType = colTypeMap[colId] || hintType;
    const formatted  = formatValue(value, actualType);

    if (formatted !== null) {
      payload[colId] = formatted;
    }
  }

  return JSON.stringify(payload);
};

/**
 * Build the "Posted By" text value.
 * Shows: "Shubham Mehta (urn:li:person:abc123)"
 * If name === authorId (fallback), just show the URN.
 */
const buildPostedBy = (details) => {
  const name = (details.authorName || "").trim();
  const id   = (details.authorId   || "").trim();

  if (!name && !id) return "";
  if (name && id && name !== id) return `${name} (${id})`;
  return name || id;
};

// ─── Create board item ────────────────────────────────────────────────────────

/**
 * Create a new item on the Monday board.
 *
 * ITEM NAME = first 100 chars of post text  (NOT "[postId] text")
 * Post ID goes into its own dedicated "Post id" column.
 *
 * @param {string}   token     - Monday API token
 * @param {object}   postObj   - { details, analytics }
 * @param {object}   columnMap - { "title lowercased" → columnId }
 * @param {object[]} columns   - [{ id, title, type }]
 * @returns {string}           - Created Monday item ID
 */
export const createBoardItem = async (token, postObj, columnMap, columns = []) => {
  const details = postObj.details || {};

  // ITEM NAME = postId
  // Monday shows the item name as the first (name) column on the board.
  // Your board first column is "Post id" — so set item_name = postId.
  // Post text goes into "Post Description" column via column_values.
  const itemName = String(details.postId || postObj.postId || "unknown");

  const columnValuesStr = buildColumnValues(postObj, columnMap, columns, false);

  console.log(`[board] Creating item: "${itemName}"`);
  console.log(`[board] Column values: ${columnValuesStr}`);

  const query = `
    mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
      create_item(
        board_id:      $boardId
        item_name:     $itemName
        column_values: $columnValues
      ) {
        id
        name
      }
    }
  `;

  const data = await gql(token, query, {
    boardId:      String(process.env.MONDAY_BOARD_ID),
    itemName,
    columnValues: columnValuesStr,
  });

  const itemId = data?.create_item?.id;
  if (!itemId) throw new Error("create_item returned no id — check board permissions");

  console.log(`[board] ✅ Created item id=${itemId}`);
  return String(itemId);
};

// ─── Update board item analytics ─────────────────────────────────────────────

/**
 * Update ONLY analytics columns on an existing board item.
 * Static fields (Post ID, Posted By, URL, Date, Description) are not touched.
 *
 * @param {string}   token      - Monday API token
 * @param {string}   itemId     - Monday board item ID
 * @param {object}   analytics  - { likeCount, impressionCount, ctr, ... }
 * @param {object}   columnMap  - { "title lowercased" → columnId }
 * @param {object[]} columns    - [{ id, title, type }]
 */
export const updateBoardItem = async (token, itemId, analytics, columnMap, columns = []) => {
  const columnValuesStr = buildColumnValues(
    { analytics, details: {} },
    columnMap,
    columns,
    true   // analyticsOnly = true
  );

  console.log(`[board] Updating analytics for item id=${itemId}`);
  console.log(`[board] Column values: ${columnValuesStr}`);

  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
      change_multiple_column_values(
        board_id:      $boardId
        item_id:       $itemId
        column_values: $columnValues
      ) {
        id
        name
      }
    }
  `;

  const data = await gql(token, query, {
    boardId:      String(process.env.MONDAY_BOARD_ID),
    itemId:       String(itemId),
    columnValues: columnValuesStr,
  });

  const updatedId = data?.change_multiple_column_values?.id;
  console.log(`[board] ✅ Updated item id=${itemId}`);
  return updatedId;
};

// ─── Find board item by postIId


/**
 * Search all board items for one whose name contains the postId.
 * Used as fallback when boardItemId was not saved in storage.
 */
export const findBoardItemByPostId = async (token, postId) => {
  const query = `
    query ($boardId: [ID!]!) {
      boards(ids: $boardId) {
        items_page(limit: 500) {
          items { id name }
        }
      }
    }
  `;

  try {
    const data  = await gql(token, query, { boardId: [process.env.MONDAY_BOARD_ID] });
    const items = data?.boards?.[0]?.items_page?.items || [];

    // item_name IS the postId now, so exact match works perfectly
    const match = items.find((item) => item.name?.includes(postId));

    if (match) {
      console.log(`[board] Found item for postId=${postId} → id=${match.id}`);
      return String(match.id);
    }

    console.log(`[board] No board item found for postId=${postId}`);
    return null;

  } catch (err) {
    logger.warn(`[board] findBoardItemByPostId error: ${err.message}`);
    return null;
  }
};