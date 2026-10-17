// src/mocks/handlers/scripts.ts
import { http, HttpResponse, delay } from "msw";
import { mockProjects } from "@/mocks/data/projects";
import type { ScriptVersion } from "@/types/script";
import type {
  CreateScriptRequest,
  CreateScriptResponse,
  GetScriptResponse,
  UpdateScriptRequest,
  UpdateScriptResponse,
  ConfirmScriptResponse,
} from "@/api/scripts";

/** 在所有项目里查找脚本版本 */
function findScript(scriptId: string) {
  for (const project of mockProjects) {
    const script = project.scriptVersions.find((s) => s.id === scriptId);
    if (script) return { project, script };
  }
  return null;
}

export const scriptHandlers = [
  // 创建脚本版本
  http.post(
    "/api/projects/:projectId/scripts",
    async ({ params, request }) => {
      await delay(300);
      const project = mockProjects.find((p) => p.id === params.projectId);
      if (!project) {
        return HttpResponse.json(
          { code: "PROJECT_NOT_FOUND", message: "项目不存在" },
          { status: 404 }
        );
      }
      const body = (await request.json()) as CreateScriptRequest;
      if (!body.content?.trim()) {
        return HttpResponse.json(
          { code: "VALIDATION_ERROR", message: "脚本内容不能为空" },
          { status: 400 }
        );
      }
      const now = new Date().toISOString();
      const nextVersion =
        project.scriptVersions.reduce(
          (max, s) => Math.max(max, s.version),
          0
        ) + 1;
      const script: ScriptVersion = {
        id: `version-${crypto.randomUUID()}`,
        projectId: project.id,
        version: nextVersion,
        name: body.name || `版本 ${nextVersion}`,
        content: body.content,
        type: "user",
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };
      project.scriptVersions.unshift(script);
      return HttpResponse.json<CreateScriptResponse>(
        { scriptVersion: script },
        { status: 201 }
      );
    }
  ),

  // 脚本详情
  http.get("/api/scripts/:scriptId", async ({ params }) => {
    await delay(200);
    const found = findScript(params.scriptId as string);
    if (!found) {
      return HttpResponse.json(
        { code: "SCRIPT_NOT_FOUND", message: "脚本版本不存在" },
        { status: 404 }
      );
    }
    return HttpResponse.json<GetScriptResponse>({
      scriptVersion: found.script,
    });
  }),

  // 更新脚本
  http.put("/api/scripts/:scriptId", async ({ params, request }) => {
    await delay(200);
    const found = findScript(params.scriptId as string);
    if (!found) {
      return HttpResponse.json(
        { code: "SCRIPT_NOT_FOUND", message: "脚本版本不存在" },
        { status: 404 }
      );
    }
    if (found.script.status === "confirmed") {
      return HttpResponse.json(
        { code: "SCRIPT_LOCKED", message: "已确认的脚本不可修改" },
        { status: 409 }
      );
    }
    const body = (await request.json()) as UpdateScriptRequest;
    if (body.name === undefined && body.content === undefined) {
      return HttpResponse.json(
        { code: "EMPTY_UPDATE", message: "至少需要传入 name 或 content" },
        { status: 400 }
      );
    }
    if (body.name !== undefined) found.script.name = body.name;
    if (body.content !== undefined) found.script.content = body.content;
    found.script.updatedAt = new Date().toISOString();
    found.project.updatedAt = found.script.updatedAt;
    return HttpResponse.json<UpdateScriptResponse>({
      scriptVersion: found.script,
    });
  }),

  // 确认脚本
  http.post("/api/scripts/:scriptId/confirm", async ({ params }) => {
    await delay(200);
    const found = findScript(params.scriptId as string);
    if (!found) {
      return HttpResponse.json(
        { code: "SCRIPT_NOT_FOUND", message: "脚本版本不存在" },
        { status: 404 }
      );
    }
    if (found.script.status === "confirmed") {
      return HttpResponse.json(
        { code: "ALREADY_CONFIRMED", message: "脚本已确认" },
        { status: 409 }
      );
    }
    const now = new Date().toISOString();
    found.script.status = "confirmed";
    found.script.confirmedAt = now;
    found.script.updatedAt = now;
    return HttpResponse.json<ConfirmScriptResponse>({
      scriptVersion: found.script,
    });
  }),
];
