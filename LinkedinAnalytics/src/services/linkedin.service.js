import axios from "axios";

const BASE = "https://api.linkedin.com/v2";

/** Extract full post metadata */
export const extractPostDetails = (post) => {
  return {
    postId: post.id,
    text: post?.text?.text || "",
    postType: post?.content?.shareMediaCategory || "UNKNOWN",
    postUrl: post?.content?.contentEntities?.[0]?.entity || "",
    owner: post.owner || "",
    createdAt: post?.created?.time
      ? new Date(post.created.time).toISOString()
      : null,
  };
};

/** Fetch EXACT 15 LinkedIn share posts */
export const fetchLatestPosts = async () => {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const orgId = process.env.LINKEDIN_ORG_ID;

  const required = 15;
  const pageSize = 50;

  let start = 0;
  let collected = [];
  let hasMore = true;

  while (collected.length < required && hasMore) {
    const url = `${BASE}/shares?q=owners&owners=${orgId}&count=${pageSize}&start=${start}`;

    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const elements = res.data.elements || [];

    const valid = elements.filter(
      (p) => p?.id && p?.content && p?.text
    );

    collected.push(...valid);

    if (!res.data.paging?.next) hasMore = false;

    start += pageSize;
  }

  return collected.slice(0, required);
};

/** Fetch LinkedIn analytics for a post */
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
        likeCount: 0,
        commentCount: 0,
        impressionCount: 0,
        uniqueImpressionsCount: 0,
        shareCount: 0,
        clickCount: 0,
        engagement: 0,
      }
    );
  } catch (err) {
    console.error("LinkedIn Analytics Error:", err.message);
    return {
      likeCount: 0,
      commentCount: 0,
      impressionCount: 0,
      uniqueImpressionsCount: 0,
      shareCount: 0,
      clickCount: 0,
      engagement: 0,
    };
  }
};