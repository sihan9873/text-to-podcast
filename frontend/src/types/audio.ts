// src/types/audio.ts
import type { VoiceConfig } from "./voice";

export type AudioStatus = "generating" | "completed" | "failed";

export interface AudioVersion {
  id: string;
  projectId: string;
  scriptVersionId: string;
  version: number;
  voiceConfig: VoiceConfig;
  status: AudioStatus;
  audioUrl?: string;
  durationSeconds?: number;
  fileSizeBytes?: number;
  createdAt: string;
  completedAt?: string;
}