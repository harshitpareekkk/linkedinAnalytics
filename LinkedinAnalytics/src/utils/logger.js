// Simple logger utility for consistent logging
// Usage: import { logger } from '../utils/logger.js';

export const logger = {
  info: (...args) => {
    console.log("[INFO]", ...args);
  },
  warn: (...args) => {
    console.warn("[WARN]", ...args);
  },
  error: (...args) => {
    console.error("[ERROR]", ...args);
  },
  debug: (...args) => {
    if (process.env.DEBUG === "true") {
      console.debug("[DEBUG]", ...args);
    }
  }
};