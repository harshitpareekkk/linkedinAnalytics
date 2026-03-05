import express from "express";
import { authorizeRequest } from "../middlewares/authorizeRequest.js";
import { syncLinkedInPosts } from "../controllers/sync.controller.js";
import {
  getAllStoredPosts,
  getStoredPost,
  deleteAllStoredPosts,
  deleteStoredPost,
} from "../services/monday.storage.service.js";

const router = express.Router();


// Extract token: shortLivedToken from session (set by authorizeRequest)
// or fallback to Authorization header or .env for Postman testing
const getToken = (req) =>
  req.session?.shortLivedToken ||
  req.headers.authorization?.replace("Bearer ", "") ||
  process.env.MONDAY_API_KEY;

const formatPost = (post) => ({
  postId: post.postId,
  boardItemId: post.boardItemId || null,
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
    ctr:                    post.analytics?.ctr                    ?? 0,
  },
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
});

// ── POST /api/sync ─────────────────────────────────────────
router.post("/sync", authorizeRequest, syncLinkedInPosts);

// ── GET /api/storage ───────────────────────────────────────
router.get("/storage", authorizeRequest, async (req, res) => {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: "Missing token" });
    const posts   = await getAllStoredPosts(token);
    const entries = posts.map(formatPost);
    res.status(200).json({ success: true, total: entries.length, entries });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/storage/:postId ───────────────────────────────
router.get("/storage/:postId", authorizeRequest, async (req, res) => {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: "Missing token" });
    const post = await getStoredPost(token, req.params.postId);
    if (!post) return res.status(404).json({ success: false, error: "Post not found" });
    res.status(200).json({ success: true, post: formatPost(post) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/storage ────────────────────────────────────
router.delete("/storage", authorizeRequest, async (req, res) => {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: "Missing token" });
    const result = await deleteAllStoredPosts(token);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/storage/:postId ────────────────────────────
router.delete("/storage/:postId", authorizeRequest, async (req, res) => {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: "Missing token" });
    const result = await deleteStoredPost(token, req.params.postId);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;