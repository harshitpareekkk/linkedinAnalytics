/**
 * monday.board.service.js
 *
 * Uses monday-sdk-js for all GraphQL calls (Seamless Authentication).
 * The shortLivedToken from the JWT payload is passed to monday.setToken()
 * before each call — the SDK handles auth headers and API versioning.
 *
 * ─── BOARD COLUMN LAYOUT ─────────────────────────────────────────────────────
 *
 *  Column Title         Type       Value
 *  ─────────────────── ────────── ──────────────────────────────────────────
 *  Post id             (name col) set via item_name in create_item
 *  Posted By           text       "Shubham Mehta (urn:li:person:abc123)"
 *  Post URL            link       { url, text }
 *  Post Type           status     { index: N }  RICH=4, TEXT=3, IMAGE=0...
 *  Post Date           date       { date: "2026-01-02" }
 *  Post Description    long_text  { text: "Full post text..." }
 *  Impressions         numeric    "3124"
 *  Unique Impressions  numeric    "1755"
 *  Likes               numeric    "70"
 *  Comments            numeric    "4"
 *  Shares              numeric    "1"
 *  Clicks              numeric    "271"
 *  Engagement Rate     numeric    "0.11"
 *  CTR                 numeric    "8.65"
 */

import mondaySdk from "monday-sdk-js";
import { logger } from "../utils/logger.js";

// ─── SDK instance ─────────────────────────────────────────────────────────────
const monday = mondaySdk();

// ─── GraphQL helper ───────────────────────────────────────────────────────────

const gql = async (token, query, variables = {}) => {
  monday.setToken(token);
  const res = await monday.api(query, {
    token,
    variables,
    apiVersion: "2023-10",
  });

  if (res.errors?.length) {
    const msg = res.errors.map((e) => e.message).join(" | ");
    throw new Error(`Monday API error: ${msg}`);
  }

  return res.data;
};

// ─── Token / board access test ────────────────────────────────────────────────
// Tests that the token can actually read the target board.
// shortLivedTokens may not have "me" access, so we query the board directly.

export const testMondayAccess = async (token, boardId) => {
  const query = `query { boards(ids: [${boardId}]) { id name } }`;
  try {
    const data = await gql(token, query);
    const board = data?.boards?.[0];
    console.log(`[board] ✅ Token valid — board: "${board?.name || "unknown"}" (id=${board?.id || boardId})`);
    return board;
  } catch (err) {
    console.error("[board] ❌ Token/board test failed:", err.message);
    throw err;
  }
};

// ─── Post type → Monday status index ─────────────────────────────────────────
// Confirmed from your board's status labels:
// { 0: "Image", 1: "Document", 2: "Video", 3: "Text", 4: "Rich", 6: "Article" }

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

// ─── Format a value for its column type ──────────────────────────────────────

const formatValue = (value, colType) => {
  if (value === null || value === undefined || value === "") return null;

  switch (colType) {
    case "numeric": {
      // ⚠️  Monday REQUIRES numeric column values as STRINGS in column_values JSON
      // Passing a JS number silently fails — the column shows blank or 0
      const num = typeof value === "number" ? value : parseFloat(value);
      if (isNaN(num)) return "0";
      // Keep up to 2 decimal places, strip trailing zeros
      return String(Math.round(num * 100) / 100);
    }

    case "status":
      // Must be { index: N } — NEVER a plain string like "RICH"
      return toStatusValue(value);

    case "link":
      return { url: String(value), text: String(value) };

    case "date": {
      const d = String(value).split("T")[0];
      return d ? { date: d } : null;
    }

    case "long_text":
      return { text: String(value) };

    case "text":
    default:
      return String(value);
  }
};

// ─── Fetch board columns ──────────────────────────────────────────────────────
//
// FIX: Use inline board ID in the query string instead of a GraphQL variable.
// This avoids ALL "Unauthorized field or type" errors caused by the [ID!] vs
// ID! vs String! variable type ambiguity across Monday API versions.

export const fetchBoardColumns = async (token, boardId) => {
  const query = `
    query {
      boards(ids: [${boardId}]) {
        id
        name
        columns {
          id
          title
          type
        }
      }
    }
  `;

  const data = await gql(token, query);

  const board = data?.boards?.[0];
  if (!board) {
    throw new Error(
      `Board "${boardId}" not found. Check MONDAY_BOARD_ID and that the token has access to this board.`
    );
  }

  const columns   = board.columns || [];
  const columnMap = {};   // { "column title lowercased" → columnId }

  console.log(`\n[board] ✅ Board: "${board.name}" (id=${board.id}) — ${columns.length} columns:`);
  for (const col of columns) {
    const key = col.title.toLowerCase().trim();
    columnMap[key] = col.id;
    console.log(`[board]   "${col.title}" → id="${col.id}" type="${col.type}"`);
  }

  return { columns, columnMap };
};

// ─── Build column_values ──────────────────────────────────────────────────────

const buildPostedBy = (details) => {
  const name = (details.authorName || "").trim();
  const id   = (details.authorId   || "").trim();
  if (!name && !id) return "";
  if (name && id && name !== id) return `${name} (${id})`;
  return name || id;
};

/**
 * Build the column_values JSON string.
 *
 * @param {object}  postObj       - { details, analytics }
 * @param {object}  columnMap     - { "title lowercased" → columnId }  from fetchBoardColumns
 * @param {Array}   columns       - [{ id, title, type }]              from fetchBoardColumns
 * @param {boolean} analyticsOnly - true on update runs — skip static metadata columns
 */
export const buildColumnValues = (postObj, columnMap = {}, columns = [], analyticsOnly = false) => {
  const analytics = postObj.analytics || {};
  const details   = postObj.details   || {};

  // columnId → type  (from live board fetch, so formatting is always correct)
  const colTypeMap = {};
  for (const col of columns) colTypeMap[col.id] = col.type;

  // ── All column mappings ──────────────────────────────────────────────────
  // title       → board column title in lowercase (must match exactly)
  // value       → what to write
  // hintType    → fallback if column type not in live fetch
  // isAnalytics → true = sent on every sync | false = sent only on create

  const allMappings = [
    // Analytics — updated every sync run
    { title: "impressions",        value: analytics.impressionCount        ?? 0, hintType: "numeric",   isAnalytics: true  },
    { title: "unique impressions", value: analytics.uniqueImpressionsCount ?? 0, hintType: "numeric",   isAnalytics: true  },
    { title: "likes",              value: analytics.likeCount              ?? 0, hintType: "numeric",   isAnalytics: true  },
    { title: "comments",           value: analytics.commentCount           ?? 0, hintType: "numeric",   isAnalytics: true  },
    { title: "shares",             value: analytics.shareCount             ?? 0, hintType: "numeric",   isAnalytics: true  },
    { title: "clicks",             value: analytics.clickCount             ?? 0, hintType: "numeric",   isAnalytics: true  },
    { title: "engagement rate",    value: analytics.engagement             ?? 0, hintType: "numeric",   isAnalytics: true  },
    { title: "ctr",                value: analytics.ctr                    ?? 0, hintType: "numeric",   isAnalytics: true  },

    // Static metadata — written on create only, never overwritten on update
    // NOTE: "Post id" = the item name column → handled via item_name in create_item, NOT here
    { title: "posted by",          value: buildPostedBy(details),               hintType: "text",      isAnalytics: false },
    { title: "post url",           value: details.postUrl     || null,          hintType: "link",      isAnalytics: false },
    { title: "post type",          value: details.postType    || null,          hintType: "status",    isAnalytics: false },
    { title: "post date",          value: details.createdAt   || null,          hintType: "date",      isAnalytics: false },
    { title: "post description",   value: details.text        || "",            hintType: "long_text", isAnalytics: false },
  ];

  // Hardcoded column ID safety net — always applied for analytics
  // These match the specific board's numeric column IDs
  const payload = {
    numeric_mkzwxzqk: String(analytics.impressionCount        ?? 0),
    numeric_mkzw50bn: String(analytics.uniqueImpressionsCount ?? 0),
    numeric_mkzwsay8: String(analytics.likeCount              ?? 0),
    numeric_mkzwwst3: String(analytics.commentCount           ?? 0),
    numeric_mkzw9bxf: String(analytics.shareCount             ?? 0),
    numeric_mkzwx7en: String(analytics.clickCount             ?? 0),
  };

  // Apply dynamic title-based mappings (overrides hardcoded if same column)
  for (const { title, value, hintType, isAnalytics } of allMappings) {
    if (analyticsOnly && !isAnalytics) continue;

    const colId = columnMap[title];
    if (!colId) {
      if (!analyticsOnly) {
        console.log(`[board] ⚠️  Column not on board: "${title}" — check exact title spelling`);
      }
      continue;
    }

    const actualType = colTypeMap[colId] || hintType;
    const formatted  = formatValue(value, actualType);
    if (formatted !== null) payload[colId] = formatted;
  }

  return JSON.stringify(payload);
};

// ─── Create board item ────────────────────────────────────────────────────────

/**
 * Create a new Monday board item.
 * item_name = postId  → appears in the "Post id" name column on the board.
 * Post text goes into "Post Description" long_text column via column_values.
 */
export const createBoardItem = async (token, postObj, columnMap, columns, boardId) => {
  const itemName        = String(postObj.details?.postId || postObj.postId || "unknown");
  const columnValuesStr = buildColumnValues(postObj, columnMap, columns, false);

  console.log(`[board] Creating item: "${itemName}" on board ${boardId}`);
  console.log(`[board] Column values: ${columnValuesStr}`);

  const query = `
    mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
      create_item(
        board_id:      $boardId
        item_name:     $itemName
        column_values: $columnValues
      ) { id name }
    }
  `;

  const data   = await gql(token, query, {
    boardId:      String(boardId),
    itemName,
    columnValues: columnValuesStr,
  });
  const itemId = data?.create_item?.id;
  if (!itemId) throw new Error("create_item returned no id — check board permissions");

  console.log(`[board] ✅ Created item id=${itemId}`);
  return String(itemId);
};

// ─── Update board item (analytics only) ──────────────────────────────────────

/**
 * Update ONLY analytics columns on an existing board item.
 * Static columns (Post id, Posted By, URL, Date, Description) are never touched.
 */
export const updateBoardItem = async (token, itemId, analytics, columnMap, columns, boardId) => {
  const columnValuesStr = buildColumnValues(
    { analytics, details: {} },
    columnMap,
    columns,
    true  // analyticsOnly = true
  );

  console.log(`[board] Updating analytics for item id=${itemId}`);
  console.log(`[board] Column values: ${columnValuesStr}`);

  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
      change_multiple_column_values(
        board_id:      $boardId
        item_id:       $itemId
        column_values: $columnValues
      ) { id name }
    }
  `;

  const data = await gql(token, query, {
    boardId:      String(boardId),
    itemId:       String(itemId),
    columnValues: columnValuesStr,
  });

  console.log(`[board] ✅ Updated item id=${itemId}`);
  return data?.change_multiple_column_values?.id;
};

// ─── Find board item by postId ────────────────────────────────────────────────
// Fallback when boardItemId is missing from storage — scans up to 500 items.
// Works because item_name = postId (set in createBoardItem above).

export const findBoardItemByPostId = async (token, postId, boardId) => {
  const query = `
    query {
      boards(ids: [${boardId}]) {
        items_page(limit: 500) {
          items { id name }
        }
      }
    }
  `;

  try {
    const data  = await gql(token, query);
    const items = data?.boards?.[0]?.items_page?.items || [];
    const match = items.find((item) => item.name === String(postId) || item.name?.includes(String(postId)));

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