import axios from "axios";

// withCredentials: true vì BE dùng cookie httpOnly (session_token /
// client_session_token) để xác thực, không dùng Authorization header.
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  withCredentials: true,
});
