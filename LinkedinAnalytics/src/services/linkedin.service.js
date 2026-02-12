import axios from "axios";

export const fetchSharePosts = async () => {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const orgId = process.env.LINKEDIN_ORG_ID;

  const url = `https://api.linkedin.com/v2/shares?q=owners&owners=${orgId}&count=50`;

  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  // LinkedIn returns BOTH share + UGC
  const posts = (res.data.elements || []).filter(
    p => p && p.content && p.id // remove UGC & invalid items
  );

  console.log("Total valid SHARE posts:", posts.length);

  return posts;
};

export const fetchPostStats = async (shareId) => {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const orgId = process.env.LINKEDIN_ORG_ID;

  const url = `https://api.linkedin.com/v2/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${orgId}&shares=urn:li:share:${shareId}`;

  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  return res.data.elements?.[0]?.totalShareStatistics || {};
};
