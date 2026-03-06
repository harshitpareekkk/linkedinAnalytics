/**
 * monday.storage.service.js
 *
 * @mondaycom/apps-sdk v3.2.1
 *
 * ⚠️  CRITICAL SDK BEHAVIOUR (confirmed via diagnostic):
 *   The SDK does NOT auto-serialize objects or arrays.
 *   - Passing an object → stored as "[object Object]"
 *   - Passing an array  → stored as "id1,id2,id3"
 *   FIX: Always JSON.stringify() before set(), always JSON.parse() after get().
 *
 * SDK METHOD SIGNATURES:
 *   storage.set(key, value, { shared?, previousVersion? })  → { version, success, error }
 *   storage.get(key, { shared? })                          → { value, version, success }
 *   storage.delete(key, { shared? })                       → { success }
 *
 * STORAGE DESIGN:
 *   Each post → key: "post_<postId>"        value: JSON string of full post object
 *   Index     → key: "linkedin_post_index"  value: JSON string of postId array
 */

import { Storage } from "@mondaycom/apps-sdk";
import { logger } from "../utils/logger.js";

const SHARED    = { shared: true };
const INDEX_KEY = "linkedin_post_index";
const postKey   = (postId) => `post_${postId}`;

// ─── Safe JSON helpers ────────────────────────────────────────────────────────

const toStorage   = (value) => JSON.stringify(value);

const fromStorage = (raw) => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw;
};

// ─── Index helpers ────────────────────────────────────────────────────────────

const readIndex = async (storage) => {
  try {
    const res = await storage.get(INDEX_KEY, SHARED);
    if (!res || !res.success || res.value === null || res.value === undefined) {
      return { ids: [], version: null };
    }
    const ids = fromStorage(res.value);
    return {
      ids:     Array.isArray(ids) ? ids : [],
      version: res.version || null,
    };
  } catch {
    return { ids: [], version: null };
  }
};

const writeIndex = async (storage, ids, previousVersion) => {
  const opts = { ...SHARED };
  if (previousVersion) opts.previousVersion = previousVersion;
  await storage.set(INDEX_KEY, toStorage(ids), opts);
};

// ─── Public API

/**
 * Get a single post by postId.
 * Returns the post object or null if not found.
 */
export const getStoredPost = async (token, postId) => {
  try {
    const storage = new Storage(token);
    const res     = await storage.get(postKey(postId), SHARED);

    if (!res || !res.success || res.value === null || res.value === undefined) {
      console.log(`[storage] GET ${postId} → NOT FOUND`);
      return null;
    }

    const post = fromStorage(res.value);
    console.log(`[storage] GET ${postId} → ${post ? "FOUND" : "PARSE FAILED"}`);
    return post;
  } catch (err) {
    console.log(`[storage] GET ${postId} → NOT FOUND (${err.message})`);
    return null;
  }
};

/**
 * Save a new post to storage and register its postId in the index.
 * postObj must have a `postId` field.
 */
export const savePostToStorage = async (token, postObj) => {
  const { postId } = postObj;
  try {
    const storage = new Storage(token);

    // 1. Save the post as a JSON string
    const setRes = await storage.set(postKey(postId), toStorage(postObj), SHARED);
    if (!setRes.success) {
      logger.error(`[storage] SAVE FAILED ${postId}: ${setRes.error}`);
      return { success: false, error: setRes.error };
    }

    // 2. Update the index
    const { ids, version } = await readIndex(storage);
    if (!ids.includes(postId)) ids.push(postId);
    await writeIndex(storage, ids, version);

    console.log(`[storage] SAVED ${postId} ✅  (index size: ${ids.length})`);
    return { success: true };
  } catch (err) {
    logger.error(`[storage] SAVE ERROR ${postId}: ${err.message}`);
    return { success: false, error: err.message };
  }
};

/**
 * Update analytics for an existing post.
 */
export const updatePostInStorage = async (token, postId, updatedPostObj) => {
  try {
    const storage = new Storage(token);

    // Get current version for optimistic locking
    let previousVersion = null;
    try {
      const cur    = await storage.get(postKey(postId), SHARED);
      previousVersion = cur?.version || null;
    } catch { /* key not found, write fresh */ }

    const opts = { ...SHARED };
    if (previousVersion) opts.previousVersion = previousVersion;

    const setRes = await storage.set(postKey(postId), toStorage(updatedPostObj), opts);

    if (!setRes.success) {
      logger.warn(`[storage] UPDATE version conflict for ${postId}, retrying without lock`);
      await storage.set(postKey(postId), toStorage(updatedPostObj), SHARED);
    }

    console.log(`[storage] UPDATED ${postId} ✅`);
    return { success: true };
  } catch (err) {
    logger.error(`[storage] UPDATE ERROR ${postId}: ${err.message}`);
    return { success: false, error: err.message };
  }
};

/**
 * Get ALL stored posts as an array.
 */
export const getAllStoredPosts = async (token) => {
  try {
    const storage    = new Storage(token);
    const { ids }    = await readIndex(storage);
    console.log(`[storage] Index has ${ids.length} postIds`);

    if (ids.length === 0) return [];

    const posts = [];
    for (const postId of ids) {
      try {
        const res = await storage.get(postKey(postId), SHARED);
        if (res && res.success && res.value !== null && res.value !== undefined) {
          const post = fromStorage(res.value);
          if (post) posts.push(post);
        }
      } catch {
        console.log(`[storage] Skipping missing post: ${postId}`);
      }
    }

    console.log(`[storage] GET ALL → ${posts.length} posts`);
    return posts;
  } catch (err) {
    logger.error(`[storage] GET ALL ERROR: ${err.message}`);
    return [];
  }
};

/**
 * Delete a single post and remove it from the index.
 */
export const deleteStoredPost = async (token, postId) => {
  try {
    const storage = new Storage(token);

    await storage.delete(postKey(postId), SHARED).catch(() => {});

    const { ids, version } = await readIndex(storage);
    const newIds = ids.filter((id) => id !== postId);
    await writeIndex(storage, newIds, version);

    console.log(`[storage] DELETED ${postId} ✅  (remaining: ${newIds.length})`);
    return { success: true };
  } catch (err) {
    logger.error(`[storage] DELETE ERROR ${postId}: ${err.message}`);
    return { success: false, error: err.message };
  }
};

/**
 * Delete ALL posts and clear the index.
 */
export const deleteAllStoredPosts = async (token) => {
  try {
    const storage  = new Storage(token);
    const { ids }  = await readIndex(storage);

    console.log(`[storage] Deleting ${ids.length} posts...`);
    for (const postId of ids) {
      await storage.delete(postKey(postId), SHARED).catch(() => {});
    }
    await storage.delete(INDEX_KEY, SHARED).catch(() => {});

    console.log(`[storage] DELETE ALL ✅`);
    return { success: true, deleted: ids.length };
  } catch (err) {
    logger.error(`[storage] DELETE ALL ERROR: ${err.message}`);
    return { success: false, error: err.message };
  }
};