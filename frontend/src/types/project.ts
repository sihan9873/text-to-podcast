// src/types/project.ts
import type { ScriptVersion } from "./script"
import type { AudioVersion } from "./audio"

export interface Project {
  id: string
  name: string
  /** 项目原文（完整 TXT），允许编辑；后端保存完整内容且不得静默截断 */
  content: string
  createdAt: string
  updatedAt: string
  scriptVersions: ScriptVersion[]
  audioVersions: AudioVersion[]
}

export interface CreateProjectRequest {
  name: string;
  content?: string;
}

export interface ApiResponse<T> {
  code: string;
  message: string;
  data: T;
}
