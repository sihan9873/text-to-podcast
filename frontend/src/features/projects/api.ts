// src/features/projects/api.ts
import { request, ApiError } from "@/api/request";
import type { Project } from "@/types/project";

/* ============================================================
 * 请求 / 响应类型
 * ============================================================ */

/** 创建项目请求体（对应 POST /projects） */
export interface CreateProjectRequest {
  name: string;
  /** 项目原文，可选 */
  content?: string;
}

/** 更新项目请求体（对应 PUT /projects/:projectId） */
export interface UpdateProjectRequest {
  name?: string;
  content?: string;
}

/* ============================================================
 * 后端响应包装
 *
 * ⚠️ 注意：你的 api/scripts.ts、api/audio.ts 返回的是「解包后的业务数据」
 * （如 ListScriptsResponse = { scriptVersions }），并没有 { code, message, data } 外壳。
 * 但项目的 MSW handler 和早期约定可能用的是 { projects } / { project }。
 * 这里按「与 scripts/audio 一致」的方式写：直接返回业务数据对象。
 * 如果你的后端确实返回 { code, message, data }，请改成注释里的版本。
 * ============================================================ */

interface ListProjectsResponse {
  projects: Project[];
}

interface GetProjectResponse {
  project: Project;
}

interface CreateProjectResponse {
  project: Project;
}

interface UpdateProjectResponse {
  project: Project;
}

/* ============================================================
 * API 函数
 * ============================================================ */

/**
 * 获取项目列表
 * GET /projects
 */
export function getProjects(signal?: AbortSignal): Promise<Project[]> {
  return request<ListProjectsResponse>("/projects", {
    method: "GET",
    signal,
  }).then((res) => res.projects);
}

/**
 * 获取单个项目详情
 * GET /projects/:projectId
 */
export function getProjectById(
  projectId: string,
  signal?: AbortSignal
): Promise<Project> {
  return request<GetProjectResponse>(
    `/projects/${encodeURIComponent(projectId)}`,
    { method: "GET", signal }
  ).then((res) => res.project);
}

/**
 * 创建项目
 * POST /projects
 */
export function createProject(
  data: CreateProjectRequest,
  signal?: AbortSignal
): Promise<Project> {
  if (!data.name?.trim()) {
    return Promise.reject(
      new ApiError(400, {
        code: "VALIDATION_ERROR",
        message: "项目名称不能为空",
      })
    );
  }
  return request<CreateProjectResponse>("/projects", {
    method: "POST",
    body: { ...data, name: data.name.trim() },
    signal,
  }).then((res) => res.project);
}

/**
 * 更新项目
 * PUT /projects/:projectId
 * 至少传 name 或 content 之一，避免空更新。
 */
export function updateProject(
  projectId: string,
  data: UpdateProjectRequest,
  signal?: AbortSignal
): Promise<Project> {
  if (data.name === undefined && data.content === undefined) {
    return Promise.reject(
      new ApiError(400, {
        code: "EMPTY_UPDATE",
        message: "至少需要传入 name 或 content 之一",
      })
    );
  }
  return request<UpdateProjectResponse>(
    `/projects/${encodeURIComponent(projectId)}`,
    { method: "PUT", body: data, signal }
  ).then((res) => res.project);
}

/**
 * 删除项目
 * DELETE /projects/:projectId
 * 后端返回 204 时 request() 返回 undefined。
 */
export function deleteProject(
  projectId: string,
  signal?: AbortSignal
): Promise<void> {
  return request<void>(
    `/projects/${encodeURIComponent(projectId)}`,
    { method: "DELETE", signal }
  );
}