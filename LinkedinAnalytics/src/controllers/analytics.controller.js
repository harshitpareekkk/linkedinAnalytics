import {
  fetchSharePosts,
  fetchPostStats,
} from "../services/linkedin.service.js";
import { pushToMonday } from "../services/monday.service.js";

export const syncLinkedInPosts = async (req, res) => {
  try {
    console.log("Fetching latest 50 SHARE posts...");
    const posts = await fetchSharePosts();
    for (const post of posts) {
      console.log("Processing Post →", post.id);

      const stats = await fetchPostStats(post.id);
      console.log("Post Stats →", stats);
      await pushToMonday(post, stats);
    }

    console.log("✅ Monday boards data push is done");
    res.json({
      message: `Successfully synced ${posts.length} posts`,
    });
  } catch (err) {
    console.error("Sync Error:", err);
    res.status(500).json({ error: err.message });
  }
};
