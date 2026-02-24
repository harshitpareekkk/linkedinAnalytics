import axios from "axios";

const BASE = "https://api.linkedin.com/v2";
const PAGE_SIZE = 50;

const getCutoffMs = () => {
  const cutoffMs = Date.now() - (90 * 24 * 60 * 60 * 1000);
  console.log(`[linkedin] Today        : ${new Date().toISOString()}`);
  console.log(`[linkedin] Cutoff (90d) : ${new Date(cutoffMs).toISOString()}`);
  return cutoffMs;
};

export const extractPostDetails = (post) => ({
  postId:    post.id,
  text:      post?.text?.text || "",
  postType:  post?.content?.shareMediaCategory || "UNKNOWN",
  postUrl:   post?.content?.contentEntities?.[0]?.entity || "",
  owner:     post.owner || "",
  createdAt: post?.created?.time
    ? new Date(post.created.time).toISOString()
    : null,
});

export const fetchLastThreeMonthsPosts = async () => {
  const token    = process.env.LINKEDIN_ACCESS_TOKEN;
  const orgId    = process.env.LINKEDIN_ORG_ID;
  const cutoffMs = getCutoffMs();

  const collected = [];
  let start       = 0;
  let pageCount   = 0;
  let totalPosts  = null; // will be set from first response
  let stop        = false;

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
      console.error(`[linkedin] Error on page ${pageCount}:`, err?.response?.data || err.message);
      break;
    }

    const elements = res.data?.elements || [];

    // Capture total from first page
    if (pageCount === 1 && res.data?.paging?.total !== undefined) {
      totalPosts = res.data.paging.total;
      console.log(`[linkedin] LinkedIn total posts for this org: ${totalPosts}`);
    }

    console.log(`[linkedin] Page ${pageCount}: got ${elements.length} posts`);

    // Safety — empty page means nothing left
    if (elements.length === 0) {
      console.log(`[linkedin] Empty page — stopping`);
      break;
    }

    // Check each post against the 90-day cutoff
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

    // Move to next page
    start += PAGE_SIZE;

    // Stop if we've gone past the total number of posts LinkedIn has
    if (totalPosts !== null && start >= totalPosts) {
      console.log(`[linkedin] Reached end of all posts (start=${start} >= total=${totalPosts})`);
      break;
    }
  }

  console.log(`\n[linkedin] ✅ Total posts collected (last 90 days): ${collected.length}`);
  if (collected.length > 0) {
    const newest = new Date(collected[0]?.created?.time).toISOString();
    const oldest = new Date(collected[collected.length - 1]?.created?.time).toISOString();
    console.log(`[linkedin] Range: ${oldest} → ${newest}`);
  }

  return collected;
};

export const fetchPostStats = async (postId) => {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const orgId = process.env.LINKEDIN_ORG_ID;

  const url = `${BASE}/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${orgId}&shares=urn:li:share:${postId}`;

  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    return (
      res.data.elements?.[0]?.totalShareStatistics || {
        likeCount:              0,
        commentCount:           0,
        impressionCount:        0,
        uniqueImpressionsCount: 0,
        shareCount:             0,
        clickCount:             0,
        engagement:             0,
      }
    );
  } catch (err) {
    console.error(`[linkedin] Analytics error for ${postId}:`, err.message);
    return {
      likeCount:              0,
      commentCount:           0,
      impressionCount:        0,
      uniqueImpressionsCount: 0,
      shareCount:             0,
      clickCount:             0,
      engagement:             0,
    };
  }
};