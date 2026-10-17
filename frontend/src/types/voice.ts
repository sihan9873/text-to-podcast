// src/types/voice.ts
export type VoiceGender = "male" | "female";
export type VoiceStyle = "lively" | "calm";
export type SpeechRate = "slow" | "normal" | "fast";

export interface VoiceConfig {
  gender: VoiceGender;
  style: VoiceStyle;
  rate: SpeechRate;
}