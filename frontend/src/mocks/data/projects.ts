// src/mocks/data/projects.ts
import type { Project } from "@/types/project";
import type { VoiceConfig } from "@/types/voice";

const sampleVoice: VoiceConfig = {
  gender: "female",
  style: "lively",
  rate: "normal",
};

const STORAGE_KEY = "textcast.mock.projects.v1";

const seedProjects: Project[] = [
  {
    id: "project-001",
    name: "人工智能入门播客",
    content:
      "人工智能（Artificial Intelligence，简称 AI）是计算机科学的一个分支，它企图了解智能的实质，并生产出一种新的能以人类智能相似的方式做出反应的智能机器。人工智能的研究领域包括机器人、语言识别、图像识别、自然语言处理和专家系统等。",
    createdAt: "2024-01-15T10:00:00Z",
    updatedAt: "2024-01-20T14:30:00Z",
    scriptVersions: [
      {
        id: "version-003",
        projectId: "project-001",
        version: 3,
        name: "《人工智能入门：播客版》",
        content:
          "大家好，欢迎来到本期播客。今天我们要聊的是一个非常热门的话题——人工智能。\n\n简单来说，AI 就是让机器像人一样思考和行动的技术。",
        type: "user",
        status: "draft",
        createdAt: "2024-01-20T14:30:00Z",
        updatedAt: "2024-01-20T14:30:00Z",
      },
      {
        id: "version-002",
        projectId: "project-001",
        version: 2,
        name: "《人工智能入门：播客版》",
        content:
          "大家好，欢迎来到本期播客。今天我们要聊的是一个非常热门的话题——人工智能。",
        type: "ai",
        status: "confirmed",
        createdAt: "2024-01-18T09:15:00Z",
        updatedAt: "2024-01-18T09:15:00Z",
        confirmedAt: "2024-01-18T10:00:00Z",
      },
      {
        id: "version-001",
        projectId: "project-001",
        version: 1,
        name: "《人工智能入门：初稿》",
        content: "人工智能是计算机科学的一个分支。",
        type: "user",
        status: "confirmed",
        createdAt: "2024-01-15T10:00:00Z",
        updatedAt: "2024-01-15T10:00:00Z",
        confirmedAt: "2024-01-15T11:00:00Z",
      },
    ],
    audioVersions: [
      {
        id: "audio-001",
        projectId: "project-001",
        scriptVersionId: "version-002",
        version: 1,
        voiceConfig: sampleVoice,
        status: "completed",
        audioUrl: "/sample/audio-001.mp3",
        durationSeconds: 126,
        fileSizeBytes: 2_097_152,
        createdAt: "2024-01-18T10:05:00Z",
        completedAt: "2024-01-18T10:07:00Z",
      },
      {
        id: "audio-002",
        projectId: "project-001",
        scriptVersionId: "version-001",
        version: 1,
        voiceConfig: sampleVoice,
        status: "failed",
        createdAt: "2024-01-15T11:05:00Z",
      },
      {
        id: "audio-003",
        projectId: "project-001",
        scriptVersionId: "version-003",
        version: 1,
        voiceConfig: sampleVoice,
        status: "generating",
        createdAt: "2024-01-20T14:35:00Z",
      },
    ],
  },
  {
    id: "project-002",
    name: "区块链技术解析",
    content: "区块链是一种分布式账本技术……",
    createdAt: "2024-01-10T08:00:00Z",
    updatedAt: "2024-01-12T16:45:00Z",
    scriptVersions: [],
    audioVersions: [],
  },
];

function loadStoredProjects(): Project[] | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as Project[]) : null;
  } catch {
    return null;
  }
}

/**
 * 开发环境的模拟数据库。使用 localStorage 是为了让页面刷新后仍能恢复
 * 原文等项目数据；正式环境由后端数据库承担持久化。
 */
export const mockProjects: Project[] =
  loadStoredProjects() ?? structuredClone(seedProjects);

export function persistMockProjects(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mockProjects));
    }
  } catch {
    // 存储空间或隐私设置可能禁用 localStorage；接口仍保持内存可用。
  }
}
