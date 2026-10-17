// src/api/request.ts

/** 后端统一错误响应结构 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/** 前端统一抛出的错误对象 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

/**
 * 构造业务错误（HTTP 请求成功，但业务失败，如任务失败）。
 * status=200 表示"请求成功但业务失败"，与 HTTP 错误区分。
 */
export function businessError(
  code: string,
  message: string,
  details?: unknown
): ApiError {
  return new ApiError(200, { code, message, details });
}

/** 后端基础地址，去掉尾部斜杠，避免拼接出双斜杠 */
const BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "/api"
).replace(/\/+$/, "");

/** 查询参数类型 */
export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined;

export type QueryParams = Record<string, QueryValue>;

/** 查询参数序列化，自动跳过 null / undefined */
function buildQuery(query?: QueryParams): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: QueryParams;
  signal?: AbortSignal;
}

/**
 * 通用请求函数。
 * 约定：所有非 2xx 响应统一抛出 ApiError。
 * 调用方通过 try/catch 处理错误。
 */
export async function request<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, query, signal } = options;
  const url = `${BASE_URL}${path}${buildQuery(query)}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // 用户主动取消，不应视为网络故障
    if (signal?.aborted) {
      throw new ApiError(0, {
        code: "ABORTED",
        message: "请求已取消",
      });
    }
    throw new ApiError(0, {
      code: "NETWORK_ERROR",
      message: err instanceof Error ? err.message : "网络请求失败",
    });
  }

  // 204 无内容
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const data = text ? safeJsonParse(text) : undefined;

  if (!response.ok) {
    const errBody: ApiErrorBody =
      data &&
      typeof data === "object" &&
      "code" in data &&
      "message" in data
        ? (data as ApiErrorBody)
        : {
            code: `HTTP_${response.status}`,
            message: response.statusText || "请求失败",
          };
    throw new ApiError(response.status, errBody);
  }

  return data as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** 判断是否为主动取消 */
export function isAborted(err: unknown): boolean {
  return err instanceof ApiError && err.code === "ABORTED";
}