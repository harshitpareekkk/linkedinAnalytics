/**
 * sync.controller.js
 *
 * ─── END TO END FLOW ────────────────────────────────────────────────────────
 *
 * Triggered by Monday automation → JWT decoded by authorizeRequest middleware
 * → shortLivedToken extracted → LinkedIn posts synced to Monday Storage + Board
 *
 *   1. Decode token from JWT (done by authorizeRequest middleware)
 *   2. Test token has access to the board (catches bad tokens early)
 *   3. Fetch board columns (so we know which column gets which data)
 *   4. Fetch LinkedIn posts from last 90 days
 *   5. For each post (STRICTLY one at a time — no parallel):
 *
 *      NEW POST:
 *        a. Check storage → NOT FOUND
 *        b. Fetch analytics from LinkedIn
 *        c. Save to Monday Storage
 *        d. Create row on Monday Board (item_name = postId)
 *        e. Save boardItemId back to storage
 *
 *      EXISTING, analytics changed:
 *        a. Check storage → FOUND
 *        b. Fetch analytics
 *        c. Update storage
 *        d. Update board analytics columns only
 *
 *      EXISTING, unchanged:
 *        → Skip
 *
 * ─── TOKEN ──────────────────────────────────────────────────────────────────
 *   shortLivedToken comes from JWT decoded in authorizeRequest.
 *   It is set via setMondayToken() for Board API calls.
 *   It is passed directly to Storage SDK as new Storage(token).
 *
 * ─── WHY SEQUENTIAL ─────────────────────────────────────────────────────────
 *   Monday Storage has rate limits. Promise.all() causes responses to
 *   interleave — storage for post A resolves while processing post B.
 *   The for...of + await loop ensures each post fully completes before next.
 */

import {
  fetchLastThreeMonthsPosts,
  fetchPostStats,
  extractPostDetails,
}                                    from "../services/linkedin.service.js";
import {
  getStoredPost,
  savePostToStorage,
  updatePostInStorage,
}                                    from "../services/monday.storage.service.js";
import {
  fetchBoardColumns,
  createBoardItem,
  updateBoardItem,
  findBoardItemByPostId,
  testMondayAccess,
}                                    from "../services/monday.board.service.js";
import { hasMetricsChanged }         from "../utils/diff.util.js";
import { logger }                    from "../utils/logger.js";
import { StatusCodes }              from "../constants/statusCodes.constants.js";
import { MESSAGES }                  from "../constants/messages.constant.js";

export const syncLinkedInPosts = async (req, res) => {
  try {
    console.log("\n" + "=".repeat(60));
    console.log("🚀 SYNC STARTED — Last 3 Months Posts");
    console.log("=".repeat(60));

    // ── Token ─────────────────────────────────────────────────
    // shortLivedToken is set by authorizeRequest middleware after JWT decode.
    // It gives us access to the Monday Board API (via SDK) and Storage SDK.
    const shortLivedToken = req.session?.shortLivedToken;

    if (!shortLivedToken) {
      logger.error("[sync] No shortLivedToken in session — JWT decode may have failed");
      return res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        error:   MESSAGES.NOT_AUTHENTICATED,
      });
    }

    logger.info(`[sync] ✅ Token ready | accountId=${req.session?.accountId}`);

    // ── Board ID ──────────────────────────────────────────────
    // Source priority: Monday automation inputFields → .env MONDAY_BOARD_ID
    const boardId = String(
      req.body?.payload?.inputFields?.boardId ||
      process.env.MONDAY_BOARD_ID ||
      ""
    );

    if (!boardId) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error:   "Missing boardId — set MONDAY_BOARD_ID in .env or pass via automation inputFields",
      });
    }

    const boardSource = req.body?.payload?.inputFields?.boardId
      ? "Monday automation inputFields"
      : ".env MONDAY_BOARD_ID";
    logger.info(`[sync] Board ID: ${boardId} (from ${boardSource})`);

    // ── Token / board access test ─────────────────────────────
    // testMondayAccess now queries the board directly (not "me") so it works
    // with shortLivedTokens that don't have "me" query access.
    try {
      await testMondayAccess(shortLivedToken, boardId);
    } catch (err) {
      logger.error(`[sync] Board access test failed: ${err.message}`);
      return res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        error:   `Cannot access board ${boardId}: ${err.message}`,
      });
    }

    // ── Step 1: Fetch board columns ───────────────────────────
    // Using inline board ID in the query (no GraphQL variables for boards query)
    // to avoid "Unauthorized field or type" errors across Monday API versions.
    console.log("\n📋 Fetching Monday board columns...");
    let columns   = [];
    let columnMap = {};
    try {
      ({ columns, columnMap } = await fetchBoardColumns(shortLivedToken, boardId));
      console.log(`✅ Fetched ${columns.length} board columns`);
    } catch (err) {
      logger.error(`[sync] Board columns fetch failed: ${err.message}`);
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        error:   `Board columns fetch failed: ${err.message}`,
      });
    }

    // ── Step 2: Fetch LinkedIn posts ──────────────────────────
    console.log("\n🔗 Fetching LinkedIn posts (last 90 days)...");
    const posts = await fetchLastThreeMonthsPosts();
    console.log(`✅ Total posts fetched: ${posts.length}`);

    if (posts.length === 0) {
      return res.json({
        success: true,
        summary: { total: 0, created: 0, updated: 0, unchanged: 0, failed: 0 },
        results: [],
      });
    }

    const results = [];

    // ── Step 3: Process each post — STRICTLY one at a time ────
    for (const post of posts) {
      const postId = post.id;
      console.log(`\n${"─".repeat(50)}`);
      console.log(`📌 Processing: ${postId}`);

      const details = extractPostDetails(post, post._resolvedAuthorName || "");
      console.log(`   Posted on  : ${details.createdAt}`);
      console.log(`   Author     : ${details.authorName}`);
      console.log(`   Post Type  : ${details.postType}`);
      console.log(`   Text (60)  : ${(details.text || "").slice(0, 60)}...`);

      // Storage check FIRST — before analytics fetch — keeps loop strictly sequential
      const existingPost = await getStoredPost(shortLivedToken, postId);

      // Fetch analytics once per post
      const analytics = await fetchPostStats(postId);
      console.log(`   Analytics  : likes=${analytics.likeCount} impressions=${analytics.impressionCount} clicks=${analytics.clickCount} ctr=${analytics.ctr}%`);

      // ════════════════════════════════════════════════════════
      //  NEW POST
      // ════════════════════════════════════════════════════════
      if (!existingPost) {
        console.log(`   → 🆕 NEW POST`);

        const postObj = {
          postId,
          details,
          analytics,
          boardItemId: null,
          boardId,
          createdAt:   new Date().toISOString(),
          updatedAt:   new Date().toISOString(),
        };

        // (a) Save to Monday Storage
        const saved = await savePostToStorage(shortLivedToken, postObj);
        if (!saved.success) {
          logger.error(`[sync] Storage save failed for ${postId}: ${saved.error}`);
          results.push({ postId, postedAt: details.createdAt, status: "SAVE_FAILED" });
          continue;
        }
        console.log(`   ✅ Saved to Monday Storage`);

        // (b) Create board row  (item_name = postId)
        let boardItemId = null;
        try {
          boardItemId = await createBoardItem(shortLivedToken, postObj, columnMap, columns, boardId);
          console.log(`   ✅ Created board item: ${boardItemId}`);
        } catch (err) {
          logger.error(`   ❌ Board create failed for ${postId}: ${err.message}`);
        }

        // (c) Save boardItemId to storage so next sync can update directly
        if (boardItemId) {
          await updatePostInStorage(shortLivedToken, postId, { ...postObj, boardItemId });
          console.log(`   ✅ boardItemId=${boardItemId} saved to Storage`);
        }

        results.push({
          postId,
          postedAt:    details.createdAt,
          boardItemId: boardItemId || null,
          status:      boardItemId ? "CREATED" : "CREATED_STORAGE_ONLY",
        });

      // ════════════════════════════════════════════════════════
      //  EXISTING POST
      // ════════════════════════════════════════════════════════
      } else {
        const analyticsChanged = hasMetricsChanged(existingPost.analytics, analytics);

        if (analyticsChanged) {
          console.log(`   → ♻️  ANALYTICS CHANGED`);
          console.log(`      Old: likes=${existingPost.analytics?.likeCount} impressions=${existingPost.analytics?.impressionCount}`);
          console.log(`      New: likes=${analytics.likeCount} impressions=${analytics.impressionCount}`);

          const updatedPost = {
            ...existingPost,
            analytics,
            updatedAt: new Date().toISOString(),
          };

          // Update storage
          await updatePostInStorage(shortLivedToken, postId, updatedPost);
          console.log(`   ✅ Storage updated`);

          // Find board item ID
          let boardItemId = existingPost.boardItemId || null;
          if (!boardItemId) {
            console.log(`   ⚠️  No boardItemId in storage — searching board...`);
            boardItemId = await findBoardItemByPostId(shortLivedToken, postId, boardId);
            if (boardItemId) {
              await updatePostInStorage(shortLivedToken, postId, { ...updatedPost, boardItemId });
            }
          }

          if (boardItemId) {
            try {
              await updateBoardItem(shortLivedToken, boardItemId, analytics, columnMap, columns, boardId);
              console.log(`   ✅ Board item updated: ${boardItemId}`);
            } catch (err) {
              logger.error(`   ❌ Board update failed: ${err.message}`);
            }
          } else {
            // No board item found — create one now as recovery
            console.log(`   [board] No item found — creating as recovery`);
            try {
              boardItemId = await createBoardItem(shortLivedToken, updatedPost, columnMap, columns, boardId);
              await updatePostInStorage(shortLivedToken, postId, { ...updatedPost, boardItemId });
              console.log(`   ✅ Created missing board item: ${boardItemId}`);
            } catch (err) {
              logger.error(`   ❌ Board create (recovery) failed: ${err.message}`);
            }
          }

          results.push({
            postId,
            postedAt:    details.createdAt,
            boardItemId: boardItemId || null,
            status:      "UPDATED",
          });

        } else {
          console.log(`   → ⏭️  UNCHANGED`);
          results.push({
            postId,
            postedAt:    details.createdAt,
            boardItemId: existingPost.boardItemId || null,
            status:      "UNCHANGED",
          });
        }
      }
    } // ← each post fully completes before next starts

    // ── Summary ───────────────────────────────────────────────
    const summary = {
      total:     results.length,
      created:   results.filter((r) => r.status === "CREATED" || r.status === "CREATED_STORAGE_ONLY").length,
      updated:   results.filter((r) => r.status === "UPDATED").length,
      unchanged: results.filter((r) => r.status === "UNCHANGED").length,
      failed:    results.filter((r) => r.status.includes("FAILED")).length,
    };

    console.log(`\n${"=".repeat(60)}`);
    console.log("📊 SYNC SUMMARY:", summary);
    console.log("=".repeat(60));

    return res.json({ success: true, summary, results });

  } catch (err) {
    logger.error(`[sync] ❌ SYNC ERROR: ${err.message}`);
    console.error(err);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error:   err.message,
    });
  }
};