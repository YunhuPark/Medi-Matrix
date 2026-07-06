import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

export interface ProcessMaskResponse {
  status: string;
  message: string;
  glb_url: string;
  filename: string;
  patient_id: string;
  lesion_volume: number;
}

export const processMedicalMask = async (file: File, modality: string = 'Brain'): Promise<ProcessMaskResponse> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('modality', modality);

  const response = await axios.post<ProcessMaskResponse>(`${API_BASE_URL}/process-mri`, formData, {
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
  status: string;
  message: string;
}

export const sendTriageData = async (patientId: string, modality: string, volume: number): Promise<TriageResponse> => {
  const response = await axios.post<TriageResponse>(`${API_BASE_URL}/triage/send`, {
    patient_id: patientId,
    modality,
    volume,
  });

  if (response.data.status !== 'success') {
    throw new Error(response.data.message || 'Failed to send triage data');
  }

  return response.data;
};
