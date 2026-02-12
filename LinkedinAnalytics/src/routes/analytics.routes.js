import express from "express";
import { syncLinkedInPosts } from "../controllers/analytics.controller.js";

const router = express.Router();

router.get("/sync", syncLinkedInPosts);

export default router;
