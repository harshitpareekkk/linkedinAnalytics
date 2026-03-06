/**
 * testStorageRaw.js
 *
 * Verifies that JSON.stringify/parse approach works correctly with the SDK.
 * Run:  node testStorageRaw.js
 */

import dotenv from "dotenv";
dotenv.config();

import { Storage } from "@mondaycom/apps-sdk";

const TOKEN = process.env.MONDAY_API_KEY;
const SHARED = { shared: true };
const storage = new Storage(TOKEN);

const run = async () => {
  console.log("\n" + "=".repeat(60));
  console.log("🔬 STORAGE VERIFICATION TEST");
  console.log("=".repeat(60));

  // ── TEST 1: Store and retrieve an object ─────────────────────
  console.log("\n--- TEST 1: Object round-trip ---");
  const obj = { postId: "abc123", likes: 42, comments: 5 };
  await storage.set("test_obj", JSON.stringify(obj), SHARED);
  const res1 = await storage.get("test_obj", SHARED);
  const parsed1 = JSON.parse(res1.value);
  console.log("Stored:", obj);
  console.log("Retrieved:", parsed1);
  console.log("Match:", JSON.stringify(obj) === JSON.stringify(parsed1) ? "✅ PASS" : "❌ FAIL");

  // ── TEST 2: Store and retrieve an array ──────────────────────
  console.log("\n--- TEST 2: Array round-trip ---");
  const arr = ["id1", "id2", "id3"];
  await storage.set("test_arr", JSON.stringify(arr), SHARED);
  const res2 = await storage.get("test_arr", SHARED);
  const parsed2 = JSON.parse(res2.value);
  console.log("Stored:", arr);
  console.log("Retrieved:", parsed2);
  console.log("Is Array:", Array.isArray(parsed2) ? "✅ PASS" : "❌ FAIL");
  console.log("Match:", JSON.stringify(arr) === JSON.stringify(parsed2) ? "✅ PASS" : "❌ FAIL");

  // ── TEST 3: Full post object ──────────────────────────────────
  console.log("\n--- TEST 3: Full post object ---");
  const post = {
    postId: "7428052441641930753",
    details: { text: "Test post", postType: "RICH", createdAt: "2026-01-01T00:00:00Z" },
    analytics: { likeCount: 10, commentCount: 2, impressionCount: 500, clickCount: 20 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await storage.set("post_7428052441641930753", JSON.stringify(post), SHARED);
  const res3 = await storage.get("post_7428052441641930753", SHARED);
  const parsed3 = JSON.parse(res3.value);
  console.log("Post stored ✅");
  console.log("Post retrieved:", parsed3.postId === post.postId ? "✅ PASS" : "❌ FAIL");
  console.log("Analytics correct:", parsed3.analytics.likeCount === 10 ? "✅ PASS" : "❌ FAIL");

  // ── TEST 4: Update analytics ──────────────────────────────────
  console.log("\n--- TEST 4: Update analytics ---");
  parsed3.analytics.likeCount = 99;
  parsed3.updatedAt = new Date().toISOString();
  await storage.set("post_7428052441641930753", JSON.stringify(parsed3), SHARED);
  const res4 = await storage.get("post_7428052441641930753", SHARED);
  const parsed4 = JSON.parse(res4.value);
  console.log("Updated likes:", parsed4.analytics.likeCount === 99 ? "✅ PASS" : "❌ FAIL");

  // ── CLEANUP ───────────────────────────────────────────────────
  console.log("\n--- CLEANUP ---");
  await storage.delete("test_obj", SHARED);
  await storage.delete("test_arr", SHARED);
  await storage.delete("post_7428052441641930753", SHARED);
  console.log("Cleaned up ✅");

  console.log("\n" + "=".repeat(60));
  console.log("✅ ALL TESTS DONE — if all PASS, the service will work correctly");
  console.log("=".repeat(60) + "\n");
};

run().catch(console.error);