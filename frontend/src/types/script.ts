// src/types/script.ts
export type ScriptStatus = "draft" | "pending" | "confirmed";
export type ScriptType = "user" | "ai";

export interface ScriptVersion {
  id: string;
  projectId: string;
  version: number;
  name: string;
  /** 完整 TXT 正文，不拆分句子 */
  content: string;
  type: ScriptType;
  status: ScriptStatus;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
}