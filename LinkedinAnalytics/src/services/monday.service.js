import axios from "axios";

export const pushToMonday = async (post, stats) => {
  const boardId = String(process.env.MONDAY_BOARD_ID);
  const token = process.env.MONDAY_API_KEY;

  const postId = post?.id;
  const createdAt = Number(post?.created?.time) || Date.now();

  const postUrl = post?.content?.contentEntities?.[0]?.entityLocation || "";

  const impressions = stats.impressionCount || 0;
  const clicks = stats.clickCount || 0;
  const uniqueImpressions = stats.uniqueImpressionsCount || 0;

  const ctr = impressions > 0 ? clicks / impressions : 0;

  const columnValues = {
    text_mkzw4ffz: post.created.actor || "",
    link_mkzwc59z: {
      url: postUrl,
      text: "LinkedIn Post"
    },
    status: post.content.shareMediaCategory === "RICH" ? "Document" : "Text",
    date4: new Date(createdAt).toISOString().split("T")[0],
    text_mkzwxgfj: postId,
    text_mkzw74hr: post.owner,
    numeric_mkzwxzqk: impressions,
    numeric_mkzw50bn: uniqueImpressions,
    numeric_mkzwsay8: stats.likeCount || 0,
    numeric_mkzwwst3: stats.commentCount || 0,
    numeric_mkzw9bxf: stats.shareCount || 0,
    numeric_mkzwx7en: clicks,
    numeric_mkzw8way: ctr,
    numeric_mkzwvz6z: ctr
  };

  const mutation = `
    mutation CreateItem($boardId: ID!, $title: String!, $columnVals: JSON!) {
      create_item (
        board_id: $boardId,
        item_name: $title,
        column_values: $columnVals
      ) {
        id
      }
    }
  `;

  const variables = {
    boardId,
    title: post.text?.text?.substring(0, 40) || "LinkedIn Post",
    columnVals: JSON.stringify(columnValues)
  };

  try {
    const response = await axios({
      url: "https://api.monday.com/v2",
      method: "post",
      headers: {
        Authorization: token,
        "Content-Type": "application/json"
      },
      data: JSON.stringify({
        query: mutation,
        variables
      })
    });

    console.log("✔ Monday item created:", response.data);
    return response.data;
  } catch (err) {
    console.error("❌ Monday Error:", JSON.stringify(err.response?.data, null, 2));
  }
};
