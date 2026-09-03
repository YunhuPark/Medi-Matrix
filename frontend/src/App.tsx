import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Activity, Brain, Loader2, Play, Stethoscope, Upload, Wifi, WifiOff } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { ThreeViewer } from './components/viewer/ThreeViewer'
import { EmergencyDashboard } from './components/dashboard/EmergencyDashboard'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { ensureDemoSession, DemoSessionError } from './auth/demoSession'
import {
  bootstrapTransferDemoCase,
  createCaseContext,
  getSignedUrl,
  processMedicalMaskForCase,
  uploadVitalsForCase,
} from './api/medicalApi'
import { getCaseWebSocketUrl } from './lib/websocketUrl'
import { reduceRedSnapshot, type RedSnapshot } from './lib/redSnapshot'
import { useSignedUrlRefresh } from './hooks/useSignedUrlRefresh'
import { useViewerStore } from './store/useViewerStore'
import './App.css'

type VitalsConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'
  | 'stopped'

type DecisionBreakdown = {
  policy: string
  clinical_rule: boolean
  vitals_risk: number
  vision_context: number
  triage_score: number
  yellow_threshold: number
  red_threshold: number
}

const DEFAULT_VITALS = {
  hr: 80,
  bpSys: 120,
  bpDia: 80,
  resp: 16,
  temp: 36.5,
  spo2: 98,
}

function MainApp() {
  const isDemoMode = import.meta.env.VITE_INFERENCE_MODE !== 'model'
  const {
    opacity,
    setOpacity,
    modality,
    setModality,
    setModelUrl,
    caseId,
    setCaseId,
    setPatientId,
    meshId,
    setMeshId,
    expiresAt,
    setExpiresAt,
    lesionVolume,
    setLesionVolume,
    appStatus,
    setAppStatus,
    resetMedicalState,
  } = useViewerStore()
  const { signOut } = useAuth()

  const [triageLevel, setTriageLevel] = useState<string | null>(null)
  const [diseaseRisks, setDiseaseRisks] = useState<{
    sepsis: string
    ards: string
    shock: string
  } | null>(null)
  const [decision, setDecision] = useState<DecisionBreakdown | null>(null)
  const [, setTriggeringCondition] = useState<string | null>(null)
  const [, setSepsisHighRisk] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [monitoringEnabled, setMonitoringEnabled] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<VitalsConnectionStatus>('idle')
  const [vitals, setVitals] = useState(DEFAULT_VITALS)
  const [hasVitalsFile, setHasVitalsFile] = useState(false)
  const [demoStarting, setDemoStarting] = useState(false)
  const [redSnapshot, setRedSnapshot] = useState<RedSnapshot | null>(null)
  const [dashboardSnapshot, setDashboardSnapshot] = useState<RedSnapshot | null>(null)
  const [showDashboard, setShowDashboard] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const shouldStreamRef = useRef(false)
  const reconnectTimerRef = useRef<number | null>(null)
  const triggeringConditionRef = useRef<string | null>(null)
  const sepsisHighRiskRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const csvInputRef = useRef<HTMLInputElement>(null)

  const clearLiveContext = () => {
    setTriageLevel(null)
    setDiseaseRisks(null)
    setDecision(null)
    setTriggeringCondition(null)
    triggeringConditionRef.current = null
    setSepsisHighRisk(false)
    sepsisHighRiskRef.current = false
    setRedSnapshot(null)
    setDashboardSnapshot(null)
    setShowDashboard(false)
    setVitals(DEFAULT_VITALS)
  }

  const stopVitalsMonitoring = (showToast = true) => {
    shouldStreamRef.current = false
    setMonitoringEnabled(false)
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (wsRef.current) {
      const socket = wsRef.current
      wsRef.current = null
      socket.close()
    }
    setIsStreaming(false)
    setConnectionStatus('stopped')
    if (caseId) setAppStatus('RENDERED')
    if (showToast) toast.info('실시간 모니터링이 중지되었습니다.')
  }

  const handleSignOut = async () => {
    stopVitalsMonitoring(false)
    resetMedicalState()
    clearLiveContext()
    setHasVitalsFile(false)
    setConnectionStatus('idle')
    await signOut()
    toast.success('데모 세션 및 Case 상태가 초기화되었습니다.')
  }

  useEffect(() => {
    return () => {
      shouldStreamRef.current = false
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current)
      if (wsRef.current) wsRef.current.close()
    }
  }, [])

  const refreshSignedUrl = async (id: string) => {
    const data = await getSignedUrl(id)
    setModelUrl(data.glb_url || data.signed_url)
    setExpiresAt(data.expires_at)
    toast.info('의료 3D 모델 보안 링크가 자동 갱신되었습니다.')
  }

  const { handleLoadFailure } = useSignedUrlRefresh({
    meshId,
    expiresAt,
    onRefresh: refreshSignedUrl,
    onError: () => toast.error('모델 보안 링크가 만료되었습니다. 다시 로드해주세요.'),
  })

  const applyImageResult = (data: {
    case_id?: string
    patient_id: string
    glb_url: string
    signed_url: string
    mesh_id: string
    expires_at: number
    lesion_volume: number
  }) => {
    const resolvedCaseId = data.case_id || data.patient_id
    setCaseId(resolvedCaseId)
    setPatientId(resolvedCaseId)
    setModelUrl(data.glb_url || data.signed_url)
    setMeshId(data.mesh_id)
    setExpiresAt(data.expires_at)
    setLesionVolume(data.lesion_volume)
    setAppStatus('RENDERED')
    return resolvedCaseId
  }

  const scheduleReconnect = (activeCaseId: string, volume: number) => {
    if (!shouldStreamRef.current || reconnectTimerRef.current !== null) return
    setConnectionStatus('reconnecting')
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null
      if (shouldStreamRef.current) void connectVitalsStream(activeCaseId, volume, true)
    }, 1000)
  }

  const connectVitalsStream = async (
    activeCaseId: string,
    volume: number,
    isReconnect = false,
  ) => {
    if (!activeCaseId) return
    setConnectionStatus(isReconnect ? 'reconnecting' : 'connecting')

    let accessToken: string
    try {
      const session = await ensureDemoSession()
      accessToken = session.access_token
    } catch (error) {
      setConnectionStatus('error')
      shouldStreamRef.current = false
      setMonitoringEnabled(false)
      toast.error(error instanceof DemoSessionError ? error.message : '인증 토큰을 준비할 수 없습니다.')
      return
    }

    if (!shouldStreamRef.current) return

    const ws = new WebSocket(getCaseWebSocketUrl(activeCaseId))
    wsRef.current = ws

    ws.onopen = () => {
      if (wsRef.current !== ws) return
      setIsStreaming(true)
      setConnectionStatus('connected')
      setAppStatus('STREAMING')
      ws.send(JSON.stringify({ type: 'auth', access_token: accessToken, case_id: activeCaseId, volume }))
      if (!isReconnect) toast.success('Case Vitals Replay가 시작되었습니다.')
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.status === 'error') {
        toast.error(data.message || 'Vitals Replay 중 오류가 발생했습니다.')
        return
      }
      if (data.status === 'completed') {
        ws.close()
        return
      }
      if (data.vitals) {
        setVitals({
          hr: data.vitals.hr,
          bpSys: data.vitals.bp_sys,
          bpDia: data.vitals.bp_dia,
          resp: data.vitals.resp,
          temp: data.vitals.temp,
          spo2: data.vitals.spo2,
        })
      }
      if (data.disease_risks) setDiseaseRisks(data.disease_risks)
      if (data.decision) setDecision(data.decision)
      if (data.triggering_condition !== undefined) {
        triggeringConditionRef.current = data.triggering_condition
        setTriggeringCondition(data.triggering_condition)
      }
      if (data.sepsis_high_risk !== undefined) {
        sepsisHighRiskRef.current = Boolean(data.sepsis_high_risk)
        setSepsisHighRisk(Boolean(data.sepsis_high_risk))
      }
      if (data.triage_level) {
        const nextTriageLevel = String(data.triage_level)
        setRedSnapshot((current) => reduceRedSnapshot(current, {
          patientId: activeCaseId,
          triageLevel: nextTriageLevel,
          lesionVolume: volume,
          triggeringCondition: triggeringConditionRef.current,
          hasSepsisRisk: sepsisHighRiskRef.current,
          modality,
        }))
        setTriageLevel(nextTriageLevel)
      }
    }

    ws.onclose = (event) => {
      if (wsRef.current === ws) wsRef.current = null
      setIsStreaming(false)
      if (!shouldStreamRef.current) {
        setConnectionStatus('stopped')
        return
      }
      if (event.code === 4401) {
        shouldStreamRef.current = false
        setMonitoringEnabled(false)
        setConnectionStatus('error')
        toast.error('WebSocket 인증 또는 Preview Origin 검증에 실패했습니다.')
        return
      }
      if (event.code === 4429) {
        shouldStreamRef.current = false
        setMonitoringEnabled(false)
        setConnectionStatus('error')
        toast.error('WebSocket 요청 한도를 초과했습니다. 잠시 후 다시 시작해주세요.')
        return
      }
      scheduleReconnect(activeCaseId, volume)
    }

    ws.onerror = () => {
      if (shouldStreamRef.current) setConnectionStatus('reconnecting')
    }
  }

  const startVitalsMonitoring = async (activeCaseId = caseId, volume = lesionVolume) => {
    if (!activeCaseId) {
      toast.error('Case가 없습니다. Demo Case를 실행하거나 의료영상을 먼저 연결하세요.')
      return
    }
    if (!hasVitalsFile) {
      toast.error('이 Case에 연결된 Vitals가 없습니다.')
      return
    }
    shouldStreamRef.current = true
    setMonitoringEnabled(true)
    await connectVitalsStream(activeCaseId, volume)
  }

  const toggleStreaming = () => {
    if (monitoringEnabled) stopVitalsMonitoring()
    else void startVitalsMonitoring()
  }

  const startDemoCase = async () => {
    stopVitalsMonitoring(false)
    clearLiveContext()
    setDemoStarting(true)
    setHasVitalsFile(false)
    setAppStatus('PROCESSING')
    setModality('Brain')
    const toastId = toast.loading('Demo Case 준비 중 · Render가 휴면 상태면 최초 실행에 시간이 걸릴 수 있습니다.')
    try {
      await ensureDemoSession()
      const demo = await bootstrapTransferDemoCase()
      const activeCaseId = applyImageResult(demo.image)
      setHasVitalsFile(true)
      toast.success(`Demo Case ${activeCaseId} 준비 완료`, { id: toastId })
      shouldStreamRef.current = true
      setMonitoringEnabled(true)
      await connectVitalsStream(activeCaseId, demo.image.lesion_volume)
    } catch (error: any) {
      setAppStatus('IDLE')
      setConnectionStatus('error')
      toast.error(error?.response?.data?.detail || error?.message || 'Demo Case 실행에 실패했습니다.', { id: toastId })
    } finally {
      setDemoStarting(false)
    }
  }

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const context = await createCaseContext()
      return processMedicalMaskForCase(context.case_id, file, modality)
    },
    onMutate: () => {
      stopVitalsMonitoring(false)
      clearLiveContext()
      setHasVitalsFile(false)
      setAppStatus('PROCESSING')
      return { toastId: toast.loading(isDemoMode ? `[${modality}] 합성 3D 의료영상 처리 및 Case 생성 중...` : `[${modality}] 의료영상 처리 중...`) }
    },
    onSuccess: (data, _variables, context) => {
      const activeCaseId = applyImageResult(data)
      toast.success(`Case ${activeCaseId} 영상 Context 연결 완료`, { id: context?.toastId })
    },
    onError: (error: any, _variables, context) => {
      setAppStatus('IDLE')
      toast.error(error?.response?.data?.detail || error?.message || '의료영상 처리에 실패했습니다.', { id: context?.toastId })
    },
    onSettled: () => {
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
  })

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const validExtensions = ['.npy', '.nii', '.nii.gz']
    if (!validExtensions.some((ext) => file.name.endsWith(ext))) {
      toast.error('오류: .npy 또는 .nii.gz 형태의 마스크 파일만 지원합니다.')
      event.target.value = ''
      return
    }
    try {
      await ensureDemoSession()
      uploadMutation.mutate(file)
    } catch (error) {
      toast.error(error instanceof DemoSessionError ? error.message : '인증 토큰을 준비할 수 없습니다.')
      event.target.value = ''
    }
  }

  const handleCsvUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!caseId) {
      toast.error('먼저 Case 의료영상을 연결하세요.')
      event.target.value = ''
      return
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('CSV 파일만 업로드 가능합니다.')
      event.target.value = ''
      return
    }
    stopVitalsMonitoring(false)
    clearLiveContext()
    try {
      await uploadVitalsForCase(caseId, file)
      setHasVitalsFile(true)
      setConnectionStatus('idle')
      toast.success(`Vitals가 Case ${caseId}에 연결되었습니다.`)
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Vitals 업로드에 실패했습니다.')
    } finally {
      event.target.value = ''
    }
  }

  const getStatusColor = () => {
    if (connectionStatus === 'error') return '#ef4444'
    if (connectionStatus === 'reconnecting' || connectionStatus === 'connecting') return '#fbbf24'
    if (connectionStatus === 'connected') return '#f472b6'
    if (appStatus === 'PROCESSING') return '#60a5fa'
    if (appStatus === 'RENDERED') return '#4ade80'
    return '#9ca3af'
  }

  const getStatusText = () => {
    if (connectionStatus === 'connecting') return 'Case Vitals 연결 중...'
    if (connectionStatus === 'connected') return 'Case Vitals 실시간 Replay 중'
    if (connectionStatus === 'reconnecting') return '재연결 중 · 마지막 정상 값을 유지합니다.'
    if (connectionStatus === 'error') return '연결 오류'
    if (connectionStatus === 'stopped') return '모니터링 중지됨'
    if (appStatus === 'PROCESSING') return 'Case 준비 중...'
    if (appStatus === 'RENDERED') return 'Case 준비 완료 (모니터링 대기)'
    return '대기 중'
  }

  const getTriageColor = (level: string | null) => {
    if (!level) return '#94a3b8'
    if (level.includes('RED')) return '#ef4444'
    if (level.includes('YELLOW')) return '#eab308'
    if (level.includes('GREEN')) return '#22c55e'
    return '#94a3b8'
  }

  const getTriageDisplayText = (level: string | null) => {
    if (!level) return '응급도 계산 대기 중'
    if (level.trim().toUpperCase().startsWith('RED')) return 'RED (초응급 - 전신 악화 위험)'
    return level
  }

  const isTriageActionable = Boolean(triageLevel && (triageLevel.includes('YELLOW') || triageLevel.includes('RED')))

  const openLiveTriageDashboard = () => {
    if (!caseId || !triageLevel || !isTriageActionable) return
    const normalized = triageLevel.trim().toUpperCase()
    const snapshot = normalized.startsWith('RED') && redSnapshot ? { ...redSnapshot } : {
      patientId: caseId,
      triageLevel,
      lesionVolume,
      triggeringCondition: triggeringConditionRef.current,
      hasSepsisRisk: sepsisHighRiskRef.current,
      modality,
    }
    setDashboardSnapshot(snapshot)
    setShowDashboard(true)
  }

  return (
    <div className="app-container">
      <Toaster position="top-right" theme="dark" richColors />
      <header className="header">
        <div className="logo">
          <Brain className="icon" size={32} style={{ display: modality === 'Brain' ? 'block' : 'none' }} />
          <Stethoscope className="icon" size={32} style={{ display: modality === 'Lung' ? 'block' : 'none' }} />
          <h1>Medi-Matrix</h1>
        </div>
        <div style={{ margin: '0 auto', color: '#fbbf24', fontSize: '0.85rem', fontWeight: 700 }}>
          중증환자의 영상·Vitals를 전원 의사결정까지 연결하는 E2E 프로토타입 · 합성 데이터 데모
        </div>
        <div className="tabs">
          <button className={`tab ${modality === 'Brain' ? 'active' : ''}`} onClick={() => appStatus !== 'PROCESSING' && setModality('Brain')}><Brain size={18} /> Brain</button>
          <button className={`tab ${modality === 'Lung' ? 'active' : ''}`} onClick={() => appStatus !== 'PROCESSING' && setModality('Lung')}><Stethoscope size={18} /> Lung</button>
          <button className="tab" style={{ marginLeft: 'auto', backgroundColor: '#ef4444', color: 'white' }} onClick={handleSignOut}>데모 세션 초기화</button>
        </div>
      </header>

      <main className="main-content">
        <aside className="sidebar">
          <div className="control-group">
            <h3>Transfer Support Demo</h3>
            {isDemoMode && (
              <div style={{ padding: 12, backgroundColor: 'rgba(96,165,250,0.10)', border: '1px solid rgba(96,165,250,0.22)', borderRadius: 10, marginBottom: 14, fontSize: '0.82rem' }}>
                <strong style={{ color: '#60a5fa' }}>지역 응급실 → 상급병원 전원 지원</strong>
                <div style={{ marginTop: 6, color: '#d1d5db', lineHeight: 1.5 }}>현재 공개 버전은 PACS·EMR 연동 전 단계의 합성 입력 E2E 데모입니다. 임상 진단 또는 자동 전원 결정 시스템이 아닙니다.</div>
              </div>
            )}
            <button className="btn primary" onClick={() => void startDemoCase()} disabled={demoStarting || uploadMutation.isPending} data-testid="demo-case-button" style={{ width: '100%', marginBottom: 10, minHeight: 46 }}>
              {demoStarting ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
              {demoStarting ? 'Demo Case 준비 중...' : 'Demo Case 한 번에 실행'}
            </button>
            {caseId && (
              <div style={{ padding: '9px 10px', backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 8, marginBottom: 12, fontSize: '0.78rem' }}>
                <strong style={{ color: '#fff' }}>Case ID</strong><div style={{ color: '#60a5fa', fontFamily: 'monospace', marginTop: 3 }}>{caseId}</div><div style={{ color: '#9ca3af', marginTop: 3 }}>비식별 Demo Encounter ID · 병원 MRN이 아닙니다.</div>
              </div>
            )}
            <div className="slider-container"><label htmlFor="opacity-slider">투명도 (Opacity): {Math.round(opacity * 100)}%</label><input id="opacity-slider" type="range" min="0" max="1" step="0.05" value={opacity} onChange={(e) => setOpacity(parseFloat(e.target.value))} /></div>
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', color: '#a1a1aa', fontSize: '0.82rem' }}>직접 파일로 테스트 (MVP 입력 어댑터)</summary>
              <div className="action-buttons" style={{ marginTop: 10 }}>
                <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".npy,.nii,.nii.gz" onChange={handleFileUpload} />
                <button className="btn primary" onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending || monitoringEnabled}><Upload size={18} /> Case 의료영상 연결</button>
                <input type="file" ref={csvInputRef} onChange={handleCsvUpload} accept=".csv" style={{ display: 'none' }} />
                <button className="btn primary" onClick={() => csvInputRef.current?.click()} disabled={!caseId || appStatus === 'PROCESSING' || monitoringEnabled}><Upload size={18} /> {hasVitalsFile ? 'Case Vitals 연결 완료' : 'Case Vitals CSV 연결'}</button>
              </div>
            </details>
            <button className={`btn secondary ${monitoringEnabled ? 'streaming-active' : ''}`} disabled={!caseId || !hasVitalsFile || appStatus === 'PROCESSING'} onClick={toggleStreaming} style={{ width: '100%', marginTop: 12, backgroundColor: monitoringEnabled ? 'var(--grad-danger)' : undefined, color: monitoringEnabled ? 'white' : undefined }}>
              {monitoringEnabled ? <WifiOff size={18} /> : <Wifi size={18} />}{monitoringEnabled ? '실시간 모니터링 중단' : 'Case Vitals 모니터링 시작'}
            </button>
          </div>

          <div className="info-panel">
            <h3>Case Context</h3>
            {caseId ? (
              <div style={{ marginTop: '0.5rem' }}>
                <div style={{ padding: '0.75rem', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 8, marginBottom: '0.5rem', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <strong style={{ color: '#fff' }}>[Vision] 3D 병변 Context</strong><div style={{ color: '#60a5fa', fontSize: '1.05rem', marginTop: 4 }}>{lesionVolume.toLocaleString()} voxels</div>{isDemoMode && <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 5 }}>합성/결정론적 mask 기반 Vision demo · 검증된 AI segmentation 아님</div>}
                </div>
                {hasVitalsFile && (
                  <div data-testid="vitals-panel" style={{ padding: '0.75rem', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 8, marginBottom: '0.5rem', border: '1px solid rgba(255,255,255,0.05)', position: 'relative', overflow: 'hidden' }}>
                    {isStreaming && <div className="scanner-line" />}<strong style={{ color: '#fff' }}>[Vitals] Case 시계열 Replay</strong><div style={{ color: '#fbbf24', fontSize: '0.98rem', marginTop: 6 }}>HR {Math.round(vitals.hr)} bpm · BP {Math.round(vitals.bpSys)}/{Math.round(vitals.bpDia)} mmHg</div><div style={{ color: '#fbbf24', fontSize: '0.98rem', marginTop: 2 }}>Resp {Math.round(vitals.resp)}/min · Temp {vitals.temp.toFixed(1)}°C · SpO2 {Math.round(vitals.spo2)}%</div>
                    {connectionStatus === 'reconnecting' && <div style={{ color: '#fbbf24', fontSize: '0.73rem', marginTop: 7 }}>재연결 중 · 마지막 정상 Vitals 값을 유지하고 있습니다.</div>}
                    {diseaseRisks && <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8, marginTop: 8, fontSize: '0.82rem' }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Sepsis-like</span><strong>{diseaseRisks.sepsis}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>ARDS-like</span><strong>{diseaseRisks.ards}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Shock-like</span><strong>{diseaseRisks.shock}</strong></div></div>}
                  </div>
                )}
                {hasVitalsFile && (
                  <div data-testid="triage-panel" style={{ padding: '0.75rem', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 8, marginBottom: '0.5rem', border: `1px solid ${getTriageColor(triageLevel)}55` }}>
                    <strong style={{ color: '#fff' }}>Decision Engine · Demo Policy</strong>
                    {decision ? <div style={{ marginTop: 8, fontSize: '0.82rem', lineHeight: 1.55 }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Vitals Risk</span><span>{decision.vitals_risk.toFixed(2)}</span></div><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Vision Context</span><span>+{decision.vision_context.toFixed(2)}</span></div><div style={{ borderTop: '1px solid rgba(255,255,255,0.14)', marginTop: 4, paddingTop: 4, display: 'flex', justifyContent: 'space-between' }}><span>Triage Score</span><strong>{decision.triage_score.toFixed(2)}</strong></div></div> : <div style={{ color: '#9ca3af', fontSize: '0.78rem', marginTop: 7 }}>Vitals 수신 후 점수 계산이 시작됩니다.</div>}
                    <div style={{ color: getTriageColor(triageLevel), fontWeight: 800, fontSize: '1.15rem', marginTop: 8 }}>{getTriageDisplayText(triageLevel)}</div><div style={{ color: '#9ca3af', fontSize: '0.70rem', marginTop: 5 }}>현재 임계값은 제품 E2E 흐름 검증을 위한 데모 정책이며 임상 기준이 아닙니다.</div>
                    <button onClick={openLiveTriageDashboard} disabled={!isTriageActionable} style={{ marginTop: 10, width: '100%', padding: 9, borderRadius: 6, border: `1px solid ${getTriageColor(triageLevel)}`, backgroundColor: isTriageActionable ? `${getTriageColor(triageLevel)}22` : 'rgba(255,255,255,0.04)', color: isTriageActionable ? getTriageColor(triageLevel) : '#6b7280', cursor: isTriageActionable ? 'pointer' : 'not-allowed' }}><Activity size={17} style={{ verticalAlign: 'middle', marginRight: 6 }} />{triageLevel?.includes('RED') ? 'RED · 긴급 전원 병원 탐색' : triageLevel?.includes('YELLOW') ? 'YELLOW · 전원 병원 후보 확인' : '응급도 계산 후 Golden-Time 탐색 가능'}</button>
                  </div>
                )}
                <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8, fontSize: '0.78rem' }}><strong>연결 상태:</strong> <span style={{ color: getStatusColor(), fontWeight: 700 }}>{getStatusText()}</span></div>
              </div>
            ) : <p className="text-sm text-gray">`Demo Case 한 번에 실행`을 누르면 합성 Brain 영상과 Vitals가 하나의 Case로 연결됩니다.</p>}
          </div>
        </aside>
        <section className="viewer-container"><ThreeViewer onLoadFailure={handleLoadFailure} /></section>
      </main>

      {showDashboard && dashboardSnapshot && <EmergencyDashboard onClose={() => { setShowDashboard(false); setDashboardSnapshot(null) }} patientId={dashboardSnapshot.patientId} triageLevel={triageLevel ?? dashboardSnapshot.triageLevel} lesionVolume={dashboardSnapshot.lesionVolume} triggeringCondition={dashboardSnapshot.triggeringCondition} hasSepsisRisk={dashboardSnapshot.hasSepsisRisk} modality={dashboardSnapshot.modality} />}
    </div>
  )
}

function App() {
  return <AuthProvider><MainApp /></AuthProvider>
}

export default App
