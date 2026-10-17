// src/mocks/handlers/audio.ts
import { http, HttpResponse, delay } from "msw";
import { mockProjects } from "@/mocks/data/projects";
import type { AudioVersion } from "@/types/audio";
import type {
  GetAudioVersionResponse,
} from "@/api/audio";
import type {
  CreateFullGenerationRequest,
  CreateFullGenerationResponse,
  RetryAudioVersionResponse,
} from "@/api/generation";
import type { FullGenerationTask, GenerationTask } from "@/types/generation";

const taskStore = new Map<string, GenerationTask>();

function findAudio(audioVersionId: string) {
  for (const project of mockProjects) {
    const audio = project.audioVersions.find((a) => a.id === audioVersionId);
    if (audio) return { project, audio };
  }
  return null;
}

export const audioHandlers = [
  // 单个音频版本详情
  http.get("/api/audio-versions/:audioVersionId", async ({ params }) => {
    await delay(200);
    const found = findAudio(params.audioVersionId as string);
    if (!found) {
      return HttpResponse.json(
        { code: "AUDIO_NOT_FOUND", message: "音频版本不存在" },
        { status: 404 }
      );
    }
    return HttpResponse.json<GetAudioVersionResponse>({
      audioVersion: found.audio,
    });
  }),

  // 创建全文生成任务
  http.post("/api/generation/full", async ({ request }) => {
    await delay(500);
    const body = (await request.json()) as CreateFullGenerationRequest;
    const project = mockProjects.find((p) => p.id === body.projectId);
    if (!project) {
      return HttpResponse.json(
        { code: "PROJECT_NOT_FOUND", message: "项目不存在" },
        { status: 404 }
      );
    }
    const script = project.scriptVersions.find(
      (s) => s.id === body.scriptVersionId
    );
    if (!script) {
      return HttpResponse.json(
        { code: "SCRIPT_NOT_FOUND", message: "脚本版本不存在" },
        { status: 404 }
      );
    }
    if (script.status !== "confirmed") {
      return HttpResponse.json(
        { code: "SCRIPT_NOT_CONFIRMED", message: "脚本尚未确认" },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const audioVersion: AudioVersion = {
      id: `audio-${crypto.randomUUID()}`,
      projectId: project.id,
      scriptVersionId: script.id,
      version:
        project.audioVersions.filter(
          (a) => a.scriptVersionId === script.id
        ).reduce((max, a) => Math.max(max, a.version), 0) + 1,
      voiceConfig: body.voiceConfig,
      status: "generating",
      createdAt: now,
    };
    project.audioVersions.unshift(audioVersion);

    const task: FullGenerationTask = {
      id: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      type: "full" as const,
      scriptVersionId: script.id,
      voiceConfig: body.voiceConfig,
      status: "processing" as const,
      audioVersionId: audioVersion.id,
      createdAt: now,
      startedAt: now,
    };

    // 模拟 3 秒后完成
    const audioId = audioVersion.id;
    const taskId = task.id;
    setTimeout(() => {
      const found = findAudio(audioId);
      if (!found) return;
      found.audio.status = "completed";
      found.audio.audioUrl = `/sample/${audioId}.mp3`;
      found.audio.durationSeconds = 60 + Math.floor(Math.random() * 60);
      found.audio.fileSizeBytes = 1_000_000 + Math.floor(Math.random() * 2_000_000);
      found.audio.completedAt = new Date().toISOString();
      task.status = "completed";
      task.completedAt = found.audio.completedAt;
    }, 3000);
    // 把 task 也塞进某个内存变量（这里简化为全局 Map）
    taskStore.set(taskId, task);

    return HttpResponse.json<CreateFullGenerationResponse>(
      { task, audioVersion },
      { status: 202 }
    );
  }),

  // 重试失败音频
  http.post(
    "/api/audio-versions/:audioVersionId/retry",
    async ({ params }) => {
      await delay(300);
      const found = findAudio(params.audioVersionId as string);
      if (!found) {
        return HttpResponse.json(
          { code: "AUDIO_NOT_FOUND", message: "音频版本不存在" },
          { status: 404 }
        );
      }
      if (found.audio.status !== "failed") {
        return HttpResponse.json(
          { code: "NOT_FAILED", message: "只能重试失败的音频" },
          { status: 409 }
        );
      }
      const now = new Date().toISOString();
      const newAudio: AudioVersion = {
        ...found.audio,
        id: `audio-${crypto.randomUUID()}`,
        version: found.audio.version + 1,
        status: "generating",
        audioUrl: undefined,
        durationSeconds: undefined,
        fileSizeBytes: undefined,
        completedAt: undefined,
        createdAt: now,
      };
      found.project.audioVersions.unshift(newAudio);

      const task: FullGenerationTask = {
        id: `task-${crypto.randomUUID()}`,
        projectId: found.project.id,
        type: "full" as const,
        scriptVersionId: newAudio.scriptVersionId,
        voiceConfig: newAudio.voiceConfig,
        status: "processing" as const,
        audioVersionId: newAudio.id,
        createdAt: now,
        startedAt: now,
      };
      const audioId = newAudio.id;
      const taskId = task.id;
      setTimeout(() => {
        const f = findAudio(audioId);
        if (!f) return;
        f.audio.status = "completed";
        f.audio.audioUrl = `/sample/${audioId}.mp3`;
        f.audio.durationSeconds = 90;
        f.audio.fileSizeBytes = 1_500_000;
        f.audio.completedAt = new Date().toISOString();
        task.status = "completed";
        task.completedAt = f.audio.completedAt;
      }, 3000);
      taskStore.set(taskId, task);

      return HttpResponse.json<RetryAudioVersionResponse>(
        { task, audioVersion: newAudio },
        { status: 202 }
      );
    }
  ),

  // 生成任务状态查询
  http.get("/api/generation/tasks/:taskId", async ({ params }) => {
    const task = taskStore.get(params.taskId as string);
    if (!task) {
      return HttpResponse.json(
        { code: "TASK_NOT_FOUND", message: "任务不存在" },
        { status: 404 }
      );
    }
    return HttpResponse.json({ task });
  }),
];
