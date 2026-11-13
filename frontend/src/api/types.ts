// ============ 公共 ============

export interface ApiEnvelope<T> {
  code: string;
  message: string;
  data: T | null;
  request_id: string;
  timestamp: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

export interface PaginationParams {
  page?: number;
  page_size?: number;
}

/** 异步任务受理返回 */
export interface TaskAccepted {
  task_id: string;
  task_type: 'script' | 'audio';
  audio_action: 'preview' | 'full' | 'regenerate' | null;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  script_id: string | null;
  audio_version_id: string | null;
  candidate_id: string | null;
  status_url: string;
}

export type AudioAction = 'preview' | 'full' | 'regenerate';

// ============ 用户 ============

export type UserStatus = 'active' | 'disabled';

export interface UserInfo {
  user_id: string;
  username: string;
  display_name: string | null;
  status: UserStatus;
  created_at: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  display_name?: string | null;
}

export interface RegisterResponse {
  user_id: string;
  username: string;
  display_name: string | null;
  status: UserStatus;
  created_at: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface SessionResponse {
  user: UserInfo;
  expires_at: string;
  csrf_token: string;
}

export interface LogoutResponse {
  logged_out: boolean;
}

// ============ 项目 ============

export interface LlmConfig {
  project_id: string;
  model_id: string | null;
  credential_source: 'platform' | 'user';
  credential_id: string | null;
  params: Record<string, unknown>;
  available: boolean;
  unavailable_reason: string | null;
}

export interface CreateProjectRequest {
  title: string;
}

export interface CreateProjectResponse {
  project_id: string;
  title: string;
  source_submitted: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectListItem {
  project_id: string;
  title: string;
  source_submitted: boolean;
  current_script_id: string | null;
  confirmed_script_id: string | null;
  latest_audio_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActiveTaskSummary {
  task_id: string;
  task_type: 'script' | 'audio';
  audio_action: AudioAction | null;
  stage: string;
  status_url: string;
}

export interface ScriptSummary {
  script_id: string;
  version: number;
  edit_revision: number;
  status: 'draft' | 'confirmed';
}

export interface ConfirmedScriptSummary {
  script_id: string;
  version: number;
  edit_revision: number;
  confirmed_at: string;
}

export interface LatestAudio {
  audio_version_id: string;
  version: number;
  status: 'queued' | 'running' | 'ready' | 'failed';
  selection_revision: number;
  current_asset_id: string | null;
}

export interface ProjectDetail {
  project_id: string;
  title: string;
  source_text: string | null;
  source_type: 'text' | 'txt' | null;
  source_asset_id: string | null;
  source_hash: string | null;
  source_submitted: boolean;
  source_submitted_at: string | null;
  llm_config: LlmConfig;
  current_script: ScriptSummary | null;
  confirmed_script: ConfirmedScriptSummary | null;
  latest_audio: LatestAudio | null;
  active_tasks: ActiveTaskSummary[];
  created_at: string;
  updated_at: string;
}

export interface SubmitSourceRequest {
  text: string;
}

export interface SourceResponse {
  project_id: string;
  source_text: string;
  source_type: 'text' | 'txt';
  source_asset_id: string | null;
  source_hash: string;
  source_submitted: boolean;
  source_submitted_at: string;
}

// ============ 脚本 ============

export interface VoiceConfig {
  tts_provider: string;
  tts_model: string;
  voice_id: string;
  style: string | null;
  speed: number;
  extra_params: Record<string, unknown>;
}

export interface ScriptRole {
  role_id: string;
  profile_id: string | null;
  role_key: string;
  name: string;
  description: string | null;
  voice_config: VoiceConfig;
}

export interface ScriptSentence {
  sentence_id: string;
  sequence: number;
  role_id: string;
  text: string;
  speed: number | null;
  extra_params: Record<string, unknown>;
}

export type ScriptStatus = 'draft' | 'confirmed';

export interface ScriptDetail {
  script_id: string;
  project_id: string;
  version: number;
  edit_revision: number;
  title: string;
  summary: string | null;
  status: ScriptStatus;
  confirmed_at: string | null;
  confirmed_by: string | null;
  confirmed_revision: number | null;
  editable: boolean;
  roles: ScriptRole[];
  sentences: ScriptSentence[];
  created_at: string;
  updated_at: string;
}

export interface GenerateScriptRequest {
  roles: { profile_id: string; role_key: string }[];
}

export interface ScriptListItem {
  script_id: string;
  project_id: string;
  version: number;
  edit_revision: number;
  title: string;
  summary: string | null;
  status: ScriptStatus;
  sentence_count: number;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SaveScriptRequest {
  expected_script_version: number;
  expected_edit_revision: number;
  title: string;
  summary: string | null;
  roles: {
    role_id: string;
    role_key: string;
    name: string;
    description: string | null;
    voice_config: VoiceConfig;
  }[];
  sentences: {
    sentence_id: string;
    sequence: number;
    role_id: string;
    text: string;
    speed: number | null;
    extra_params: Record<string, unknown>;
  }[];
}

export interface PatchSentenceRequest {
  expected_script_version: number;
  expected_edit_revision: number;
  text?: string;
  role_id?: string;
  speed?: number | null;
  extra_params?: Record<string, unknown>;
}

export interface PatchSentenceResponse {
  script_id: string;
  version: number;
  edit_revision: number;
  status: ScriptStatus;
  sentence: ScriptSentence;
}

export interface ConfirmScriptRequest {
  expected_script_version: number;
  expected_edit_revision: number;
}

export interface ConfirmScriptResponse {
  script_id: string;
  version: number;
  edit_revision: number;
  status: ScriptStatus;
  confirmed_revision: number | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

// ============ 语音 ============

export interface AudioRequest {
  script_id: string;
  expected_script_version: number;
  expected_edit_revision: number;
}

export interface AudioVersionListItem {
  audio_version_id: string;
  version: number;
  script_id: string;
  script_version: number;
  script_edit_revision: number;
  status: 'queued' | 'running' | 'ready' | 'failed';
  selection_revision: number;
  current_asset_id: string | null;
  duration_ms: number | null;
  size_bytes: number | null;
  download_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface AudioVersionDetail extends AudioVersionListItem {
  project_id: string;
  script_snapshot: Record<string, unknown>;
  config_snapshot: Record<string, unknown>;
  play_url: string | null;
  source_script_changed: boolean;
  active_tasks: ActiveTaskSummary[];
}

export interface AudioSentenceItem {
  audio_sentence_id: string;
  source_sentence_id: string;
  sequence: number;
  text: string;
  role: { role_key: string; name: string };
  current_params: Record<string, unknown>;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  current_asset_id: string | null;
  play_url: string | null;
  duration_ms: number | null;
  error_message: string | null;
  has_ready_candidates: boolean;
}

export interface AudioSentencesResponse {
  audio_version_id: string;
  version: number;
  selection_revision: number;
  total_sentences: number;
  completed_sentences: number;
  failed_sentences: number;
  sentences: AudioSentenceItem[];
}

export interface RegenerateRequest {
  expected_selection_revision: number;
}

export type CandidateStatus = 'pending' | 'ready' | 'accepted' | 'discarded' | 'failed';

export interface CandidateItem {
  candidate_id: string;
  task_id: string;
  status: CandidateStatus;
  base_asset_id: string;
  base_selection_revision: number;
  asset_id: string | null;
  play_url: string | null;
  duration_ms: number | null;
  is_current: boolean;
  is_stale: boolean;
  created_at: string;
  decided_at: string | null;
}

export interface CandidatesResponse extends Paginated<CandidateItem> {
  audio_sentence_id: string;
  audio_version_id: string;
  current_asset_id: string;
  current_play_url: string;
  selection_revision: number;
}

export interface DecisionRequest {
  choice: 'keep_original' | 'use_candidate';
  expected_selection_revision: number;
}

export interface KeepOriginalResponse {
  candidate_id: string;
  status: 'discarded';
  audio_version_id: string;
  selection_revision: number;
  current_asset_id: string;
}

export interface UseCandidateCurrentResponse {
  candidate_id: string;
  audio_version_id: string;
  selection_revision: number;
  current_asset_id: string;
}

// ============ 任务 ============

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface TaskDetail {
  task_id: string;
  project_id: string;
  task_type: 'script' | 'audio';
  audio_action: AudioAction | null;
  script_id: string | null;
  audio_version_id: string | null;
  audio_sentence_id: string | null;
  retry_of_task_id: string | null;
  status: TaskStatus;
  stage: string;
  progress: number | null;
  total_sentences: number;
  completed_sentences: number;
  failed_sentences: number;
  result: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  can_retry: boolean;
  result_asset_id: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface TaskListParams extends PaginationParams {
  task_type?: 'script' | 'audio';
  audio_action?: AudioAction;
  status?: TaskStatus;
  audio_version_id?: string;
}

// ============ 配置 ============

export interface LlmModelItem {
  model_id: string;
  provider_code: string;
  model_code: string;
  name: string;
  supports_user_key: boolean;
  platform_credential_available: boolean;
  default_params: Record<string, unknown>;
  parameter_schema: Record<string, unknown>;
}

export interface CreateCredentialRequest {
  provider_code: string;
  name: string;
  api_key: string;
}

export interface CredentialItem {
  credential_id: string;
  provider_code: string;
  name: string;
  masked_value: string;
  status: 'enabled' | 'disabled';
  created_at: string;
  updated_at: string;
}

export interface UpdateCredentialRequest {
  name?: string;
  status?: 'enabled' | 'disabled';
}

export interface DeleteCredentialResponse {
  credential_id: string;
  status: 'deleted';
}

export interface RoleProfileItem {
  profile_id: string;
  name: string;
  description: string | null;
  tts_provider: string;
  tts_model: string;
  voice_id: string;
  style: string | null;
  speed: number;
  extra_params: Record<string, unknown>;
  status: 'enabled' | 'disabled';
  created_at: string;
  updated_at: string;
}

export interface CreateRoleRequest {
  name: string;
  description?: string | null;
  tts_provider: string;
  tts_model: string;
  voice_id: string;
  style?: string | null;
  speed?: number;
  extra_params?: Record<string, unknown>;
}

export interface UpdateRoleRequest {
  name?: string;
  description?: string | null;
  tts_provider?: string;
  tts_model?: string;
  voice_id?: string;
  style?: string | null;
  speed?: number;
  extra_params?: Record<string, unknown>;
  status?: 'enabled' | 'disabled';
}

export interface SaveLlmConfigRequest {
  model_id: string;
  credential_source: 'platform' | 'user';
  credential_id: string | null;
  params: Record<string, unknown>;
}

export interface VoiceItem {
  voice_id: string;
  name: string;
  tts_provider: string;
  tts_model: string;
  language: string;
  styles: string[];
  default_style: string | null;
  speed: {
    supported: boolean;
    min: number;
    max: number;
    default: number;
  };
  extra_parameter_schema: Record<string, unknown>;
}

export interface VoicesResponse {
  voices: VoiceItem[];
}

export interface VoicesParams {
  tts_provider?: string;
  tts_model?: string;
  language?: string;
}