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
import './App.css'

function MainApp() {
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
    setIsStreaming(false)
    setHasVitalsFile(false)
    setVitals({ hr: 80, bpSys: 120, bpDia: 80, resp: 16, temp: 36.5, spo2: 98 })
    await signOut()
    toast.success('데모 세션 및 상태가 초기화되었습니다.')
  }
  
  const [triageLevel, setTriageLevel] = useState<string | null>(null)
  
  // Multi-Disease Risks 상태
  const [diseaseRisks, setDiseaseRisks] = useState<{sepsis: string, ards: string, shock: string} | null>(null)
  const [triggeringCondition, setTriggeringCondition] = useState<string | null>(null)
  
  // WebSocket 상태 관리
  const [isStreaming, setIsStreaming] = useState(false)
  const [vitals, setVitals] = useState({ hr: 80, bpSys: 120, bpDia: 80, resp: 16, temp: 36.5, spo2: 98 })
  const [hasVitalsFile, setHasVitalsFile] = useState(false)
  
  // 대시보드 모달 상태
  const [showDashboard, setShowDashboard] = useState(false)
  
  const wsRef = useRef<WebSocket | null>(null)
  const intervalRef = useRef<number | null>(null)

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
        toast.success('생체 신호 데이터 연동 완료 (Real-Data Ready!)')
      } else {
        toast.error('CSV 업로드 실패')
      }
    } catch (error) {
      if (error instanceof DemoSessionError) {
        toast.error(error.message)
      } else {
        toast.error('백엔드 서버와 통신할 수 없습니다.')
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
      setTriageLevel(null)
      const toastId = toast.loading(`[${modality}] AI가 종양을 분석 및 분할 중입니다 (PyTorch Inference)...`)
      return { toastId }
    },
    onSuccess: (data, _variables, context) => {
      toast.success(`[${modality}] AI 3D 메쉬 생성 및 렌더링 완료!`, { id: context?.toastId })
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
        error.response?.data?.detail || error.message || '업로드 중 오류가 발생했습니다.', 
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
        toast.success("실제 환자 데이터 스트리밍(Replay)이 시작되었습니다.")
        
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
          setTriggeringCondition(data.triggering_condition)
        }
        if (data.triage_level) {
          setTriageLevel(data.triage_level)
        }
      }

      ws.onclose = () => {
        setIsStreaming(false)
      }
      
      ws.onerror = (_error) => {

        toast.error("WebSocket 연결 중 오류가 발생했습니다.")
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
          ⚠️ 공모전 심사용 합성 데이터 전용 데모입니다. 실제 환자 정보 및 식별 가능한 의료 데이터를 업로드하지 마세요.
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
          >
            데모 세션 초기화
          </button>
        </div>
      </header>

      <main className="main-content">
        <aside className="sidebar">
          <div className="control-group">
            <h3>Controls</h3>
            
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
                {uploadMutation.isPending ? 'AI 분석 중...' : `[${modality}] 원본 환자 MRI 업로드 (.nii.gz)`}
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
                {hasVitalsFile ? '생체 신호 데이터 업로드 완료' : '생체 신호 시계열 업로드 (.csv)'}
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
                {isStreaming ? '실시간 모니터링 중단' : '실시간 모니터링 시작'}
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
                          <strong style={{ color: '#fff', fontSize: '0.9rem', display: 'block', marginBottom: '8px' }}>[Time-series] 다중 합병증 동시 예측 (IMST-Mamba)</strong>
                          
                          <div style={{ display: 'grid', gap: '6px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem' }}>
                              <span style={{ color: '#a1a1aa' }}>패혈증 (Sepsis)</span>
                              <span style={{ color: '#f472b6', fontWeight: 'bold' }}>{diseaseRisks.sepsis}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem' }}>
                              <span style={{ color: '#a1a1aa' }}>호흡곤란증후군 (ARDS)</span>
                              <span style={{ color: '#60a5fa', fontWeight: 'bold' }}>{diseaseRisks.ards}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem' }}>
                              <span style={{ color: '#a1a1aa' }}>저혈량성 쇼크 (Shock)</span>
                              <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>{diseaseRisks.shock}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {triageLevel && (
                    <div style={{ padding: '0.75rem', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '8px', marginBottom: '0.5rem', border: `1px solid ${getTriageColor(triageLevel)}33`, transition: 'all 0.3s' }}>
                      <p className="text-sm text-gray" style={{ marginBottom: '0.25rem' }}>
                        <strong style={{ color: '#fff' }}>[최종 응급도] Multi-modal Triage:</strong><br/>
                        <span style={{ color: getTriageColor(triageLevel), fontWeight: 'bold', fontSize: '1.3rem' }}>{triageLevel}</span>
                      </p>
                      
                      {triageLevel.includes('RED') && (
                        <button
                          onClick={() => setShowDashboard(true)}
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

      {showDashboard && (
        <EmergencyDashboard 
          onClose={() => setShowDashboard(false)}
          patientId={patientId}
          triageLevel={triageLevel}
          lesionVolume={lesionVolume}
          triggeringCondition={triggeringCondition}
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
