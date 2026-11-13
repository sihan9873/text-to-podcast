import { http } from './client';
import type {
  CreateProjectRequest,
  CreateProjectResponse,
  Paginated,
  PaginationParams,
  ProjectDetail,
  ProjectListItem,
  SourceResponse,
  SubmitSourceRequest,
} from './types';

export interface ProjectListParams extends PaginationParams {
  keyword?: string;
}

export const projectsApi = {
  /** P-01 创建项目 */
  create: (body: CreateProjectRequest) =>
    http.post<CreateProjectResponse>('/projects', body),

  /** P-02 项目列表 */
  list: (params?: ProjectListParams) =>
    http.get<Paginated<ProjectListItem>>('/projects', params as Record<string, string | number | undefined>),

  /** P-03 项目详情 */
  detail: (projectId: string) => http.get<ProjectDetail>(`/projects/${projectId}`),

  /** P-04 提交文本原文 */
  submitSource: (projectId: string, body: SubmitSourceRequest) =>
    http.put<SourceResponse>(`/projects/${projectId}/source`, body),

  /** P-05 上传 TXT 并提交原文 */
  uploadSource: (projectId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return http.upload<SourceResponse>(`/projects/${projectId}/source/upload`, fd);
  },
};