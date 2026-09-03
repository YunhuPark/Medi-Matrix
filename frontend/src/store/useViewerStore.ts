import { create } from 'zustand';

export type AppStatus = 'IDLE' | 'PROCESSING' | 'RENDERED' | 'STREAMING' | 'SENT';

interface ViewerState {
  opacity: number;
  setOpacity: (opacity: number) => void;
  modelUrl: string | null;
  setModelUrl: (url: string | null) => void;
  modality: 'Brain' | 'Lung';
  setModality: (modality: 'Brain' | 'Lung') => void;
  /**
   * Non-PHI demo encounter identifier. This is not a hospital MRN or patient ID.
   * It links MRI, Vitals, Triage and transfer-search context inside the MVP.
   */
  caseId: string | null;
  setCaseId: (id: string | null) => void;
  /** @deprecated Kept temporarily for dashboard compatibility; mirrors caseId in the new flow. */
  patientId: string | null;
  setPatientId: (id: string | null) => void;
  meshId: string | null;
  setMeshId: (id: string | null) => void;
  expiresAt: number | null;
  setExpiresAt: (time: number | null) => void;
  lesionVolume: number;
  setLesionVolume: (volume: number) => void;
  appStatus: AppStatus;
  setAppStatus: (status: AppStatus) => void;
  sepsisProbability: string | null;
  setSepsisProbability: (prob: string | null) => void;
  triageLevel: string | null;
  setTriageLevel: (level: string | null) => void;
  resetMedicalState: () => void;
}

export const useViewerStore = create<ViewerState>((set) => ({
  opacity: 1.0,
  setOpacity: (opacity) => set({ opacity }),
  modelUrl: null,
  setModelUrl: (url) => set({ modelUrl: url }),
  modality: 'Brain',
  setModality: (modality) => set({ modality }),
  caseId: null,
  setCaseId: (id) => set({ caseId: id }),
  patientId: null,
  setPatientId: (id) => set({ patientId: id }),
  meshId: null,
  setMeshId: (id) => set({ meshId: id }),
  expiresAt: null,
  setExpiresAt: (time) => set({ expiresAt: time }),
  lesionVolume: 0,
  setLesionVolume: (volume) => set({ lesionVolume: volume }),
  appStatus: 'IDLE',
  setAppStatus: (status) => set({ appStatus: status }),
  sepsisProbability: null,
  setSepsisProbability: (prob) => set({ sepsisProbability: prob }),
  triageLevel: null,
  setTriageLevel: (level) => set({ triageLevel: level }),
  resetMedicalState: () => set({
    modelUrl: null,
    caseId: null,
    patientId: null,
    meshId: null,
    expiresAt: null,
    lesionVolume: 0,
    appStatus: 'IDLE',
    sepsisProbability: null,
    triageLevel: null,
  }),
}));
