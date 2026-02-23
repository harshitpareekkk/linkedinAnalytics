/**
 * sync.controller.js
 *
 * Flow on every run:
 *  1. Fetch latest 15 LinkedIn posts + their analytics
 *  2. For each post:
 *     - NOT in storage → CREATE new entry (postId as key, full data as value)
 *     - IN storage     → compare analytics field by field, UPDATE if changed, skip if same
 */

import { logger } from "../utils/logger.js";
import {
  fetchLatestPosts,
  fetchPostStats,
  extractPostDetails,
} from "../services/linkedin.service.js";
import {
  getStoredPost,
  savePostToStorage,
  updatePostInStorage,
} from "../services/monday.storage.service.js";

/**
 * Compare old and new analytics field by field.
 * Logs exactly which fields changed and returns true if any changed.
 */
const compareAnalytics = (oldAnalytics, newAnalytics, postId) => {
  const fields = [
    "likeCount",
    "commentCount",
    "impressionCount",
    "uniqueImpressionsCount",
    "shareCount",
    "clickCount",
    "engagement",
  ];

  let hasChanged = false;
  const changes = [];

  for (const field of fields) {
    const oldVal = oldAnalytics?.[field] ?? 0;
    const newVal = newAnalytics?.[field] ?? 0;
    if (oldVal !== newVal) {
      hasChanged = true;
      changes.push(`   ${field}: ${oldVal} → ${newVal}`);
    }
  }

  if (hasChanged) {
    console.log(`   → 🔍 CHANGES DETECTED for ${postId}:`);
    changes.forEach((c) => console.log(c));
  } else {
    console.log(`   → 🔍 COMPARISON for ${postId}:`);
    console.log(`      Stored : ${JSON.stringify(oldAnalytics)}`);
    console.log(`      Fetched: ${JSON.stringify(newAnalytics)}`);
    console.log(`      Result : No difference found`);
  }

  return hasChanged;
};

export const syncLinkedInPosts = async (req, res) => {
  try {
    console.log("\n" + "=".repeat(50));
    console.log("🚀 SYNC STARTED");
    console.log("=".repeat(50));

    const token =
      req.headers.authorization?.replace("Bearer ", "") ||
      process.env.MONDAY_API_KEY;

    if (!token) {
      return res.status(401).json({ success: false, error: "Missing Monday API token" });
    }

    // ── Step 1: Fetch LinkedIn posts ──────────────────────────
    const posts = await fetchLatestPosts();
    console.log(`✅ Fetched ${posts.length} LinkedIn posts`);

    const results = [];

    // ── Step 2: Process each post ─────────────────────────────
    for (const post of posts) {
      const postId = post.id;
      console.log(`\n📌 Processing: ${postId}`);

      const details = extractPostDetails(post);
      const analytics = await fetchPostStats(postId);
      console.log(`   Fetched analytics:`, analytics);

      const existingPost = await getStoredPost(token, postId);

      if (!existingPost) {
        // ── NEW POST ──────────────────────────────────────────
        console.log(`   → 🆕 NEW — saving to storage`);

        const postObj = {
          postId,
          details,
          analytics,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const saved = await savePostToStorage(token, postObj);
        results.push({ postId, status: saved.success ? "CREATED" : "SAVE_FAILED" });

      } else {
        // ── EXISTING POST ─────────────────────────────────────
        console.log(`   Stored analytics:`, existingPost.analytics);

        const analyticsChanged = compareAnalytics(existingPost.analytics, analytics, postId);

        if (analyticsChanged) {
          console.log(`   → ♻️  CHANGED — updating storage`);

          const updatedPost = {
            ...existingPost,
            analytics,
            updatedAt: new Date().toISOString(),
          };

          const updated = await updatePostInStorage(token, postId, updatedPost);
          results.push({ postId, status: updated.success ? "UPDATED" : "UPDATE_FAILED" });

        } else {
          console.log(`   → ⏭️  UNCHANGED — skipping`);
          results.push({ postId, status: "UNCHANGED" });
        }
      }
    }

    // ── Summary ───────────────────────────────────────────────
    const summary = {
      total:     results.length,
      created:   results.filter((r) => r.status === "CREATED").length,
      updated:   results.filter((r) => r.status === "UPDATED").length,
      unchanged: results.filter((r) => r.status === "UNCHANGED").length,
      failed:    results.filter((r) => r.status.includes("FAILED")).length,
    };

    console.log("\n📊 SYNC SUMMARY:", summary);
    console.log("=".repeat(50));

    return res.json({ success: true, summary, results });
  } catch (err) {
    logger.error(`❌ SYNC ERROR: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};