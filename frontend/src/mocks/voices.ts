import type { VoiceItem } from '../api/types';

// Independent of role templates: editing a template must not remove catalog voices.
export const voices: VoiceItem[] = [
  { voice_id: 'voice_1', name: '知夏 · 温暖女声', tts_provider: 'mock', tts_model: 'demo-tts', language: 'zh-CN', styles: ['natural', 'cheerful', 'calm'], default_style: 'natural', speed: { supported: true, min: 0.5, max: 2, default: 1 }, extra_parameter_schema: { volume: { type: 'number', minimum: 0, maximum: 1, default: 0.8 }, emotion: { type: 'string', enum: ['neutral', 'happy', 'gentle'], default: 'neutral' } } },
  { voice_id: 'voice_2', name: '林川 · 沉稳男声', tts_provider: 'mock', tts_model: 'demo-tts', language: 'zh-CN', styles: ['natural', 'calm', 'serious'], default_style: 'natural', speed: { supported: true, min: 0.75, max: 1.5, default: 1 }, extra_parameter_schema: { pitch: { type: 'number', minimum: -5, maximum: 5, default: 0 } } },
  { voice_id: 'voice_3', name: '旁白 · 清晰中性声', tts_provider: 'mock', tts_model: 'demo-tts', language: 'zh-CN', styles: ['natural'], default_style: 'natural', speed: { supported: false, min: 1, max: 1, default: 1 }, extra_parameter_schema: {} },
  { voice_id: 'voice_story', name: '晚晴 · 叙事女声', tts_provider: 'mock', tts_model: 'story-tts', language: 'zh-CN', styles: ['storytelling', 'gentle'], default_style: 'storytelling', speed: { supported: true, min: 0.8, max: 1.3, default: 1 }, extra_parameter_schema: { enhance: { type: 'boolean', default: true } } },
  { voice_id: 'voice_en', name: 'Alex · English', tts_provider: 'mock-studio', tts_model: 'studio-v1', language: 'en-US', styles: ['conversational', 'news'], default_style: 'conversational', speed: { supported: true, min: 0.7, max: 1.6, default: 1 }, extra_parameter_schema: {} },
  { voice_id: 'voice_zh', name: '晓晨 · 明亮女声', tts_provider: 'mock-studio', tts_model: 'studio-v1', language: 'zh-CN', styles: ['natural', 'cheerful'], default_style: 'natural', speed: { supported: true, min: 0.7, max: 1.6, default: 1 }, extra_parameter_schema: {} },
];
