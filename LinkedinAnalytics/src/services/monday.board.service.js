import axios from "axios";

const MONDAY_URL = "https://api.monday.com/v2";

export const createBoardItem = async (token, mappedData) => {
  const query = `
    mutation {
      create_item (
        board_id: ${process.env.MONDAY_BOARD_ID},
        item_name: "${mappedData.title}",
        column_values: "${JSON.stringify(mappedData.columns).replace(/"/g, '\\"')}"
      ) {
        id
      }
    }
  `;

  const res = await axios.post(
    MONDAY_URL,
    { query },
    { headers: { Authorization: token } }
  );

  return res.data.data.create_item.id;
};

export const updateBoardItem = async (token, itemId, analytics) => {
  const query = `
    mutation {
      change_multiple_column_values (
        board_id: ${process.env.MONDAY_BOARD_ID},
        item_id: ${itemId},
        column_values: "${JSON.stringify(analytics).replace(/"/g, '\\"')}"
      ) {
        id
      }
    }
  `;

  await axios.post(
    MONDAY_URL,
    { query },
    { headers: { Authorization: token } }
  );
};