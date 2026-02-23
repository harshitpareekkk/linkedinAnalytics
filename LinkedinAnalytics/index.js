import dotenv from "dotenv";
dotenv.config();

import express from "express";
import syncRoutes from "./src/routes/sync.routes.js";

const app = express();
app.use(express.json());
app.use("/api", syncRoutes);

const PORT = process.env.PORT || 4000;

// Debug checks
console.log("=".repeat(50));
console.log("🔧 ENVIRONMENT CHECK");
console.log("=".repeat(50));
console.log("✅ MONDAY_API_KEY:", process.env.MONDAY_API_KEY ? "Present" : "❌ Missing");
console.log("✅ MONDAY_BOARD_ID:", process.env.MONDAY_BOARD_ID ? "Present" : "❌ Missing");
console.log("✅ LINKEDIN_ACCESS_TOKEN:", process.env.LINKEDIN_ACCESS_TOKEN ? "Present" : "❌ Missing");
console.log("✅ LINKEDIN_ORG_ID:", process.env.LINKEDIN_ORG_ID ? "Present" : "❌ Missing");
console.log("=".repeat(50));

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Sync endpoint: http://localhost:${PORT}/api/sync`);
});