const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string;
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

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

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
