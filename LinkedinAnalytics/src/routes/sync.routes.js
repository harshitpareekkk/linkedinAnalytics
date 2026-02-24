/**
 * sync.routes.js
 *
 * POST   /api/sync                → Sync last 3 months LinkedIn posts to Monday Storage
 * GET    /api/storage             → Get ALL stored posts (complete info)
 * GET    /api/storage/:postId     → Get ONE post complete info by postId
 * DELETE /api/storage             → Delete all stored posts
 * DELETE /api/storage/:postId     → Delete one post by postId
 */

import express from "express";
import { syncLinkedInPosts } from "../controllers/sync.controller.js";
import {
  getAllStoredPosts,
  getStoredPost,
  deleteAllStoredPosts,
  deleteStoredPost,
} from "../services/monday.storage.service.js";

const router = express.Router();

const getToken = (req) =>
  req.headers.authorization?.replace("Bearer ", "") || process.env.MONDAY_API_KEY;

// Shape a raw stored post into a clean API response
const formatPost = (post) => ({
  postId: post.postId,
  details: {
    text:      post.details?.text      || "",
    postType:  post.details?.postType  || "",
    postUrl:   post.details?.postUrl   || "",
    owner:     post.details?.owner     || "",
    createdAt: post.details?.createdAt || "",
  },
  analytics: {
    likeCount:              post.analytics?.likeCount              ?? 0,
    commentCount:           post.analytics?.commentCount           ?? 0,
    impressionCount:        post.analytics?.impressionCount        ?? 0,
    uniqueImpressionsCount: post.analytics?.uniqueImpressionsCount ?? 0,
    shareCount:             post.analytics?.shareCount             ?? 0,
    clickCount:             post.analytics?.clickCount             ?? 0,
    engagement:             post.analytics?.engagement             ?? 0,
  },
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
});

// ── POST /api/sync ─────────────────────────────────────────────────────────────
router.post("/sync", syncLinkedInPosts);

// ── GET /api/storage ───────────────────────────────────────────────────────────
router.get("/storage", async (req, res) => {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: "Missing Monday API token" });

    const posts   = await getAllStoredPosts(token);
    const entries = posts.map(formatPost);

    res.status(200).json({ success: true, total: entries.length, entries });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/storage/:postId ───────────────────────────────────────────────────
router.get("/storage/:postId", async (req, res) => {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: "Missing Monday API token" });

    const post = await getStoredPost(token, req.params.postId);
    if (!post) return res.status(404).json({ success: false, error: "Post not found" });

    res.status(200).json({ success: true, post: formatPost(post) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/storage ────────────────────────────────────────────────────────
router.delete("/storage", async (req, res) => {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: "Missing Monday API token" });
    const result = await deleteAllStoredPosts(token);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/storage/:postId
router.delete("/storage/:postId", async (req, res) => {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: "Missing Monday API token" });
    const result = await deleteStoredPost(token, req.params.postId);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;