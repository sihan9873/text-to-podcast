// src/types/generation.ts
import type { VoiceConfig } from "./voice";

export type GenerationTaskType = "preview" | "full";
export type GenerationTaskStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface GenerationTask {
  id: string;
  projectId: string;
  type: GenerationTaskType;
  scriptVersionId: string;
  voiceConfig: VoiceConfig;
  status: GenerationTaskStatus;
  previewAudioUrl?: string;
  audioVersionId?: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PreviewTask extends GenerationTask {
  type: "preview";
  previewAudioUrl?: string;
}

export interface FullGenerationTask extends GenerationTask {
  type: "full";
  audioVersionId?: string;
}
