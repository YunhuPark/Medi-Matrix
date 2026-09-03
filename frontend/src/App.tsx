import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Activity, Brain, Hospital, Loader2, Play, Stethoscope, Upload, Wifi, WifiOff } from 'lucide-react'
import { Toaster, toast } from 'sonner'

import { ThreeViewer } from './components/viewer/ThreeViewer'
import { EmergencyDashboard } from './components/dashboard/EmergencyDashboard'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { DemoSessionError, ensureDemoSession } from './auth/demoSession'
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

type DiseaseRisks = { sepsis: string; ards: string; shock: string }
type DecisionBreakdown = {
  policy: string
  clinical_rule: boolean
  vitals_risk: number
  vision_context: number
  triage_score: number
  yellow_threshold: number
  red_threshold: number
}

const INITIAL_VITALS = { hr: 80, bpSys: 120, bpDia: 80, resp: 16, temp: 36.5, spo2: 98 }

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
  const [diseaseRisks, setDiseaseRisks] = useState<DiseaseRisks | null>(null)
  const [decision, setDecision] = useState<DecisionBreakdown | null>(null)
  const [triggeringCondition, setTriggeringCondition] = useState<string | null>(null)
  const [hasSepsisRisk, setHasSepsisRisk] = useState(false)
  const [vitals, setVitals] = useState(INITIAL_VITALS)
  const [hasVitalsFile, setHasVitalsFile] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isBootstrapping, setIsBootstrapping] = useState(false)
  const [redSnapshot, setRedSnapshot] = useState<RedSnapshot | null>(null)
  const [dashboardSnapshot, setDashboardSnapshot] = useState<RedSnapshot | null>(null)
  const [showDashboard, setShowDashboard] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const shouldStreamRef = useRef(false)
  const reconnectTimerRef = useRef<number | null>(null)
  const lastStreamContextRef = useRef<{ caseId: string; volume: number; modality: 'Brain' | 'Lung' } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const csvInputRef = useRef<HTMLInputElement>(null)

  const resetLiveState = () => {
    setTriageLevel(null)
    setDiseaseRisks(null)
    setDecision(null)
    setTriggeringCondition(null)
    setHasSepsisRisk(false)
    setVitals(INITIAL_VITALS)
    setRedSnapshot(null)
    setDashboardSnapshot(null)
    setShowDashboard(false)
  }

  const stopStreaming = (showToast = true) => {
    shouldStreamRef.current = false
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setIsStreaming(false)
    if (appStatus === 'STREAMING') setAppStatus('RENDERED')
    if (showToast) toast.info('실시간 Vitals 모니터링을 중지했습니다.')
  }

  const handleSignOut = async () => {
    stopStreaming(false)
    resetMedicalState()
    resetLiveState()
    setHasVitalsFile(false)
    lastStreamContextRef.current = null
    await signOut()
    toast.success('데모 Case와 세션을 초기화했습니다.')
  }

  useEffect(() => {
    return () => {
      shouldStreamRef.current = false
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current)
      if (wsRef.current) wsRef.current.close()
    }
  }, [])

  const refreshSignedUrl = async (id: string) => {
    await ensureDemoSession()
    const data = await getSignedUrl(id)
    setModelUrl(data.glb_url || data.signed_url)
    setExpiresAt(data.expires_at)
    toast.info('3D 모델의 보안 링크를 갱신했습니다.')
  }

  const { handleLoadFailure } = useSignedUrlRefresh({
    meshId,
    expiresAt,
    onRefresh: refreshSignedUrl,
    onError: () => toast.error('3D 모델 보안 링크가 만료되었습니다. 다시 Case를 실행해주세요.'),
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

  const handleStreamMessage = (
    data: any,
    streamCaseId: string,
    volume: number,
    streamModality: 'Brain' | 'Lung',
  ) => {
    if (data.status === 'error') {
      toast.error(data.message || 'Case Vitals 스트리밍 오류가 발생했습니다.')
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
    if (data.triggering_condition !== undefined) setTriggeringCondition(data.triggering_condition)
    if (data.sepsis_high_risk !== undefined) setHasSepsisRisk(Boolean(data.sepsis_high_risk))

    if (data.triage_level) {
      const nextLevel = String(data.triage_level)
      setRedSnapshot(current => reduceRedSnapshot(current, {
        patientId: streamCaseId,
        triageLevel: nextLevel,
        lesionVolume: volume,
        triggeringCondition: data.triggering_condition ?? null,
        hasSepsisRisk: Boolean(data.sepsis_high_risk),
        modality: streamModality,
      }))
      setTriageLevel(nextLevel)
    }
  }

  const openCaseStream = async (
    streamCaseId: string,
    volume: number,
    reconnect = false,
    streamModality: 'Brain' | 'Lung' = modality,
  ) => {
    let session
    try {
      session = await ensureDemoSession()
    } catch (error) {
      toast.error(error instanceof DemoSessionError ? error.message : '인증 세션을 준비할 수 없습니다.')
      return
    }
    if (!session.access_token) {
      toast.error('인증 토큰이 없습니다.')
      return
    }

    lastStreamContextRef.current = { caseId: streamCaseId, volume, modality: streamModality }
    shouldStreamRef.current = true

    let wsUrl: string
    try {
      wsUrl = getCaseWebSocketUrl(streamCaseId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Case WebSocket URL을 만들 수 없습니다.')
      return
    }

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setIsStreaming(true)
      setAppStatus('STREAMING')
      if (!reconnect) toast.success('같은 Case에 연결된 Vitals Replay를 시작했습니다.')
      ws.send(JSON.stringify({
        type: 'auth',
        access_token: session.access_token,
        volume,
      }))
    }

    ws.onmessage = event => handleStreamMessage(JSON.parse(event.data), streamCaseId, volume, streamModality)

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null
      setIsStreaming(false)
      if (shouldStreamRef.current && reconnectTimerRef.current === null) {
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null
          const ctx = lastStreamContextRef.current
          if (shouldStreamRef.current && ctx) void openCaseStream(ctx.caseId, ctx.volume, true, ctx.modality)
        }, 1000)
      }
    }

    ws.onerror = () => {
      setIsStreaming(false)
      toast.error('WebSocket 통신 중 오류가 발생했습니다.')
    }
  }

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const activeCase = caseId || (await createCaseContext()).case_id
      if (!caseId) {
        setCaseId(activeCase)
        setPatientId(activeCase)
      }
      return processMedicalMaskForCase(activeCase, file, modality)
    },
    onMutate: () => {
      stopStreaming(false)
      resetLiveState()
      setHasVitalsFile(false)
      setAppStatus('PROCESSING')
      const toastId = toast.loading('합성 의료영상의 3D Context를 생성하고 있습니다...')
      return { toastId }
    },
    onSuccess: (data, _file, context) => {
      applyImageResult(data)
      toast.success('영상 Context를 현재 Case에 연결했습니다.', { id: context?.toastId })
    },
    onError: (error: any, _file, context) => {
      setAppStatus('IDLE')
      toast.error(error.response?.data?.detail || error.message || '영상 처리에 실패했습니다.', { id: context?.toastId })
    },
    onSettled: () => {
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
  })

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!['.npy', '.nii', '.nii.gz'].some(ext => file.name.toLowerCase().endsWith(ext))) {
      toast.error('.npy, .nii, .nii.gz 파일만 지원합니다.')
      return
    }
    uploadMutation.mutate(file)
  }

  const handleCsvUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('CSV 파일만 업로드할 수 있습니다.')
      return
    }
    if (!caseId) {
      toast.error('먼저 영상 Context를 생성해 Case를 준비해주세요.')
      return
    }
    try {
      toast.info('Vitals를 같은 Case에 연결하고 있습니다...')
      await uploadVitalsForCase(caseId, file)
      setHasVitalsFile(true)
      toast.success(`Vitals가 ${caseId} Case에 연결되었습니다.`)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Vitals 업로드에 실패했습니다.')
    }
  }

  const handleOneClickDemo = async () => {
    if (!isDemoMode || isBootstrapping) return
    stopStreaming(false)
    resetMedicalState()
    resetLiveState()
    setHasVitalsFile(false)
    setIsBootstrapping(true)
    setAppStatus('PROCESSING')
    const toastId = toast.loading('전원 지원 Demo Case를 준비하고 있습니다...')
    try {
      const demo = await bootstrapTransferDemoCase()
      setModality('Brain')
      const resolvedCaseId = applyImageResult(demo.image)
      setHasVitalsFile(true)
      toast.success(`${demo.scenario_label} Case가 준비되었습니다.`, { id: toastId })
      await openCaseStream(resolvedCaseId, demo.image.lesion_volume, false, 'Brain')
    } catch (error: any) {
      setAppStatus('IDLE')
      toast.error(error.response?.data?.detail || error.message || 'Demo Case 실행에 실패했습니다.', { id: toastId })
    } finally {
      setIsBootstrapping(false)
    }
  }

  const toggleStreaming = async () => {
    if (isStreaming) {
      stopStreaming()
      return
    }
    if (!caseId || !hasVitalsFile) {
      toast.error('영상과 Vitals가 연결된 Case가 필요합니다.')
      return
    }
    await openCaseStream(caseId, lesionVolume, false, modality)
  }

  const getTriageColor = (level: string | null) => {
    if (!level) return '#94a3b8'
    if (level.includes('RED')) return '#ef4444'
    if (level.includes('YELLOW')) return '#eab308'
    if (level.includes('GREEN')) return '#22c55e'
    return '#94a3b8'
  }

  const isTriageActionable = Boolean(triageLevel && (triageLevel.includes('YELLOW') || triageLevel.includes('RED')))

  const openLiveTriageDashboard = () => {
    if (!triageLevel || !isTriageActionable) return
    const normalized = triageLevel.trim().toUpperCase()
    const snapshot = normalized.startsWith('RED') && redSnapshot
      ? { ...redSnapshot }
      : {
          patientId: caseId,
          triageLevel,
          lesionVolume,
          triggeringCondition,
          hasSepsisRisk,
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
          <Hospital className="icon" size={30} />
          <div>
            <h1 style={{ margin: 0 }}>Medi-Matrix</h1>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Inter-hospital Transfer Decision Support Prototype</div>
          </div>
        </div>
        <div style={{ margin: '0 auto', color: '#fbbf24', fontSize: '0.82rem', fontWeight: 700 }}>
          합성 입력 기반 공모전 프로토타입 · 임상 진단/전원 지시 시스템 아님
        </div>
        <div className="tabs">
          <button className={`tab ${modality === 'Brain' ? 'active' : ''}`} onClick={() => setModality('Brain')} disabled={appStatus === 'PROCESSING'}>
            <Brain size={18} /> Brain
          </button>
          <button className={`tab ${modality === 'Lung' ? 'active' : ''}`} onClick={() => setModality('Lung')} disabled={appStatus === 'PROCESSING'}>
            <Stethoscope size={18} /> Lung
          </button>
          <button className="tab" onClick={handleSignOut} style={{ marginLeft: 'auto' }}>Case 초기화</button>
        </div>
      </header>

      <div style={{ margin: '0 1rem 1rem', padding: '14px 16px', border: '1px solid rgba(96,165,250,.35)', borderRadius: 12, background: 'rgba(30,64,175,.12)' }}>
        <strong style={{ color: '#93c5fd' }}>현실 타깃: 지역 응급실 → 상급병원 전원 지원</strong>
        <div style={{ marginTop: 5, color: '#cbd5e1', fontSize: '0.86rem', lineHeight: 1.45 }}>
          이미 응급실에서 영상과 Vitals가 확보된 중증환자에게 상급 치료가 필요할 때, 하나의 Case로 상태 Context를 묶고 필요한 의료자원에 맞춰 전원 병원 후보 탐색까지 연결합니다.
          현재 업로드 UI는 PACS·EMR/환자모니터 연동 전 MVP 입력 어댑터입니다.
        </div>
      </div>

      <main className="main-content">
        <aside className="sidebar">
          <div className="control-group">
            <h3>Transfer Demo</h3>

            {isDemoMode && (
              <button
                className="btn primary"
                onClick={handleOneClickDemo}
                disabled={isBootstrapping || uploadMutation.isPending}
                style={{ width: '100%', marginBottom: 12, background: 'linear-gradient(135deg,#2563eb,#7c3aed)' }}
              >
                {isBootstrapping ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
                {isBootstrapping ? 'Demo Case 준비 중...' : 'Demo Case 한 번에 실행'}
              </button>
            )}

            <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,.06)', marginBottom: 12, fontSize: '0.8rem' }}>
              <div><strong>Case ID:</strong> <span style={{ color: '#60a5fa' }}>{caseId || '아직 생성되지 않음'}</span></div>
              <div style={{ marginTop: 4, color: '#94a3b8' }}>Case ID는 환자명/MRN이 아닌 비식별 데모 Encounter 키입니다.</div>
            </div>

            <div className="slider-container">
              <label htmlFor="opacity-slider">3D 투명도: {Math.round(opacity * 100)}%</label>
              <input id="opacity-slider" type="range" min="0" max="1" step="0.05" value={opacity} onChange={e => setOpacity(parseFloat(e.target.value))} />
            </div>

            <div className="action-buttons">
              <input ref={fileInputRef} type="file" accept=".npy,.nii,.nii.gz" onChange={handleFileUpload} style={{ display: 'none' }} />
              <button className="btn primary" onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending || isStreaming}>
                <Upload size={18} /> 수동 영상 Context 업로드
              </button>

              <input ref={csvInputRef} type="file" accept=".csv" onChange={handleCsvUpload} style={{ display: 'none' }} />
              <button className="btn primary" onClick={() => csvInputRef.current?.click()} disabled={!caseId || appStatus === 'PROCESSING' || isStreaming} style={{ backgroundColor: hasVitalsFile ? '#10b981' : undefined }}>
                <Upload size={18} /> {hasVitalsFile ? 'Vitals Case 연결 완료' : '같은 Case에 Vitals 연결'}
              </button>

              <button className={`btn secondary ${isStreaming ? 'streaming-active' : ''}`} onClick={toggleStreaming} disabled={!caseId || !hasVitalsFile || appStatus === 'PROCESSING'}>
                {isStreaming ? <WifiOff size={18} /> : <Wifi size={18} />}
                {isStreaming ? 'Vitals 모니터링 중단' : 'Case Vitals 모니터링 시작'}
              </button>
            </div>
          </div>

          <div className="info-panel">
            <h3>Patient Context</h3>
            {caseId ? (
              <>
                <div style={{ padding: '0.75rem', backgroundColor: 'rgba(0,0,0,.2)', borderRadius: 8, marginBottom: 8 }}>
                  <strong>[Vision] 3D 병변 Context</strong><br />
                  <span style={{ color: '#60a5fa', fontSize: '1.05rem' }}>{lesionVolume.toLocaleString()} voxels</span>
                  {isDemoMode && <div style={{ color: '#94a3b8', fontSize: '0.72rem', marginTop: 4 }}>합성 demo mask 기반 · 실제 MRI 병변 진단 아님</div>}
                </div>

                {(isStreaming || diseaseRisks) && (
                  <div style={{ padding: '0.75rem', backgroundColor: 'rgba(0,0,0,.2)', borderRadius: 8, marginBottom: 8 }}>
                    <strong>[Vitals] Case 시계열</strong><br />
                    <span style={{ color: '#fbbf24' }}>HR {Math.round(vitals.hr)} · BP {Math.round(vitals.bpSys)}/{Math.round(vitals.bpDia)} · Resp {Math.round(vitals.resp)} · SpO₂ {Math.round(vitals.spo2)}%</span>
                    {diseaseRisks && (
                      <div style={{ marginTop: 8, fontSize: '0.8rem', color: '#cbd5e1' }}>
                        Sepsis-like {diseaseRisks.sepsis} · ARDS-like {diseaseRisks.ards} · Shock-like {diseaseRisks.shock}
                      </div>
                    )}
                  </div>
                )}

                {decision && (
                  <div style={{ padding: '0.75rem', backgroundColor: 'rgba(59,130,246,.08)', border: '1px solid rgba(96,165,250,.25)', borderRadius: 8, marginBottom: 8 }}>
                    <strong>Decision Engine · Demo Policy</strong>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 10px', marginTop: 8, fontSize: '0.82rem' }}>
                      <span>Vitals risk</span><strong>{decision.vitals_risk.toFixed(2)}</strong>
                      <span>Vision context</span><strong>+ {decision.vision_context.toFixed(2)}</strong>
                      <span style={{ borderTop: '1px solid #334155', paddingTop: 5 }}>Triage score</span><strong style={{ borderTop: '1px solid #334155', paddingTop: 5 }}>{decision.triage_score.toFixed(2)}</strong>
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: '0.7rem', marginTop: 6 }}>YELLOW ≥ {decision.yellow_threshold} · RED ≥ {decision.red_threshold} · 임상 기준 아님</div>
                  </div>
                )}

                {triageLevel && (
                  <div style={{ padding: '0.75rem', backgroundColor: 'rgba(0,0,0,.2)', borderRadius: 8, border: `1px solid ${getTriageColor(triageLevel)}55` }}>
                    <strong>현재 Demo Triage</strong><br />
                    <span style={{ color: getTriageColor(triageLevel), fontSize: '1.1rem', fontWeight: 800 }}>{triageLevel}</span>
                    {isTriageActionable && (
                      <button onClick={openLiveTriageDashboard} style={{ marginTop: 10, width: '100%', padding: 10, borderRadius: 7, border: `1px solid ${getTriageColor(triageLevel)}`, background: 'rgba(15,23,42,.8)', color: getTriageColor(triageLevel), fontWeight: 700, cursor: 'pointer' }}>
                        <Activity size={17} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                        전원 병원 탐색 Context 확인
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-gray">위의 Demo Case 버튼을 누르면 영상과 Vitals가 같은 비식별 Case로 자동 연결됩니다.</p>
            )}
          </div>
        </aside>

        <section className="viewer-container">
          <ThreeViewer onLoadFailure={handleLoadFailure} />
        </section>
      </main>

      {showDashboard && dashboardSnapshot && (
        <EmergencyDashboard
          onClose={() => {
            setShowDashboard(false)
            setDashboardSnapshot(null)
          }}
          patientId={dashboardSnapshot.patientId}
          triageLevel={triageLevel}
          lesionVolume={dashboardSnapshot.lesionVolume}
          triggeringCondition={dashboardSnapshot.triggeringCondition}
          hasSepsisRisk={dashboardSnapshot.hasSepsisRisk}
          modality={dashboardSnapshot.modality}
        />
      )}
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  )
}

export default App
