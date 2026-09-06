const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const LM_STUDIO_URL_KEY = "intellitender.lmStudioUrl";
const DEFAULT_LM_STUDIO_URL = import.meta.env.VITE_LM_STUDIO_URL || "http://localhost:1234/v1";

export const getLmStudioUrl = () => localStorage.getItem(LM_STUDIO_URL_KEY) || DEFAULT_LM_STUDIO_URL;

export const saveLmStudioUrl = (value: string) => {
  const normalized = value.trim();
  if (normalized) localStorage.setItem(LM_STUDIO_URL_KEY, normalized);
  else localStorage.removeItem(LM_STUDIO_URL_KEY);
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string;
  timeoutMs?: number;
};

export class ApiError extends Error {
  code?: string;
  frozenUntil?: string;
  status?: number;

  constructor(message: string, extras?: { code?: string; frozenUntil?: string; status?: number }) {
    super(message);
    this.name = "ApiError";
    this.code = extras?.code;
    this.frozenUntil = extras?.frozenUntil;
    this.status = extras?.status;
  }
}

export type AuthUser = {
  _id: string;
  name: string;
  email: string;
  role: "CPO" | "PO" | "Committee" | "Vendor";
  accountStatus?: "Active" | "Frozen" | "Suspended" | "Deleted";
  frozenUntil?: string | null;
  token: string;
};

export const saveAuthUser = (user: AuthUser) => {
  localStorage.setItem("authUser", JSON.stringify(user));
};

export const getAuthUser = (): AuthUser | null => {
  const raw = localStorage.getItem("authUser");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
};

export const clearAuthUser = () => {
  localStorage.removeItem("authUser");
};

export const apiRequest = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const authUser = getAuthUser();
  const token = options.token || authUser?.token;
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 20000;
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`, { code: "REQUEST_TIMEOUT" });
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data?.message || data?.error || "Request failed", {
      code: data?.code,
      frozenUntil: data?.frozenUntil,
      status: response.status,
    });
  }

  return data as T;
};
