import { create } from 'zustand';

export type AppStatus = 'IDLE' | 'PROCESSING' | 'RENDERED' | 'STREAMING' | 'SENT';

interface ViewerState {
  opacity: number;
  setOpacity: (opacity: number) => void;
  modelUrl: string | null;
  setModelUrl: (url: string | null) => void;
  modality: 'Brain' | 'Lung';
  setModality: (modality: 'Brain' | 'Lung') => void;
  patientId: string | null;
  setPatientId: (id: string | null) => void;
  lesionVolume: number;
  setLesionVolume: (volume: number) => void;
  appStatus: AppStatus;
  setAppStatus: (status: AppStatus) => void;
  sepsisProbability: string | null;
  setSepsisProbability: (prob: string | null) => void;
  triageLevel: string | null;
  setTriageLevel: (level: string | null) => void;
}

export const useViewerStore = create<ViewerState>((set) => ({
  opacity: 1.0,
  setOpacity: (opacity) => set({ opacity }),
  modelUrl: null, 
  setModelUrl: (url) => set({ modelUrl: url }),
  modality: 'Brain',
  setModality: (modality) => set({ modality }),
  patientId: null,
  setPatientId: (id) => set({ patientId: id }),
  lesionVolume: 0,
  setLesionVolume: (volume) => set({ lesionVolume: volume }),
  appStatus: 'IDLE',
  setAppStatus: (status) => set({ appStatus: status }),
  sepsisProbability: null,
  setSepsisProbability: (prob) => set({ sepsisProbability: prob }),
  triageLevel: null,
  setTriageLevel: (level) => set({ triageLevel: level }),
}));
