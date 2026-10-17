// src/mocks/handlers/projects.ts
import { http, HttpResponse, delay } from "msw";
import {
  mockProjects,
  persistMockProjects,
} from "@/mocks/data/projects";
import type { Project } from "@/types/project";
import type { ListScriptsResponse } from "@/api/scripts";
import type { ListAudioVersionsResponse } from "@/api/audio";
import { validateSourceText } from "@/features/source-input/validation";

export const projectHandlers = [
  // 项目列表
  http.get("/api/projects", async () => {
    await delay(200);
    return HttpResponse.json<{ projects: Project[] }>({
      projects: mockProjects,
    });
  }),

  // 项目详情
  http.get("/api/projects/:projectId", async ({ params }) => {
    await delay(200);
    const project = mockProjects.find((p) => p.id === params.projectId);
    if (!project) {
      return HttpResponse.json(
        { code: "PROJECT_NOT_FOUND", message: "项目不存在" },
        { status: 404 }
      );
    }
    return HttpResponse.json<{ project: Project }>({ project });
  }),

  // 创建项目
  http.post("/api/projects", async ({ request }) => {
    await delay(200);
    const body = (await request.json()) as { name: string; content?: string };
    if (!body.name?.trim()) {
      return HttpResponse.json(
        { code: "VALIDATION_ERROR", message: "项目名称不能为空" },
        { status: 400 }
      );
    }
    const now = new Date().toISOString();
    const project: Project = {
      id: `project-${crypto.randomUUID()}`,
      name: body.name.trim(),
      content: body.content ?? "",
      createdAt: now,
      updatedAt: now,
      scriptVersions: [],
      audioVersions: [],
    };
    mockProjects.unshift(project);
    persistMockProjects();
    return HttpResponse.json<{ project: Project }>(
      { project },
      { status: 201 }
    );
  }),

  // 更新项目名称或原文。真实后端也必须重复进行原文校验。
  http.put("/api/projects/:projectId", async ({ params, request }) => {
    await delay(200);
    const project = mockProjects.find((p) => p.id === params.projectId);
    if (!project) {
      return HttpResponse.json(
        { code: "PROJECT_NOT_FOUND", message: "项目不存在" },
        { status: 404 }
      );
    }

    const body = (await request.json()) as {
      name?: unknown;
      content?: unknown;
    };
    if (body.name === undefined && body.content === undefined) {
      return HttpResponse.json(
        { code: "EMPTY_UPDATE", message: "至少需要更新名称或原文之一" },
        { status: 400 }
      );
    }

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return HttpResponse.json(
          { code: "VALIDATION_ERROR", message: "项目名称不能为空" },
          { status: 400 }
        );
      }
      project.name = body.name.trim();
    }

    if (body.content !== undefined) {
      if (typeof body.content !== "string") {
        return HttpResponse.json(
          { code: "VALIDATION_ERROR", message: "原文必须是字符串" },
          { status: 400 }
        );
      }
      const validation = validateSourceText(body.content);
      if (validation.errors.length > 0) {
        return HttpResponse.json(
          {
            code: validation.errors[0].code,
            message: validation.errors[0].message,
          },
          { status: 400 }
        );
      }
      project.content = body.content;
    }

    project.updatedAt = new Date().toISOString();
    persistMockProjects();
    return HttpResponse.json<{ project: Project }>({ project });
  }),

  // 脚本版本列表（GET /api/projects/:projectId/scripts）
  http.get("/api/projects/:projectId/scripts", async ({ params }) => {
    await delay(200);
    const project = mockProjects.find((p) => p.id === params.projectId);
    if (!project) {
      return HttpResponse.json(
        { code: "PROJECT_NOT_FOUND", message: "项目不存在" },
        { status: 404 }
      );
    }
    return HttpResponse.json<ListScriptsResponse>({
      scriptVersions: project.scriptVersions,
    });
  }),

  // 音频版本列表（GET /api/projects/:projectId/audio-versions）
  http.get(
    "/api/projects/:projectId/audio-versions",
    async ({ params, request }) => {
      await delay(200);
      const project = mockProjects.find((p) => p.id === params.projectId);
      if (!project) {
        return HttpResponse.json(
          { code: "PROJECT_NOT_FOUND", message: "项目不存在" },
          { status: 404 }
        );
      }
      const url = new URL(request.url);
      const scriptVersionId = url.searchParams.get("scriptVersionId");
      const status = url.searchParams.get("status");

      let list = project.audioVersions;
      if (scriptVersionId) {
        list = list.filter((a) => a.scriptVersionId === scriptVersionId);
      }
      if (status) {
        list = list.filter((a) => a.status === status);
      }
      return HttpResponse.json<ListAudioVersionsResponse>({
        audioVersions: list,
      });
    }
  ),
];
