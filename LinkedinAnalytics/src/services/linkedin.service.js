import axios from "axios";

const BASE      = "https://api.linkedin.com/v2";
const PAGE_SIZE = 50;

// ─── Author name cache ────────────────────────────────────────────────────────
// Avoids calling the people API more than once per author per run
const authorCache = {};

/**
 * Fetch a LinkedIn member's full name by their URN.
 * urn:li:person:abc123  →  "Shubham Mehta"
 */
const fetchAuthorName = async (token, authorUrn) => {
  if (!authorUrn)                return "";
  if (authorCache[authorUrn])    return authorCache[authorUrn];

  try {
    const memberId = authorUrn.split(":").pop();   // "abc123"
    const res = await axios.get(`${BASE}/people/(id:${memberId})`, {
      headers: { Authorization: `Bearer ${token}` },
      params:  { projection: "(id,firstName,lastName)" },
    });

    const data  = res.data || {};
    const first = data.firstName?.localized
      ? Object.values(data.firstName.localized)[0] : "";
    const last  = data.lastName?.localized
      ? Object.values(data.lastName.localized)[0]  : "";

    const name = `${first} ${last}`.trim() || authorUrn;
    authorCache[authorUrn] = name;
    console.log(`[linkedin] Author resolved: ${authorUrn} → "${name}"`);
    return name;

  } catch (err) {
    // People API may return 403 if no profile access — gracefully fall back to URN
    console.warn(`[linkedin] Could not fetch author for ${authorUrn}: ${err.message}`);
    authorCache[authorUrn] = authorUrn;
    return authorUrn;
  }
};

// ─── Extract post details ─────────────────────────────────────────────────────

/**
 * Build the details object from a raw LinkedIn share element.
 *
 * KEY FIX: postUrl is the REAL LinkedIn URL, NOT the media asset URN.
 *   Correct: https://www.linkedin.com/feed/update/urn:li:share:7431996441511907329
 *   Wrong  : urn:li:digitalmediaAsset:D5622AQ...  ← was being stored before
 *
 * authorId comes from post.author (the person who clicked "post")
 * owner    is the org URN (urn:li:organization:219773)
 */
export const extractPostDetails = (post, resolvedAuthorName = "") => {
  const postId = post.id;

  return {
    postId,
    // FULL text — not .slice(), not truncated in any way
    text:       post?.text?.text || "",
    postType:   post?.content?.shareMediaCategory || "TEXT",
    // Real post URL for clicking through from Monday board
    postUrl:    `https://www.linkedin.com/feed/update/urn:li:share:${postId}`,
    owner:      post.owner  || "",
    authorId:   post.author || post.owner || "",   // person URN who posted
    authorName: resolvedAuthorName || post.author || post.owner || "",
    createdAt:  post?.created?.time
      ? new Date(post.created.time).toISOString()
      : null,
  };
};

// ─── Fetch last 3 months posts ────────────────────────────────────────────────

export const fetchLastThreeMonthsPosts = async () => {
  const token    = process.env.LINKEDIN_ACCESS_TOKEN;
  const orgId    = process.env.LINKEDIN_ORG_ID;

  const cutoffMs = Date.now() - (90 * 24 * 60 * 60 * 1000);
  console.log(`[linkedin] Today        : ${new Date().toISOString()}`);
  console.log(`[linkedin] Cutoff (90d) : ${new Date(cutoffMs).toISOString()}`);

  const collected = [];
  let start      = 0;
  let pageCount  = 0;
  let totalPosts = null;
  let stop       = false;

  while (!stop) {
    pageCount++;
    const url = `${BASE}/shares?q=owners&owners=${orgId}&count=${PAGE_SIZE}&start=${start}`;
    console.log(`\n[linkedin] Fetching page ${pageCount} (start=${start})...`);

    let res;
    try {
      res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error(`[linkedin] Page ${pageCount} error:`, err?.response?.data || err.message);
      break;
    }

    const elements = res.data?.elements || [];

    if (pageCount === 1 && res.data?.paging?.total !== undefined) {
      totalPosts = res.data.paging.total;
      console.log(`[linkedin] LinkedIn total posts for this org: ${totalPosts}`);
    }

    console.log(`[linkedin] Page ${pageCount}: got ${elements.length} posts`);

    if (elements.length === 0) { break; }

    for (const post of elements) {
      const postTimeMs = post?.created?.time ?? 0;
      const postDate   = postTimeMs ? new Date(postTimeMs).toISOString() : "no-date";

      if (postTimeMs > 0 && postTimeMs < cutoffMs) {
        console.log(`[linkedin] ⛔ ${post.id} | ${postDate} → OLDER THAN 90 DAYS — STOP`);
        stop = true;
        break;
      }

      console.log(`[linkedin] ✅ ${post.id} | ${postDate}`);
      collected.push(post);
    }

    if (stop) break;

    start += PAGE_SIZE;
    if (totalPosts !== null && start >= totalPosts) {
      console.log(`[linkedin] Reached end (start=${start} >= total=${totalPosts})`);
      break;
    }
  }

  // ── Resolve all author names in bulk (one API call per unique author) ──
  console.log(`\n[linkedin] Resolving author names for ${collected.length} posts...`);
  const uniqueAuthorUrns = [...new Set(
    collected.map((p) => p.author || p.owner).filter(Boolean)
  )];
  for (const urn of uniqueAuthorUrns) {
    await fetchAuthorName(token, urn);
  }

  console.log(`\n[linkedin] ✅ Total posts collected (last 90 days): ${collected.length}`);
  if (collected.length > 0) {
    const newest = new Date(collected[0]?.created?.time).toISOString();
    const oldest = new Date(collected[collected.length - 1]?.created?.time).toISOString();
    console.log(`[linkedin] Range: ${oldest} → ${newest}`);
  }

  // Attach resolved author name onto each post so extractPostDetails can use it
  return collected.map((post) => ({
    ...post,
    _resolvedAuthorName: authorCache[post.author || post.owner] || "",
  }));
};

// ─── Fetch post analytics ─────────────────────────────────────────────────────

/**
 * Fetch share statistics + compute CTR.
 *
 * CTR = (clickCount / impressionCount) × 100
 * Stored as percentage, e.g. 8.65 means 8.65%
 */
export const fetchPostStats = async (postId) => {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const orgId = process.env.LINKEDIN_ORG_ID;

  const url = `${BASE}/organizationalEntityShareStatistics?q=organizationalEntity` +
              `&organizationalEntity=${orgId}&shares=urn:li:share:${postId}`;

  try {
    const res   = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const stats = res.data.elements?.[0]?.totalShareStatistics || {};

    const impressionCount        = stats.impressionCount        ?? 0;
    const clickCount             = stats.clickCount             ?? 0;

    // CTR as a percentage (2 decimal places)
    const ctr = impressionCount > 0
      ? parseFloat(((clickCount / impressionCount) * 100).toFixed(2))
      : 0;

    return {
      likeCount:              stats.likeCount              ?? 0,
      commentCount:           stats.commentCount           ?? 0,
      impressionCount,
      uniqueImpressionsCount: stats.uniqueImpressionsCount ?? 0,
      shareCount:             stats.shareCount             ?? 0,
      clickCount,
      engagement:             parseFloat((stats.engagement  ?? 0).toFixed(6)),
      ctr,
    };

  } catch (err) {
    console.error(`[linkedin] Analytics error for ${postId}:`, err.message);
    return {
      likeCount: 0, commentCount: 0, impressionCount: 0,
      uniqueImpressionsCount: 0, shareCount: 0, clickCount: 0,
      engagement: 0, ctr: 0,
    };
  }
};