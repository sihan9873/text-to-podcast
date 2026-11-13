// Compatibility exports for the existing feature module. All requests use the shared API client.
export { ApiError } from '@/api/client';
export { projectsApi } from '@/api/projects';
export type { ProjectDetail as Project } from '@/api/types';
