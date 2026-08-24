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

  const handleSignOut = async () => {
    resetMedicalState()
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setTriageLevel(null)
    setDiseaseRisks(null)
    setTriggeringCondition(null)
    triggeringConditionRef.current = null
    setSepsisHighRisk(false)
    sepsisHighRiskRef.current = false
    setRedSnapshot(null)
    setShowDashboard(false)
    setIsStreaming(false)
    setHasVitalsFile(false)
    setVitals({ hr: 80, bpSys: 120, bpDia: 80, resp: 16, temp: 36.5, spo2: 98 })
    await signOut()
    toast.success('데모 세션 및 상태가 초기화되었습니다.')
  }
  
  const [triageLevel, setTriageLevel] = useState<string | null>(null)
  
  // Multi-Disease Risks 상태
  const [diseaseRisks, setDiseaseRisks] = useState<{sepsis: string, ards: string, shock: string} | null>(null)
  const [, setTriggeringCondition] = useState<string | null>(null)
  const [, setSepsisHighRisk] = useState<boolean>(false)
  
  // WebSocket 상태 관리
  const [isStreaming, setIsStreaming] = useState(false)
  const [vitals, setVitals] = useState({ hr: 80, bpSys: 120, bpDia: 80, resp: 16, temp: 36.5, spo2: 98 })
  const [hasVitalsFile, setHasVitalsFile] = useState(false)
  
  // 대시보드 모달 상태
  const [showDashboard, setShowDashboard] = useState(false)
  const [redSnapshot, setRedSnapshot] = useState<RedSnapshot | null>(null)
  
  const wsRef = useRef<WebSocket | null>(null)
  const intervalRef = useRef<number | null>(null)
  const triggeringConditionRef = useRef<string | null>(null)
  const sepsisHighRiskRef = useRef(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const csvInputRef = useRef<HTMLInputElement>(null)

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.csv')) {
      toast.error('CSV 파일만 업로드 가능합니다.')
      return
    }

    const formData = new FormData()
    formData.append('file', file)

    try {
      await ensureDemoSession()
      toast.info('CSV 업로드 중...')
      const response = await uploadVitals(file)

      if (response.status === 'success' || response) {
        setHasVitalsFile(true)
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
    }
  }

  // 컴포넌트 언마운트 시 WebSocket 정리 및 타이머 정리
  useEffect(() => {
    return () => {
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

  // 1. .npy 파일 업로드 및 변환 Mutation
  const uploadMutation = useMutation({
    mutationFn: (file: File) => processMedicalMask(file, modality),
    onMutate: () => {
      setAppStatus('PROCESSING')
      setDiseaseRisks(null)
      setTriggeringCondition(null)
      triggeringConditionRef.current = null
      setSepsisHighRisk(false)
      sepsisHighRiskRef.current = false
      setTriageLevel(null)
      setRedSnapshot(null)
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
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  })

  // WebSocket 스트리밍 토글 함수
  const toggleStreaming = async () => {
    if (isStreaming) {
      // 스트리밍 중지
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      setIsStreaming(false)
      setAppStatus('RENDERED') // 원래 상태로 복귀
      toast.info("실시간 모니터링이 중지되었습니다.")
    } else {
      // 스트리밍 시작
      if (!patientId) {
        toast.error("환자 ID가 없습니다. 먼저 MRI를 업로드하세요.")
        return
      }
      
      let accessToken: string | null = null;
      try {
        const session = await ensureDemoSession();
        accessToken = session.access_token;
      } catch (error) {
        if (error instanceof DemoSessionError) {
          toast.error(error.message);
        } else {
          toast.error("인증 토큰을 준비할 수 없습니다.");
        }
        return;
      }
      
      if (!accessToken) {
        toast.error("인증 토큰이 만료되었습니다. 다시 로그인해주세요.")
        return
      }
      
      const wsUrl = getWebSocketUrl()
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setIsStreaming(true)
        setAppStatus('STREAMING')
        toast.success(
          isDemoMode
            ? "합성 Vitals 데이터 스트리밍(Replay)이 시작되었습니다."
            : "Vitals 데이터 스트리밍이 시작되었습니다."
        )
        
        // 백엔드에 인증 토큰 및 스트리밍 시작 트리거 전송
        ws.send(JSON.stringify({
          type: "auth",
          access_token: accessToken,
          patient_id: patientId,
          volume: lesionVolume
        }))
      }

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data)
        
        if (data.status === "completed") {
          toast.info("CSV 데이터 리플레이가 종료되었습니다.")
          toggleStreaming()
          return
        }
        if (data.vitals) {
          setVitals({
            hr: data.vitals.hr,
            bpSys: data.vitals.bp_sys,
            bpDia: data.vitals.bp_dia,
            resp: data.vitals.resp,
            temp: data.vitals.temp,
            spo2: data.vitals.spo2
          })
        }

        if (data.disease_risks) {
          setDiseaseRisks(data.disease_risks)
        }
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
          const isRed = nextTriageLevel.trim().toUpperCase().startsWith('RED')

          // EmergencyDashboard is strictly user-opened. Once the live episode
          // leaves RED, close it and clear the open flag so a later RED cannot
          // make the modal reappear without another button click.
          if (!isRed) {
            setShowDashboard(false)
          }

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

      ws.onclose = () => {
        setIsStreaming(false)
      }
      
      ws.onerror = (_error) => {
        toast.error("WebSocket 통신 실패: 실시간 모니터링 연결 중 오류가 발생했습니다.")
        setIsStreaming(false)
      }
    }
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
      if (error instanceof DemoSessionError) {
        toast.error(error.message);
      } else {
        toast.error("인증 토큰을 준비할 수 없습니다.");
      }
      event.target.value = '';
    }
  }

  const getStatusColor = () => {
    switch(appStatus) {
      case 'IDLE': return '#9ca3af'; // gray
      case 'PROCESSING': return '#60a5fa'; // blue
      case 'RENDERED': return '#4ade80'; // green
      case 'STREAMING': return '#f472b6'; // pink for live streaming
      case 'SENT': return '#a78bfa'; // purple
      default: return '#9ca3af';
    }
  }

  const getStatusGlowClass = () => {
    switch(appStatus) {
      case 'IDLE': return '';
      case 'PROCESSING': return 'status-glow-processing';
      case 'RENDERED': return 'status-glow-success';
      case 'STREAMING': return 'status-glow-streaming';
      case 'SENT': return 'status-glow-sent';
      default: return '';
    }
  }

  const getStatusText = () => {
    switch(appStatus) {
      case 'IDLE': return '대기 중';
      case 'PROCESSING': return '분석 및 렌더링 중...';
      case 'RENDERED': return '렌더링 완료 (모니터링 대기)';
      case 'STREAMING': return '실시간 생체 모니터링 중...';
      case 'SENT': return 'Triage 서버 전송 완료';
      default: return '알 수 없음';
    }
  }

  const getTriageColor = (level: string | null) => {
    if (!level) return '#fff';
    if (level.includes('RED')) return '#ef4444';
    if (level.includes('YELLOW')) return '#eab308';
    if (level.includes('GREEN')) return '#22c55e';
    return '#fff';
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
          <button 
            className={`tab ${modality === 'Brain' ? 'active' : ''}`}
            onClick={() => {
              if (appStatus === 'PROCESSING') return;
              setModality('Brain')
            }}
          >
            <Brain size={18} /> Brain
          </button>
          <button 
            className={`tab ${modality === 'Lung' ? 'active' : ''}`}
            onClick={() => {
              if (appStatus === 'PROCESSING') return;
              setModality('Lung')
            }}
          >
            <Stethoscope size={18} /> Lung
          </button>
          
          <button 
            className="tab"
            style={{ marginLeft: 'auto', backgroundColor: '#ef4444', color: 'white' }}
            onClick={handleSignOut}
            title="이전 상태(업로드 파일, 실시간 모니터링)를 모두 초기화하고 새로운 익명 세션을 발급받습니다."
          >
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
                  <li style={{ color: isStreaming ? '#4ade80' : 'inherit' }}>3단계: 실시간 모니터링 시작 {isStreaming && '✓'}</li>
                </ol>
                <div style={{ marginTop: '8px', fontSize: '0.75rem', color: '#fbbf24' }}>
                  * Render Free 인스턴스가 대기 상태인 경우 최초 요청(1단계)에 최대 약 1분이 소요될 수 있습니다.
                </div>
              </div>
            )}
            
            <div className="slider-container">
              <label htmlFor="opacity-slider">투명도 (Opacity): {Math.round(opacity * 100)}%</label>
              <input 
                id="opacity-slider"
                type="range" 
                min="0" 
                max="1" 
                step="0.05" 
                value={opacity} 
                onChange={(e) => setOpacity(parseFloat(e.target.value))} 
              />
            </div>
            
            <div className="action-buttons">
              <input 
                type="file" 
                ref={fileInputRef} 
                style={{ display: 'none' }} 
                accept=".npy,.nii,.nii.gz"
                onChange={handleFileUpload} 
              />
              <button 
                className="btn primary" 
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending || isStreaming}
              >
                <span style={{ display: uploadMutation.isPending ? 'inline-flex' : 'none' }}>
                  <Loader2 size={18} className="animate-spin" />
                </span>
                <span style={{ display: uploadMutation.isPending ? 'none' : 'inline-flex' }}>
                  <Upload size={18} />
                </span>
                {uploadMutation.isPending
                  ? '처리 중...'
                  : isDemoMode
                    ? `1단계: [${modality}] 합성 3D 의료영상 업로드 (.nii.gz)`
                    : `1단계: [${modality}] 의료영상 업로드 (.nii.gz)`}
              </button>

              <input
                type="file"
                ref={csvInputRef}
                onChange={handleCsvUpload}
                accept=".csv"
                style={{ display: 'none' }}
              />
              <button 
                className="btn primary" 
                style={{ 
                  backgroundColor: hasVitalsFile ? '#10b981' : undefined
                }}
                onClick={() => csvInputRef.current?.click()}
                disabled={appStatus === 'PROCESSING' || isStreaming}
              >
                <span style={{ display: 'inline-flex' }}>
                  <Upload size={18} />
                </span>
                {hasVitalsFile
                  ? (isDemoMode ? '2단계: 합성 Vitals 업로드 완료' : '2단계: Vitals 업로드 완료')
                  : (isDemoMode ? '2단계: 합성 Vitals 시계열 업로드 (.csv)' : '2단계: Vitals 시계열 업로드 (.csv)')}
              </button>
              
              <button 
                className={`btn secondary ${isStreaming ? 'streaming-active' : ''}`} 
                disabled={appStatus === 'IDLE' || appStatus === 'PROCESSING' || !hasVitalsFile}
                onClick={toggleStreaming}
                style={{ 
                  backgroundColor: isStreaming ? 'var(--grad-danger)' : undefined,
                  color: isStreaming ? 'white' : undefined,
                  border: isStreaming ? 'none' : undefined,
                  animation: isStreaming ? 'pulse 2s infinite' : 'none'
                }}
              >
                <span style={{ display: 'inline-flex' }}>
                  {isStreaming ? <WifiOff size={18} /> : <Wifi size={18} />}
                </span>
                {isStreaming ? '3단계: 실시간 모니터링 중단' : '3단계: 실시간 모니터링 시작'}
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

                  {(isStreaming || diseaseRisks) && (
                    <div style={{ padding: '0.75rem', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '8px', marginBottom: '0.5rem', border: '1px solid rgba(255,255,255,0.05)', position: 'relative', overflow: 'hidden' }}>
                      {isStreaming && <div className="scanner-line"></div>}
                      <p className="text-sm text-gray" style={{ marginBottom: '0.5rem' }}>
                        <strong style={{ color: '#fff' }}>[Vitals] 실시간 생체 신호 (CSV Replay):</strong><br/>
                        <span style={{ color: '#fbbf24', fontSize: '1.1rem', transition: 'all 0.3s' }}>
                          HR: <span style={{ color: vitals.hr > 100 || vitals.hr < 60 ? '#ef4444' : 'inherit' }}>{Math.round(vitals.hr)}</span> bpm | 
                          BP: <span style={{ color: vitals.bpSys < 90 || vitals.bpSys > 140 ? '#ef4444' : 'inherit' }}>{Math.round(vitals.bpSys)}/{Math.round(vitals.bpDia)}</span> mmHg
                        </span><br/>
                        <span style={{ color: '#fbbf24', fontSize: '1.1rem', transition: 'all 0.3s' }}>
                          Resp: {Math.round(vitals.resp)}/min | Temp: {vitals.temp.toFixed(1)}°C | SpO2: {Math.round(vitals.spo2)}%
                        </span>
                      </p>
                      
                      {diseaseRisks && (
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.5rem' }}>
                          <strong style={{ color: '#fff', fontSize: '0.9rem', display: 'block', marginBottom: '8px' }}>
                            {isDemoMode ? '[Time-series] Vitals 기반 위험 시뮬레이션 (CSV Replay)' : '[Time-series] 다중 합병증 동시 예측 (IMST-Mamba)'}
                          </strong>
                          
                          <div style={{ display: 'grid', gap: '6px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem' }}>
                              <span style={{ color: '#a1a1aa' }}>{isDemoMode ? '패혈증 유사 (Sepsis-like) 위험 점수' : '패혈증 (Sepsis) 예측'}</span>
                              <span style={{ color: '#f472b6', fontWeight: 'bold' }}>{diseaseRisks.sepsis}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem' }}>
                              <span style={{ color: '#a1a1aa' }}>{isDemoMode ? 'ARDS 유사 (ARDS-like) 위험 점수' : '호흡곤란증후군 (ARDS) 예측'}</span>
                              <span style={{ color: '#60a5fa', fontWeight: 'bold' }}>{diseaseRisks.ards}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem' }}>
                              <span style={{ color: '#a1a1aa' }}>{isDemoMode ? '쇼크 유사 (Shock-like) 위험 점수' : '저혈량성 쇼크 (Shock) 예측'}</span>
                              <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>{diseaseRisks.shock}</span>
                            </div>
                          </div>
                          {isDemoMode && (
                            <div style={{ fontSize: '0.75rem', color: '#a1a1aa', marginTop: '10px' }}>
                              * 표시 수치는 합성 Vitals 기반 데모 점수이며 임상 예측 또는 진단 결과가 아닙니다.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {triageLevel && (
                    <div style={{ padding: '0.75rem', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '8px', marginBottom: '0.5rem', border: `1px solid ${getTriageColor(triageLevel)}33`, transition: 'all 0.3s' }}>
                      <p className="text-sm text-gray" style={{ marginBottom: '0.25rem' }}>
                        <strong style={{ color: '#fff' }}>
                          {isDemoMode ? '[최종 응급도] 시뮬레이션 기반 응급도 분류:' : '[최종 응급도] Multi-modal Triage:'}
                        </strong><br/>
                        <span style={{ color: getTriageColor(triageLevel), fontWeight: 'bold', fontSize: '1.3rem' }}>{triageLevel}</span>
                      </p>
                      {isDemoMode && (
                        <div style={{ fontSize: '0.75rem', color: '#a1a1aa', marginTop: '4px' }}>
                          * 합성 입력에 대한 데모 분류이며 의료 판단에 사용할 수 없습니다.
                        </div>
                      )}
                      
                      {triageLevel.includes('RED') && (
                        <button
                          onClick={() => {
                            if (!redSnapshot) {
                              toast.error('RED 발생 시점 스냅샷을 준비 중입니다. 잠시 후 다시 시도해주세요.')
                              return
                            }
                            setShowDashboard(true)
                          }}
                          style={{
                            marginTop: '12px',
                            width: '100%',
                            padding: '10px',
                            backgroundColor: 'rgba(239, 68, 68, 0.2)',
                            border: '1px solid #ef4444',
                            borderRadius: '6px',
                            color: '#ef4444',
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'center',
                            gap: '8px',
                            boxShadow: '0 0 15px rgba(239, 68, 68, 0.6)',
                            animation: 'pulse 1s infinite'
                          }}
                        >
                          <Activity size={18} />
                          🚨 골든타임(응급 병상) 긴급 탐색
                        </button>
                      )}
                    </div>
                  )}

                  <p className="text-sm text-gray" style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.5rem' }}>
                    <strong>네트워크 상태:</strong> <span className={getStatusGlowClass()} style={{ color: getStatusColor(), fontWeight: 'bold' }}>{getStatusText()}</span>
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray">
                  마스크 파일(.npy, .nii.gz)을 업로드하여 3D 메쉬를 뷰어에 표시하세요.
                </p>
              )}
            </div>
          </div>
        </aside>

        <section className="viewer-container">
          <ThreeViewer onLoadFailure={handleLoadFailure} />
        </section>
      </main>

      {showDashboard && redSnapshot && (
        <EmergencyDashboard 
          onClose={() => setShowDashboard(false)}
          patientId={redSnapshot.patientId}
          triageLevel={redSnapshot.triageLevel}
          lesionVolume={redSnapshot.lesionVolume}
          triggeringCondition={redSnapshot.triggeringCondition}
          hasSepsisRisk={redSnapshot.hasSepsisRisk}
          modality={redSnapshot.modality}
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