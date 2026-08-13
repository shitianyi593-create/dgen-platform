import axios from 'axios';
import { useAuthStore } from '../stores/authStore';

/**
 * In development, Vite proxies /api/* to the BytePlus API to avoid CORS.
 * In production, set VITE_API_BASE_URL to the full API URL.
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

// Attach the API key to every outgoing request
apiClient.interceptors.request.use((config) => {
  const { apiKey } = useAuthStore.getState();
  if (apiKey) {
    config.headers.Authorization = `Bearer ${apiKey}`;
  }
  return config;
});

// Normalise error responses
apiClient.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response) {
      const data = error.response.data;
      const msg =
        data?.error?.message ?? data?.message ?? `HTTP ${error.response.status}`;
      const wrapped = new Error(msg) as Error & { status?: number };
      wrapped.status = error.response.status;
      return Promise.reject(wrapped);
    }
    return Promise.reject(error);
  },
);

export { apiClient, BASE_URL };
