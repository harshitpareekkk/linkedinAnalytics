import express from "express";
import dotenv from "dotenv";
import analyticsRoutes from "./src/routes/analytics.routes.js";

dotenv.config();

const app = express();
app.use(express.json());

// Register Routes
app.use("/api", analyticsRoutes);

app.listen(5000, () => {
  console.log("Server running on port 5000...");
  console.log("ENV CHECK:", {
    token: process.env.LINKEDIN_ACCESS_TOKEN?.slice(0, 20) + "...",
    org: process.env.LINKEDIN_ORG_ID,
    board: process.env.MONDAY_BOARD_ID
  });
});
