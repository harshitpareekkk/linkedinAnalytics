/**
 * sync.controller.js
 *
 * Flow on every run:
 *  1. Fetch ALL LinkedIn posts from last 3 months
 *  2. For each post:
 *     - NOT in storage  → CREATE new entry (postId as key, full data as value)
 *     - IN storage      → compare analytics field by field
 *                           CHANGED   → UPDATE analytics in storage
 *                           UNCHANGED → SKIP
 */

import { logger } from "../utils/logger.js";
import {
  fetchLastThreeMonthsPosts,
  fetchPostStats,
  extractPostDetails,
} from "../services/linkedin.service.js";
import {
  getStoredPost,
  savePostToStorage,
  updatePostInStorage,
} from "../services/monday.storage.service.js";
import { hasMetricsChanged } from "../utils/diff.util.js";

export const syncLinkedInPosts = async (req, res) => {
  try {
    console.log("\n" + "=".repeat(60));
    console.log("🚀 SYNC STARTED — Last 3 Months Posts");
    console.log("=".repeat(60));

    const token =
      req.headers.authorization?.replace("Bearer ", "") ||
      process.env.MONDAY_API_KEY;

    if (!token) {
      return res.status(401).json({ success: false, error: "Missing Monday API token" });
    }

    // ── Step 1: Fetch all posts from last 3 months ────────────
    const posts = await fetchLastThreeMonthsPosts();
    console.log(`\n✅ Total posts fetched from last 3 months: ${posts.length}`);

    if (posts.length === 0) {
      return res.json({
        success: true,
        summary: { total: 0, created: 0, updated: 0, unchanged: 0, failed: 0 },
        results: [],
      });
    }

    const results = [];

    // ── Step 2: Process each post ─────────────────────────────
    for (const post of posts) {
      const postId = post.id;
      console.log(`\n📌 Processing: ${postId}`);

      // Extract post metadata
      const details = extractPostDetails(post);
      console.log(`   Posted on : ${details.createdAt}`);
      console.log(`   Text      : ${details.text?.slice(0, 60)}...`);

      // Fetch latest analytics from LinkedIn
      const analytics = await fetchPostStats(postId);
      console.log(`   Analytics : likes=${analytics.likeCount} comments=${analytics.commentCount} impressions=${analytics.impressionCount} clicks=${analytics.clickCount} shares=${analytics.shareCount}`);

      // Check if post already exists in Monday Storage
      const existingPost = await getStoredPost(token, postId);

      if (!existingPost) {
        // ── NEW POST → save full entry ────────────────────────
        console.log(`   → 🆕 NEW — saving to storage`);

        const postObj = {
          postId,
          details,
          analytics,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const saved = await savePostToStorage(token, postObj);
        results.push({
          postId,
          postedAt: details.createdAt,
          status: saved.success ? "CREATED" : "SAVE_FAILED",
        });

      } else {
        // ── EXISTING POST → check if analytics changed ────────
        const analyticsChanged = hasMetricsChanged(existingPost.analytics, analytics);

        if (analyticsChanged) {
          console.log(`   → ♻️  CHANGED — updating analytics in storage`);
          console.log(`      Old: likes=${existingPost.analytics?.likeCount} comments=${existingPost.analytics?.commentCount} impressions=${existingPost.analytics?.impressionCount}`);
          console.log(`      New: likes=${analytics.likeCount} comments=${analytics.commentCount} impressions=${analytics.impressionCount}`);

          const updatedPost = {
            ...existingPost,
            analytics,
            updatedAt: new Date().toISOString(),
          };

          const updated = await updatePostInStorage(token, postId, updatedPost);
          results.push({
            postId,
            postedAt: details.createdAt,
            status: updated.success ? "UPDATED" : "UPDATE_FAILED",
          });

        } else {
          console.log(`   → ⏭️  UNCHANGED — skipping`);
          results.push({
            postId,
            postedAt: details.createdAt,
            status: "UNCHANGED",
          });
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
    console.log("=".repeat(60));

    return res.json({ success: true, summary, results });
  } catch (err) {
    logger.error(`❌ SYNC ERROR: ${err.message}`);
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
};