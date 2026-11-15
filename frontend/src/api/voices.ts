import { http, newIdempotencyKey } from './client';
import type { TaskAccepted } from './types';

export interface VoiceProfile {
  voice_profile_id: string;
  voice_version_id: string;
  voice_id: string;
  name: string;
  reference_text: string;
  language: 'Chinese' | 'English';
  status: 'enabled' | 'disabled';
  duration_ms: number;
  created_at: string;
}

export const voicesApi = {
  list: () => http.get<{ items: VoiceProfile[] }>('/voice-profiles'),
  upload: (file: File) => http.binary<{ asset_id: string; duration_ms: number }>('/voice-references', file),
  create: (body: { name: string; reference_asset_id: string; reference_text: string; language: 'Chinese' | 'English'; authorized: true }) =>
    http.post<VoiceProfile>('/voice-profiles', body),
  update: (id: string, body: { name?: string; status?: 'enabled' | 'disabled' }) => http.patch<VoiceProfile>(`/voice-profiles/${id}`, body),
  preview: (id: string, text: string, key = newIdempotencyKey()) => http.post<TaskAccepted>(`/voice-profiles/${id}/preview`, { text }, key),
};
