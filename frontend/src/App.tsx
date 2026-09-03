import { useRef, useState, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ThreeViewer } from './components/viewer/ThreeViewer'
import { useViewerStore } from './store/useViewerStore'
import { Upload, Brain, Activity, Loader2, Stethoscope, Wifi, WifiOff } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { processMedicalMask, uploadVitals } from './api/medicalApi'
import { EmergencyDashboard } from './components/dashboard/EmergencyDashboard'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { getWebSocketUrl } from './lib/websocketUrl'
import { useSignedUrlRefresh } from './hooks/useSignedUrlRefresh'
import { getSignedUrl } from './api/medicalApi'
import { ensureDemoSession, DemoSessionError } from './auth/demoSession'
import { reduceRedSnapshot, type RedSnapshot } from './lib/redSnapshot'
import './App.css'

type VitalsConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'stopped'

function MainApp() {
  const isDemoMode = import.meta.env.VITE_INFERENCE_MODE !== 'model';

  const { 
    opacity, setOpacity, 
    modality, setModality,
    setModelUrl,
    patientId, setPatientId,
    meshId, setMeshId,
    expiresAt, setExpiresAt,
    lesionVolume, setLesionVolume,
    appStatus, setAppStatus,
    resetMedicalState,
  } = useViewerStore()
  
  const { signOut } = useAuth()

  const [triageLevel, setTriageLevel] = useState<string | null>(null)
  const [diseaseRisks, setDiseaseRisks] = useState<{sepsis: string, ards: string, shock: string} | null>(null)
  const [, setTriggeringCondition] = useState<string | null>(null)
  const [, setSepsisHighRisk] = useState<boolean>(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [monitoringEnabled, setMonitoringEnabled] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<VitalsConnectionStatus>('idle')
  const [vitals, setVitals] = useState({ hr: 80, bpSys: 120, bpDia: 80, resp: 16, temp: 36.5, spo2: 98 })
  const [hasVitalsFile, setHasVitalsFile] = useState(false)
  const [redSnapshot, setRedSnapshot] = useState<RedSnapshot | null>(null)
  const [dashboardSnapshot, setDashboardSnapshot] = useState<RedSnapshot | null>(null)
  const [showDashboard, setShowDashboard] = useState(false)
  
  const wsRef = useRef<WebSocket | null>(null)
  const intervalRef = useRef<number | null>(null)
  const shouldStreamRef = useRef(false)
  const reconnectTimerRef = useRef<number | null>(null)
  const triggeringConditionRef = useRef<string | null>(null)
  const sepsisHighRiskRef = useRef(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const csvInputRef = useRef<HTMLInputElement>(null)

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
    if (patientId) setAppStatus('RENDERED')
    if (showToast) toast.info('실시간 모니터링이 중지되었습니다.')
  }

  const handleSignOut = async () => {
    resetMedicalState()
    stopVitalsMonitoring(false)
    setTriageLevel(null)
    setDiseaseRisks(null)
    setTriggeringCondition(null)
    triggeringConditionRef.current = null
    setSepsisHighRisk(false)
    sepsisHighRiskRef.current = false
    setRedSnapshot(null)
    setDashboardSnapshot(null)
    setShowDashboard(false)
    setHasVitalsFile(false)
    setConnectionStatus('idle')
    setVitals({ hr: 80, bpSys: 120, bpDia: 80, resp: 16, temp: 36.5, spo2: 98 })
    await signOut()
    toast.success('데모 세션 및 상태가 초기화되었습니다.')
  }

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.csv')) {
      toast.error('CSV 파일만 업로드 가능합니다.')
      return
    }

    try {
      await ensureDemoSession()
      toast.info('CSV 업로드 중...')
      const response = await uploadVitals(file)

      if (response.status === 'success' || response) {
        if (monitoringEnabled) stopVitalsMonitoring(false)
        setHasVitalsFile(true)
        setTriageLevel(null)
        setDiseaseRisks(null)
        setTriggeringCondition(null)
        triggeringConditionRef.current = null
        setSepsisHighRisk(false)
        sepsisHighRiskRef.current = false
        setRedSnapshot(null)
        setDashboardSnapshot(null)
        setShowDashboard(false)
        setConnectionStatus('idle')
        toast.success(isDemoMode ? '합성 Vitals 데이터 연동 완료' : 'Vitals 데이터 연동 완료')
      } else {
        toast.error('업로드 실패: 2단계 합성 Vitals CSV 업로드 중 오류가 발생했습니다.')
      }
    } catch (error) {
      if (error instanceof DemoSessionError) {
        toast.error(`인증 실패: ${error.message}`)
      } else {
        toast.error('통신 실패: 백엔드 서버와 연결할 수 없습니다.')
      }
    } finally {
      if (csvInputRef.current) csvInputRef.current.value = ''
    }
  }

  useEffect(() => {
    return () => {
      shouldStreamRef.current = false
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current)
      if (wsRef.current) wsRef.current.close()
      if (intervalRef.current) window.clearInterval(intervalRef.current)
    }
  }, [])

  const refreshSignedUrl = async (id: string) => {
    try {
      await ensureDemoSession();
      const data = await getSignedUrl(id);
      setModelUrl(data.glb_url || data.signed_url);
      setExpiresAt(data.expires_at);
      toast.info("의료 3D 모델 보안 링크가 자동 갱신되었습니다.");
    } catch (error) {
      if (error instanceof DemoSessionError) {
        toast.error(error.message);
      }
      throw error;
    }
  };

  const handleRefreshError = (_errorMsg: string) => {
    toast.error("모델 보안 링크가 만료되었습니다. 페이지를 새로고침하거나 다시 로드해주세요.");
  };

  const { handleLoadFailure } = useSignedUrlRefresh({
    meshId,
    expiresAt,
    onRefresh: refreshSignedUrl,
    onError: handleRefreshError,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => processMedicalMask(file, modality),
    onMutate: () => {
      stopVitalsMonitoring(false)
      setAppStatus('PROCESSING')
      setDiseaseRisks(null)
      setTriggeringCondition(null)
      triggeringConditionRef.current = null
      setSepsisHighRisk(false)
      sepsisHighRiskRef.current = false
      setTriageLevel(null)
      setRedSnapshot(null)
      setDashboardSnapshot(null)
      setShowDashboard(false)
      const toastId = toast.loading(
        isDemoMode
          ? `[${modality}] 합성 3D 의료영상 처리 및 메쉬 생성 중...`
          : `[${modality}] AI가 종양을 분석 및 분할 중입니다 (PyTorch Inference)...`
      )
      return { toastId }
    },
    onSuccess: (data, _variables, context) => {
      toast.success(
        isDemoMode
          ? `[${modality}] 합성 3D 메쉬 생성 및 렌더링 완료!`
          : `[${modality}] AI 3D 메쉬 생성 및 렌더링 완료!`,
        { id: context?.toastId }
      )
      setModelUrl(data.glb_url || data.signed_url)
      setPatientId(data.patient_id)
      setMeshId(data.mesh_id)
      setExpiresAt(data.expires_at)
      setLesionVolume(data.lesion_volume)
      setAppStatus('RENDERED')
    },
    onError: (error: any, _variables, context) => {
      setAppStatus('IDLE')
      toast.error(
        error.response?.data?.detail || error.message || '업로드 실패: 1단계 합성 MRI 처리 중 오류가 발생했습니다.', 
        { id: context?.toastId }
      )
    },
    onSettled: () => {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  })

  const scheduleReconnect = () => {
    if (!shouldStreamRef.current || reconnectTimerRef.current !== null) return
    setConnectionStatus('reconnecting')
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null
      if (shouldStreamRef.current) void connectVitalsStream(true)
    }, 1000)
  }

  const connectVitalsStream = async (isReconnect = false) => {
    if (!patientId || !shouldStreamRef.current) return

    setConnectionStatus(isReconnect ? 'reconnecting' : 'connecting')

    let accessToken: string | null = null
    try {
      const session = await ensureDemoSession()
      accessToken = session.access_token
    } catch (error) {
      setConnectionStatus('error')
      if (error instanceof DemoSessionError) toast.error(error.message)
      else toast.error('인증 토큰을 준비할 수 없습니다.')
      return
    }

    if (!accessToken) {
      setConnectionStatus('error')
      toast.error('인증 토큰이 만료되었습니다. 다시 로그인해주세요.')
      return
    }

    const ws = new WebSocket(getWebSocketUrl())
    wsRef.current = ws

    ws.onopen = () => {
      if (!shouldStreamRef.current) {
        ws.close()
        return
      }
      setIsStreaming(true)
      setConnectionStatus('connected')
      setAppStatus('STREAMING')
      ws.send(JSON.stringify({
        type: 'auth',
        access_token: accessToken,
        patient_id: patientId,
        volume: lesionVolume,
      }))
      if (!isReconnect) {
        toast.success(isDemoMode ? '합성 Vitals 데이터 스트리밍(Replay)이 시작되었습니다.' : 'Vitals 데이터 스트리밍이 시작되었습니다.')
      }
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)

      if (data.status === 'error') {
        toast.error(data.message || 'Vitals 스트리밍 중 오류가 발생했습니다.')
        return
      }

      // 최신 백엔드는 cycle(replay_rows)로 같은 연결에서 계속 반복합니다.
      // 구버전 백엔드의 completed 이벤트만 호환 차원에서 안전하게 재연결합니다.
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
        setRedSnapshot(current => reduceRedSnapshot(current, {
          patientId,
          triageLevel: nextTriageLevel,
          lesionVolume,
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
        setConnectionStatus('error')
        shouldStreamRef.current = false
        setMonitoringEnabled(false)
        toast.error('Vitals 연결 인증 또는 허용 Origin을 확인해주세요.')
        return
      }
      if (event.code === 4429) {
        setConnectionStatus('error')
        shouldStreamRef.current = false
        setMonitoringEnabled(false)
        toast.error('Vitals 연결 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.')
        return
      }

      scheduleReconnect()
    }

    ws.onerror = () => {
      if (shouldStreamRef.current) setConnectionStatus('reconnecting')
    }
  }

  const startVitalsMonitoring = () => {
    if (!patientId) {
      toast.error('환자 ID가 없습니다. 먼저 MRI를 업로드하세요.')
      return
    }
    shouldStreamRef.current = true
    setMonitoringEnabled(true)
    void connectVitalsStream(false)
  }

  const toggleStreaming = () => {
    if (monitoringEnabled) stopVitalsMonitoring()
    else startVitalsMonitoring()
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const validExtensions = ['.npy', '.nii', '.nii.gz']
    if (!validExtensions.some(ext => file.name.endsWith(ext))) {
      toast.error('오류: .npy 또는 .nii.gz 형태의 마스크 파일만 지원합니다.')
      event.target.value = ''
      return
    }

    try {
      await ensureDemoSession();
      uploadMutation.mutate(file);
    } catch (error) {
      if (error instanceof DemoSessionError) toast.error(error.message);
      else toast.error('인증 토큰을 준비할 수 없습니다.');
      event.target.value = '';
    }
  }

  const getStatusColor = () => {
    if (connectionStatus === 'reconnecting' || connectionStatus === 'connecting') return '#fbbf24'
    if (connectionStatus === 'error') return '#ef4444'
    switch(appStatus) {
      case 'IDLE': return '#9ca3af'
      case 'PROCESSING': return '#60a5fa'
      case 'RENDERED': return '#4ade80'
      case 'STREAMING': return '#f472b6'
      case 'SENT': return '#a78bfa'
      default: return '#9ca3af'
    }
  }

  const getStatusGlowClass = () => {
    switch(appStatus) {
      case 'PROCESSING': return 'status-glow-processing'
      case 'RENDERED': return 'status-glow-success'
      case 'STREAMING': return 'status-glow-streaming'
      case 'SENT': return 'status-glow-sent'
      default: return ''
    }
  }

  const getStatusText = () => {
    if (connectionStatus === 'connecting') return 'Vitals 연결 중...'
    if (connectionStatus === 'reconnecting') return 'Vitals 재연결 중... (마지막 수신값 유지)'
    if (connectionStatus === 'error') return 'Vitals 연결 오류'
    if (connectionStatus === 'stopped') return '모니터링 중지됨'
    switch(appStatus) {
      case 'IDLE': return '대기 중'
      case 'PROCESSING': return '분석 및 렌더링 중...'
      case 'RENDERED': return '렌더링 완료 (모니터링 대기)'
      case 'STREAMING': return '실시간 생체 모니터링 중...'
      case 'SENT': return 'Triage 서버 전송 완료'
      default: return '알 수 없음'
    }
  }

  const getTriageColor = (level: string | null) => {
    if (!level) return '#9ca3af'
    if (level.includes('RED')) return '#ef4444'
    if (level.includes('YELLOW')) return '#eab308'
    if (level.includes('GREEN')) return '#22c55e'
    return '#fff'
  }

  const getTriageDisplayText = (level: string | null) => {
    if (!level) return '응급도 계산 대기 중'
    if (level.trim().toUpperCase().startsWith('RED')) return 'RED (초응급 - 전신 악화 위험)'
    return level
  }

  const isTriageActionable = Boolean(
    triageLevel && (triageLevel.includes('YELLOW') || triageLevel.includes('RED'))
  )

  const openLiveTriageDashboard = () => {
    if (!triageLevel || !isTriageActionable) return

    const normalized = triageLevel.trim().toUpperCase()
    const snapshot = normalized.startsWith('RED') && redSnapshot
      ? { ...redSnapshot }
      : {
          patientId,
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
          <h1>Medical Image 3D Viewer</h1>
        </div>
        <div style={{ margin: '0 auto', color: '#fbbf24', fontSize: '0.9rem', fontWeight: 'bold' }}>
          ⚠️ 공모전 심사용 합성 데이터 전용 데모입니다. {isDemoMode && '임상적 검증을 거치지 않은 공모전용 프로토타입입니다.'}
        </div>
        <div className="tabs">
          <button className={`tab ${modality === 'Brain' ? 'active' : ''}`} onClick={() => { if (appStatus !== 'PROCESSING') setModality('Brain') }}>
            <Brain size={18} /> Brain
          </button>
          <button className={`tab ${modality === 'Lung' ? 'active' : ''}`} onClick={() => { if (appStatus !== 'PROCESSING') setModality('Lung') }}>
            <Stethoscope size={18} /> Lung
          </button>
          <button className="tab" style={{ marginLeft: 'auto', backgroundColor: '#ef4444', color: 'white' }} onClick={handleSignOut} title="이전 상태(업로드 파일, 실시간 모니터링)를 모두 초기화하고 새로운 익명 세션을 발급받습니다.">
            데모 세션 초기화
          </button>
        </div>
      </header>

      <main className="main-content">
        <aside className="sidebar">
          <div className="control-group">
            <h3>Controls</h3>
            {isDemoMode && (
              <div style={{ padding: '10px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '8px', marginBottom: '15px', fontSize: '0.85rem' }}>
                <strong style={{ color: '#60a5fa' }}>💡 심사위원 시연 순서</strong>
                <ol style={{ margin: '5px 0 0 15px', padding: 0, color: '#e5e7eb' }}>
                  <li style={{ color: patientId ? '#4ade80' : 'inherit' }}>1단계: 합성 MRI 업로드 {patientId && '✓'}</li>
                  <li style={{ color: hasVitalsFile ? '#4ade80' : 'inherit' }}>2단계: 합성 Vitals CSV 업로드 {hasVitalsFile && '✓'}</li>
                  <li style={{ color: monitoringEnabled ? '#4ade80' : 'inherit' }}>3단계: 실시간 모니터링 시작 {monitoringEnabled && '✓'}</li>
                </ol>
              </div>
            )}
            <div className="slider-container">
              <label htmlFor="opacity-slider">투명도 (Opacity): {Math.round(opacity * 100)}%</label>
              <input id="opacity-slider" type="range" min="0" max="1" step="0.05" value={opacity} onChange={(e) => setOpacity(parseFloat(e.target.value))} />
            </div>
            <div className="action-buttons">
              <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".npy,.nii,.nii.gz" onChange={handleFileUpload} />
              <button className="btn primary" onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending || monitoringEnabled}>
                <span style={{ display: uploadMutation.isPending ? 'inline-flex' : 'none' }}><Loader2 size={18} className="animate-spin" /></span>
                <span style={{ display: uploadMutation.isPending ? 'none' : 'inline-flex' }}><Upload size={18} /></span>
                {uploadMutation.isPending ? '처리 중...' : isDemoMode ? `1단계: [${modality}] 합성 3D 의료영상 업로드 (.nii.gz)` : `1단계: [${modality}] 의료영상 업로드 (.nii.gz)`}
              </button>

              <input type="file" ref={csvInputRef} onChange={handleCsvUpload} accept=".csv" style={{ display: 'none' }} />
              <button className="btn primary" style={{ backgroundColor: hasVitalsFile ? '#10b981' : undefined }} onClick={() => csvInputRef.current?.click()} disabled={appStatus === 'PROCESSING' || monitoringEnabled}>
                <span style={{ display: 'inline-flex' }}><Upload size={18} /></span>
                {hasVitalsFile ? (isDemoMode ? '2단계: 합성 Vitals 업로드 완료' : '2단계: Vitals 업로드 완료') : (isDemoMode ? '2단계: 합성 Vitals 시계열 업로드 (.csv)' : '2단계: Vitals 시계열 업로드 (.csv)')}
              </button>
              <button className={`btn secondary ${monitoringEnabled ? 'streaming-active' : ''}`} disabled={appStatus === 'IDLE' || appStatus === 'PROCESSING' || !hasVitalsFile} onClick={toggleStreaming} style={{ backgroundColor: monitoringEnabled ? 'var(--grad-danger)' : undefined, color: monitoringEnabled ? 'white' : undefined, border: monitoringEnabled ? 'none' : undefined, animation: isStreaming ? 'pulse 2s infinite' : 'none' }}>
                <span style={{ display: 'inline-flex' }}>{monitoringEnabled ? <WifiOff size={18} /> : <Wifi size={18} />}</span>
                {monitoringEnabled ? '3단계: 실시간 모니터링 중단' : '3단계: 실시간 모니터링 시작'}
              </button>
            </div>
          </div>

          <div className="info-panel">
            <h3>Multi-Modal Evaluation</h3>
            <div style={{ marginTop: '0.5rem' }}>
              {patientId ? (
                <>
                  <div style={{ padding: '0.75rem', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '8px', marginBottom: '0.5rem', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <p className="text-sm text-gray" style={{ marginBottom: '0.25rem' }}>
                      <strong style={{ color: '#fff' }}>[Vision] 병변 부피 (Volume):</strong><br/>
                      <span style={{ color: '#60a5fa', fontSize: '1.1rem' }}>{lesionVolume.toLocaleString()} voxels</span>
                    </p>
                  </div>

                  {hasVitalsFile && (
                    <div data-testid="vitals-panel" style={{ padding: '0.75rem', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '8px', marginBottom: '0.5rem', border: '1px solid rgba(255,255,255,0.05)', position: 'relative', overflow: 'hidden' }}>
                      {isStreaming && <div className="scanner-line"></div>}
                      <p className="text-sm text-gray" style={{ marginBottom: '0.5rem' }}>
                        <strong style={{ color: '#fff' }}>[Vitals] 실시간 생체 신호 (CSV Replay):</strong><br/>
                        <span style={{ color: '#fbbf24', fontSize: '1.1rem', transition: 'all 0.3s' }}>
                          HR: <span style={{ color: vitals.hr > 100 || vitals.hr < 60 ? '#ef4444' : 'inherit' }}>{Math.round(vitals.hr)}</span> bpm | BP: <span style={{ color: vitals.bpSys < 90 || vitals.bpSys > 140 ? '#ef4444' : 'inherit' }}>{Math.round(vitals.bpSys)}/{Math.round(vitals.bpDia)}</span> mmHg
                        </span><br/>
                        <span style={{ color: '#fbbf24', fontSize: '1.1rem', transition: 'all 0.3s' }}>Resp: {Math.round(vitals.resp)}/min | Temp: {vitals.temp.toFixed(1)}°C | SpO2: {Math.round(vitals.spo2)}%</span>
                      </p>
                      {connectionStatus === 'reconnecting' && <div style={{ color: '#fbbf24', fontSize: '0.75rem', marginBottom: '8px' }}>재연결 중 · 마지막 정상 Vitals 값을 유지하고 있습니다.</div>}
                      {diseaseRisks && (
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.5rem' }}>
                          <strong style={{ color: '#fff', fontSize: '0.9rem', display: 'block', marginBottom: '8px' }}>{isDemoMode ? '[Time-series] Vitals 기반 위험 시뮬레이션 (CSV Replay)' : '[Time-series] 다중 합병증 동시 예측 (IMST-Mamba)'}</strong>
                          <div style={{ display: 'grid', gap: '6px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}><span style={{ color: '#a1a1aa' }}>{isDemoMode ? '패혈증 유사 (Sepsis-like) 위험 점수' : '패혈증 (Sepsis) 예측'}</span><span style={{ color: '#f472b6', fontWeight: 'bold' }}>{diseaseRisks.sepsis}</span></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}><span style={{ color: '#a1a1aa' }}>{isDemoMode ? 'ARDS 유사 (ARDS-like) 위험 점수' : '호흡곤란증후군 (ARDS) 예측'}</span><span style={{ color: '#60a5fa', fontWeight: 'bold' }}>{diseaseRisks.ards}</span></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}><span style={{ color: '#a1a1aa' }}>{isDemoMode ? '쇼크 유사 (Shock-like) 위험 점수' : '저혈량성 쇼크 (Shock) 예측'}</span><span style={{ color: '#fbbf24', fontWeight: 'bold' }}>{diseaseRisks.shock}</span></div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {hasVitalsFile && (
                    <div data-testid="triage-panel" style={{ padding: '0.75rem', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '8px', marginBottom: '0.5rem', border: `1px solid ${getTriageColor(triageLevel)}33`, transition: 'all 0.3s' }}>
                      <p className="text-sm text-gray" style={{ marginBottom: '0.25rem' }}>
                        <strong style={{ color: '#fff' }}>{isDemoMode ? '[최종 응급도] 시뮬레이션 기반 응급도 분류:' : '[최종 응급도] Multi-modal Triage:'}</strong><br/>
                        <span style={{ color: getTriageColor(triageLevel), fontWeight: 'bold', fontSize: '1.3rem' }}>{getTriageDisplayText(triageLevel)}</span>
                      </p>
                      {isDemoMode && <div style={{ fontSize: '0.75rem', color: '#a1a1aa', marginTop: '4px' }}>* 합성 입력에 대한 데모 분류이며 의료 판단에 사용할 수 없습니다.</div>}
                      {isTriageActionable ? (
                        <button onClick={openLiveTriageDashboard} style={{ marginTop: '12px', width: '100%', padding: '10px', backgroundColor: triageLevel?.includes('RED') ? 'rgba(239, 68, 68, 0.2)' : 'rgba(234, 179, 8, 0.16)', border: `1px solid ${getTriageColor(triageLevel)}`, borderRadius: '6px', color: getTriageColor(triageLevel), cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', boxShadow: `0 0 12px ${getTriageColor(triageLevel)}55` }}>
                          <Activity size={18} />{triageLevel?.includes('RED') ? 'RED · 긴급 이송 병원 탐색' : 'YELLOW · 대응 병원 후보 확인'}
                        </button>
                      ) : !triageLevel ? (
                        <button disabled style={{ marginTop: '12px', width: '100%', padding: '10px', border: '1px solid #4b5563', borderRadius: '6px', color: '#9ca3af', backgroundColor: 'rgba(75,85,99,0.15)' }}>응급도 계산 후 Golden-Time 탐색 가능</button>
                      ) : null}
                    </div>
                  )}

                  <p className="text-sm text-gray" style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.5rem' }}>
                    <strong>네트워크 상태:</strong> <span className={getStatusGlowClass()} style={{ color: getStatusColor(), fontWeight: 'bold' }}>{getStatusText()}</span>
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray">마스크 파일(.npy, .nii.gz)을 업로드하여 3D 메쉬를 뷰어에 표시하세요.</p>
              )}
            </div>
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
          triageLevel={triageLevel ?? dashboardSnapshot.triageLevel}
          lesionVolume={dashboardSnapshot.lesionVolume}
          triggeringCondition={dashboardSnapshot.triggeringCondition}
          hasSepsisRisk={dashboardSnapshot.hasSepsisRisk}
          modality={dashboardSnapshot.modality}
        />
      )}
    </div>
  )
}

function AppContent() {
  return <MainApp />;
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App