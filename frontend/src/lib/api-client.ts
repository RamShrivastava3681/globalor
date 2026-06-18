const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4444/api";

let _token: string | null | undefined = undefined;

export function getToken(): string | null {
  if (_token === undefined) {
    _token =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("ledger_token")
        : null;
  }
  return _token;
}

export function setToken(token: string | null) {
  _token = token;
  if (typeof localStorage !== "undefined") {
    if (token) {
      localStorage.setItem("ledger_token", token);
    } else {
      localStorage.removeItem("ledger_token");
    }
  }
}

export function clearToken() {
  setToken(null);
}

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { signal?: AbortSignal },
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body:
      body instanceof FormData
        ? body
        : body !== undefined
          ? JSON.stringify(body)
          : undefined,
    signal: opts?.signal,
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errorBody.error ?? `Request failed: ${res.status}`);
  }

  // Handle 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

// ── Public helpers ──

export const api = {
  get<T = unknown>(path: string, opts?: { signal?: AbortSignal }) {
    return request<T>("GET", path, undefined, opts);
  },

  post<T = unknown>(path: string, body?: unknown, opts?: { signal?: AbortSignal }) {
    return request<T>("POST", path, body, opts);
  },

  patch<T = unknown>(path: string, body?: unknown, opts?: { signal?: AbortSignal }) {
    return request<T>("PATCH", path, body, opts);
  },

  delete<T = unknown>(path: string, body?: unknown, opts?: { signal?: AbortSignal }) {
    return request<T>("DELETE", path, body, opts);
  },

  upload<T = unknown>(path: string, formData: FormData) {
    return request<T>("POST", path, formData);
  },
};

// ── Auth helpers (for use outside React) ──

export async function signIn(email: string, password: string) {
  const data = await api.post<{ token: string; user: any }>("/auth/signin", {
    email,
    password,
  });
  setToken(data.token);
  return data.user;
}

export async function signUp(
  email: string,
  password: string,
  company_name: string,
  contact_name?: string,
) {
  const data = await api.post<{ token: string; user: any }>("/auth/signup", {
    email,
    password,
    company_name,
    contact_name,
  });
  setToken(data.token);
  return data.user;
}

export async function signOut() {
  clearToken();
}

export async function promoteToAdmin() {
  const data = await api.post<{ token: string; roles: string[] }>(
    "/auth/promote-admin",
  );
  setToken(data.token);
  return data;
}
