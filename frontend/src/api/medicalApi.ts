import axios from 'axios';
import { ensureDemoSession } from '../auth/demoSession';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';
const DEFAULT_API_TIMEOUT_MS = 20_000;
const configuredApiTimeout = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? DEFAULT_API_TIMEOUT_MS);

export const MEDICAL_API_TIMEOUT_MS = Number.isFinite(configuredApiTimeout)
  ? Math.max(1_000, configuredApiTimeout)
  : DEFAULT_API_TIMEOUT_MS;

export const medicalApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: MEDICAL_API_TIMEOUT_MS,
});

medicalApi.interceptors.request.use(async (config) => {
  const requestUrl = config.url || '';
  const baseURL = config.baseURL || API_BASE_URL;

  let targetUrl: URL;
  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const normalizedBaseURL = baseURL.endsWith('/') ? baseURL : `${baseURL}/`;
    const base = new URL(normalizedBaseURL, baseOrigin);
    const normalizedRequestUrl = requestUrl.startsWith('/') ? requestUrl.slice(1) : requestUrl;
    targetUrl = new URL(normalizedRequestUrl, base);
  } catch {
    throw new Error('Blocked: Invalid URL construction.');
  }

  const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const allowedOrigin = new URL(API_BASE_URL, baseOrigin).origin;

  if (targetUrl.origin !== allowedOrigin && targetUrl.origin !== baseOrigin) {
    throw new Error('Blocked: medicalApi must not make requests to external URLs.');
  }

  const session = await ensureDemoSession();
  if (!session?.access_token) {
    throw new Error('Authentication required. Please log in again.');
  }

  config.headers.Authorization = `Bearer ${session.access_token}`;
  return config;
});

export interface CaseContextResponse {
  case_id: string;
  identifier_type: 'non_phi_demo_case';
  clinical_identifier: false;
}

export const createCaseContext = async (): Promise<CaseContextResponse> => {
  const response = await medicalApi.post<CaseContextResponse>('/cases');
  return response.data;
};

export const uploadVitalsForCase = async (caseId: string, file: File): Promise<any> => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await medicalApi.post(`/cases/${encodeURIComponent(caseId)}/vitals`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

export interface ProcessMaskResponse {
  status: string;
  message: string;
  glb_url: string;
  signed_url: string;
  mesh_id: string;
  expires_in: number;
  expires_at: number;
  patient_id: string;
  case_id?: string;
  identifier_type?: 'non_phi_demo_case';
  clinical_identifier?: false;
  lesion_volume: number;
}

export interface TransferDemoResponse {
  status: 'success';
  case_id: string;
  scenario: 'ed_interhospital_transfer_support';
  scenario_label: string;
  data_mode: 'synthetic_bundled_demo';
  clinical_identifier: false;
  vitals_attached: true;
  image: ProcessMaskResponse;
  integration_target: {
    imaging: string;
    vitals: string;
    encounter: string;
  };
}

export const bootstrapTransferDemoCase = async (): Promise<TransferDemoResponse> => {
  const response = await medicalApi.post<TransferDemoResponse>('/demo/transfer-case');
  return response.data;
};

export const processMedicalMask = async (file: File, modality: string = 'Brain'): Promise<ProcessMaskResponse> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('modality', modality);

  const response = await medicalApi.post<ProcessMaskResponse>('/process-mri', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
      'Accept': '.npy, .nii.gz',
    },
  });

  if (response.data.status !== 'success') {
    throw new Error(response.data.message || 'Failed to process image');
  }

  return response.data;
};

export const processMedicalMaskForCase = async (
  caseId: string,
  file: File,
  modality: string = 'Brain'
): Promise<ProcessMaskResponse> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('modality', modality);

  const response = await medicalApi.post<ProcessMaskResponse>(
    `/cases/${encodeURIComponent(caseId)}/process-mri`,
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
        'Accept': '.npy, .nii.gz',
      },
    }
  );

  if (response.data.status !== 'success') {
    throw new Error(response.data.message || 'Failed to process case image');
  }

  return response.data;
};

export interface TriageResponse {
  status?: string;
  message?: string;
  [key: string]: any;
}

export const sendTriageData = async (patientId: string, modality: string, volume: number): Promise<TriageResponse> => {
  const response = await medicalApi.post<TriageResponse>('/triage/send', {
    patient_id: patientId,
    modality,
    volume,
  });

  return response.data;
};

export const getSignedUrl = async (mesh_id: string): Promise<{ signed_url: string, expires_at: number, glb_url: string }> => {
  const response = await medicalApi.get(`/meshes/${mesh_id}/signed-url`);
  return response.data;
};

export const uploadVitals = async (file: File): Promise<any> => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await medicalApi.post('/upload-vitals', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};
