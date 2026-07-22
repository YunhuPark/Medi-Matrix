import axios from 'axios';
import { supabase } from '../lib/supabase';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

export const medicalApi = axios.create({
  baseURL: API_BASE_URL,
});

medicalApi.interceptors.request.use(async (config) => {
  const requestUrl = config.url || '';
  const baseURL = config.baseURL || API_BASE_URL;

  let targetUrl: URL;
  try {
    // Safely parse URL relative to window.location.origin for relative API_BASE_URL
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const base = new URL(baseURL, baseOrigin);
    targetUrl = new URL(requestUrl, base);
  } catch (e) {
    throw new Error('Blocked: Invalid URL construction.');
  }

  // Determine allowed origin
  const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const allowedOrigin = new URL(API_BASE_URL, baseOrigin).origin;

  if (targetUrl.origin !== allowedOrigin && targetUrl.origin !== baseOrigin) {
    throw new Error('Blocked: medicalApi must not make requests to external URLs.');
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Authentication required. Please log in again.');
  }

  config.headers.Authorization = `Bearer ${session.access_token}`;
  return config;
});

export interface ProcessMaskResponse {
  status: string;
  message: string;
  glb_url: string;
  signed_url: string;
  mesh_id: string;
  expires_in: number;
  expires_at: number;
  patient_id: string;
  lesion_volume: number;
}

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
