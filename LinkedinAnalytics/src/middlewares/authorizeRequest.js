import jwt from "jsonwebtoken";
import { logger } from "../utils/logger.js";
import { MESSAGES } from "../constants/messages.constant.js";
import { StatusCodes } from "../constants/statusCodes.constants.js";

export const authorizeRequest = async (req, res, next) => {
  try {
    let { authorization } = req.headers;

    // Also support ?token= query param
    if (!authorization && req.query?.token) {
      authorization = req.query.token;
    }

    if (!authorization || typeof authorization !== "string") {
      logger.error("[Auth] No authorization header");
      return res.status(StatusCodes.UNAUTHORIZED).json({
        error: MESSAGES.NOT_AUTHENTICATED,
      });
    }

    // Strip "Bearer " prefix if present
    if (authorization.startsWith("Bearer ")) {
      authorization = authorization.slice(7);
    }

    // Get signing secret from env
    const signingSecret = process.env.MONDAY_SIGNING_SECRET;
    if (!signingSecret) {
      logger.error("[Auth] MONDAY_SIGNING_SECRET not set in .env");
      return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        error: "MONDAY_SIGNING_SECRET not configured",
      });
    }

    // Decode JWT → extract shortLivedToken, accountId, userId
    const { accountId, userId, backToUrl, shortLivedToken } = jwt.verify(
      authorization,
      signingSecret
    );

    // Attach to req.session so controller can use it
    req.session = { accountId, userId, backToUrl, shortLivedToken };

    logger.info(`[Auth] ✅ Authorized — accountId=${accountId} userId=${userId}`);
    next();

  } catch (err) {
    logger.error(`[Auth] JWT verification failed: ${err.message}`);
    return res.status(STATUS_CODES.UNAUTHORIZED).json({
      error: MESSAGES.NOT_AUTHENTICATED,
    });
  }
};