/**
 * sync.controller.js
 *
 * ─── WHAT THIS DOES (end to end) ────────────────────────────────────────────
 *
 * Your LinkedIn org page has posts. Each post has analytics (likes, impressions,
 * clicks, CTR, etc.). You want all of this synced automatically into Monday.com.
 *
 * Flow on every POST /api/sync:
 *
 *   1. Connect to Monday board — fetch column IDs so we know where to put data
 *   2. Fetch all LinkedIn posts from last 90 days
 *   3. For each post, one at a time:
 *
 *      NEW POST (never seen before):
 *        → Save full post + analytics to Monday Storage (our database)
 *        → Create a new row on the Monday board with all columns filled
 *        → Save the Monday board row ID back to storage (for future updates)
 *
 *      EXISTING POST, analytics changed:
 *        → Update the analytics in Monday Storage
 *        → Update the analytics columns on the existing Monday board row
 *
 *      EXISTING POST, nothing changed:
 *        → Skip entirely
 *
 * ─── TOKEN USAGE ────────────────────────────────────────────────────────────
 *
 *   The same MONDAY_API_KEY is used for:
 *     - Monday Board API  (GraphQL calls in board service)
 *     - Monday Storage API (direct HTTP calls in storage service)
 *
 *   It is passed explicitly to every function that needs it.
 *
 * ─── WHY SEQUENTIAL (not parallel) ─────────────────────────────────────────
 *
 *   Monday's Storage API has rate limits. Running all posts in parallel causes
 *   responses to interleave — you'd see storage results for post A appearing
 *   while processing post B. The for...of loop with await ensures each post
 *   fully completes before the next one starts.
 */

import { logger }           from "../utils/logger.js";
import {
  fetchLastThreeMonthsPosts,
  fetchPostStats,
  extractPostDetails,
}                            from "../services/linkedin.service.js";
import {
  getStoredPost,
  savePostToStorage,
  updatePostInStorage,
}                            from "../services/monday.storage.service.js";
import {
  fetchBoardColumns,
  createBoardItem,
  updateBoardItem,
  findBoardItemByPostId,
}                            from "../services/monday.board.service.js";
import { hasMetricsChanged } from "../utils/diff.util.js";

export const syncLinkedInPosts = async (req, res) => {
  try {
    console.log("\n" + "=".repeat(60));
    console.log("🚀 SYNC STARTED — Last 3 Months Posts");
    console.log("=".repeat(60));

    // The Monday API key — used for Board API (GraphQL) AND Storage API (HTTP)
    const token =
      req.headers.authorization?.replace("Bearer ", "") ||
      process.env.MONDAY_API_KEY;

    if (!token) {
      return res.status(401).json({ success: false, error: "Missing Monday API token (set MONDAY_API_KEY in .env)" });
    }

    // ── Step 1: Fetch Monday board columns once ───────────────
    // We fetch the column IDs at startup so we can map data to the right columns.
    console.log("\n📋 Fetching Monday board columns...");
    let columnMap = {};
    let columns   = [];
    try {
      const result = await fetchBoardColumns(token);
      columnMap    = result.columnMap;
      columns      = result.columns;
      console.log(`[sync] Board has ${columns.length} columns`);
      console.log(`[sync] Column titles: ${columns.map(c => `"${c.title}"`).join(", ")}`);
    } catch (err) {
      logger.warn(`[sync] Could not fetch board columns: ${err.message}`);
      logger.warn(`[sync] Will use hardcoded column ID fallbacks only`);
    }

    // ── Step 2: Fetch all LinkedIn posts from last 90 days ────
    const posts = await fetchLastThreeMonthsPosts();
    console.log(`\n✅ Total LinkedIn posts fetched: ${posts.length}`);

    if (posts.length === 0) {
      return res.json({
        success: true,
        summary: { total: 0, created: 0, updated: 0, unchanged: 0, failed: 0 },
        results: [],
      });
    }

    const results = [];

    // ── Step 3: Process each post — STRICTLY one at a time ────
    //
    // Do NOT convert this to Promise.all() — Monday Storage has rate limits
    // and the sequential await chain is what keeps everything correct.

    for (const post of posts) {
      const postId = post.id;
      console.log(`\n${"─".repeat(55)}`);
      console.log(`📌 Processing postId: ${postId}`);

      // Extract all metadata from the LinkedIn post object
      const details = extractPostDetails(post, post._resolvedAuthorName || "");
      console.log(`   Posted on  : ${details.createdAt}`);
      console.log(`   Author     : ${details.authorName}`);
      console.log(`   Post Type  : ${details.postType}`);
      console.log(`   Post URL   : ${details.postUrl}`);
      console.log(`   Text (60)  : ${details.text?.slice(0, 60)}...`);

      // Check Monday Storage — do we already have this post?
      // This must happen BEFORE fetchPostStats to keep the loop strictly sequential.
      const existingPost = await getStoredPost(token, postId);

      // Fetch the latest analytics from LinkedIn (called exactly ONCE per post)
      const analytics = await fetchPostStats(postId);
      console.log(`   Analytics  : likes=${analytics.likeCount} comments=${analytics.commentCount} impressions=${analytics.impressionCount} clicks=${analytics.clickCount} ctr=${analytics.ctr}%`);

      // ════════════════════════════════════════════════════════
      //  CASE 1: NEW POST — never seen in Monday Storage before
      // ════════════════════════════════════════════════════════
      if (!existingPost) {
        console.log(`   → 🆕 NEW POST`);

        const postObj = {
          postId,
          details,
          analytics,
          boardItemId: null,
          createdAt:   new Date().toISOString(),
          updatedAt:   new Date().toISOString(),
        };

        // (a) Save to Monday Storage first
        //     If this fails, we stop — no point creating a board item
        //     we can't track
        const saved = await savePostToStorage(token, postObj);
        if (!saved.success) {
          logger.error(`[sync] Storage save failed for ${postId}: ${saved.error}`);
          results.push({ postId, status: "SAVE_FAILED", error: saved.error });
          continue;
        }
        console.log(`   ✅ Saved to Monday Storage`);

        // (b) Create board item
        //     item_name = postId (shows in the "Post id" name column)
        //     All other columns filled via column_values
        let boardItemId = null;
        try {
          boardItemId = await createBoardItem(token, postObj, columnMap, columns);
          console.log(`   ✅ Created Monday Board item: ${boardItemId}`);
        } catch (boardErr) {
          logger.error(`[sync] Board create failed for ${postId}: ${boardErr.message}`);
          // Storage save succeeded — record partial success
          results.push({ postId, postedAt: details.createdAt, boardItemId: null, status: "CREATED_STORAGE_ONLY" });
          continue;
        }

        // (c) Save the Monday board item ID back to storage
        //     This lets future syncs update the right board row directly
        //     without having to search the board
        if (boardItemId) {
          await updatePostInStorage(token, postId, { ...postObj, boardItemId });
          console.log(`   ✅ boardItemId=${boardItemId} saved to Storage`);
        }

        results.push({
          postId,
          postedAt:    details.createdAt,
          boardItemId: boardItemId || null,
          status:      "CREATED",
        });

      // ════════════════════════════════════════════════════════
      //  CASE 2: EXISTING POST — check if analytics changed
      // ════════════════════════════════════════════════════════
      } else {
        const analyticsChanged = hasMetricsChanged(existingPost.analytics, analytics);

        if (analyticsChanged) {
          console.log(`   → ♻️  ANALYTICS CHANGED — updating`);
          console.log(`      Old: likes=${existingPost.analytics?.likeCount} impressions=${existingPost.analytics?.impressionCount} ctr=${existingPost.analytics?.ctr}`);
          console.log(`      New: likes=${analytics.likeCount} impressions=${analytics.impressionCount} ctr=${analytics.ctr}`);

          const updatedPost = {
            ...existingPost,
            analytics,
            updatedAt: new Date().toISOString(),
          };

          // (a) Update Monday Storage with new analytics
          const updated = await updatePostInStorage(token, postId, updatedPost);
          if (!updated.success) {
            logger.error(`[sync] Storage update failed for ${postId}`);
            results.push({ postId, status: "UPDATE_FAILED" });
            continue;
          }
          console.log(`   ✅ Updated Monday Storage`);

          // (b) Find the board item ID
          //     First try: use the stored boardItemId (fastest, no search needed)
          //     Fallback: search the board by postId in item name
          //     Last resort: create a fresh board item
          let boardItemId = existingPost.boardItemId || null;

          if (!boardItemId) {
            console.log(`   [board] boardItemId missing — searching board...`);
            boardItemId = await findBoardItemByPostId(token, postId);
            if (boardItemId) {
              // Save it so we don't need to search next time
              await updatePostInStorage(token, postId, { ...updatedPost, boardItemId });
              console.log(`   [board] Saved recovered boardItemId=${boardItemId}`);
            }
          }

          if (boardItemId) {
            try {
              await updateBoardItem(token, boardItemId, analytics, columnMap, columns);
              console.log(`   ✅ Updated Monday Board item: ${boardItemId}`);
            } catch (boardErr) {
              logger.error(`[sync] Board update failed for ${boardItemId}: ${boardErr.message}`);
            }
          } else {
            // No board item exists at all — create one now
            console.log(`   [board] No board item found — creating now`);
            try {
              boardItemId = await createBoardItem(token, updatedPost, columnMap, columns);
              await updatePostInStorage(token, postId, { ...updatedPost, boardItemId });
              console.log(`   ✅ Created missing board item: ${boardItemId}`);
            } catch (boardErr) {
              logger.error(`[sync] Board create (recovery) failed: ${boardErr.message}`);
            }
          }

          results.push({
            postId,
            postedAt:    details.createdAt,
            boardItemId: boardItemId || null,
            status:      "UPDATED",
          });

        } else {
          // ── CASE 3: UNCHANGED — analytics are identical ───
          console.log(`   → ⏭️  UNCHANGED — skipping`);
          results.push({
            postId,
            postedAt:    details.createdAt,
            boardItemId: existingPost.boardItemId || null,
            status:      "UNCHANGED",
          });
        }
      }
    } // ← end for — next post only starts after this one fully completes

    // ── Summary ───────────────────────────────────────────────
    const summary = {
      total:     results.length,
      created:   results.filter((r) => r.status === "CREATED" || r.status === "CREATED_STORAGE_ONLY").length,
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