// In-memory stub for GitHub Releases integration

interface UploadJob {
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  error?: string;
  downloadUrl?: string;
}

const uploadJobs = new Map<string, UploadJob>();

export async function getSavedGitHubSettingsSummary(): Promise<{
  configured: boolean;
  owner?: string;
  repo?: string;
  releaseTag?: string;
}> {
  return {
    configured: false,
    owner: '',
    repo: '',
    releaseTag: '',
  };
}

export async function checkGitHubRepositoryStatus(): Promise<{
  valid: boolean;
  message: string;
}> {
  return {
    valid: true,
    message: 'GitHub repository status normal',
  };
}

export async function publishApkToGitHubRelease(params: any): Promise<{
  success: boolean;
  releaseId?: number;
  downloadUrl?: string;
}> {
  return {
    success: true,
    releaseId: 1,
    downloadUrl: params?.downloadUrl || '',
  };
}

export function getUploadJobProgress(jobId: string): UploadJob {
  return (
    uploadJobs.get(jobId) || {
      progress: 100,
      status: 'completed',
    }
  );
}

export function setUploadJobProgress(jobId: string, progress: Partial<UploadJob>): void {
  const current = uploadJobs.get(jobId) || { progress: 0, status: 'pending' };
  uploadJobs.set(jobId, { ...current, ...progress });
}
