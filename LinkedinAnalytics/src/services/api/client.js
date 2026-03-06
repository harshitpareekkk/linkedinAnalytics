import axios from "axios";
import { MONDAY_API_URL } from "./endpoints.js";

let mondayToken = null;

const axiosInstance = axios.create({
  baseURL: MONDAY_API_URL,
  headers: {
    "Content-Type": "application/json",
    "API-Version": "2024-10",
  },
  timeout: 15000,
});

// Inject token on every request — raw token value, no "Bearer" prefix
axiosInstance.interceptors.request.use((config) => {
  if (mondayToken) {
    config.headers.Authorization = mondayToken;
  }
  return config;
});

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error("[axiosInstance] Error:", error?.response?.data || error.message);
    throw error;
  }
);

export const setMondayToken = (token) => {
  mondayToken = token;
};

export default axiosInstance;