
import { AlertTriangle, MapPin, X, ShieldAlert } from 'lucide-react';
import { buildGoldenTimeUrl } from '../../lib/goldenTimeUrl';

interface EmergencyDashboardProps {
  onClose: () => void;
  patientId: string | null;
  triageLevel: string | null;
  lesionVolume: number;
  /**
   * triggeringCondition: WebSocket Vitals 스트리밍에서 전달된 합병증 조건.
   * null인 경우 Brain 모드 기본 컨텍스트를 사용하며, 'Unknown'은 절대 전달하지 않습니다.
   */
  triggeringCondition: string | null;
  /** 구조화된 패혈증 위험 상태 (문자열 파싱 의존 제거) */
  hasSepsisRisk: boolean;
  /** MRI 분석 모달리티 ('Brain' | 'Lung') */
  modality: 'Brain' | 'Lung';
}

export function EmergencyDashboard({
  onClose,
  patientId,
  triageLevel,
  lesionVolume,
  triggeringCondition,
  hasSepsisRisk,
  modality,
}: EmergencyDashboardProps) {
  const handleGoldenTimeRedirect = () => {
    const url = buildGoldenTimeUrl({
      triage: triageLevel,
      modality,
      lesionVolume,
      vitalsCondition: triggeringCondition,
      hasSepsisRisk,
    });
    window.open(url, '_blank');
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      zIndex: 9999,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontFamily: 'sans-serif'
    }}>
      <div style={{
        width: '90%', maxWidth: '800px',
        backgroundColor: '#1e1e24', border: '2px solid #ef4444',
        borderRadius: '12px', padding: '2rem',
        boxShadow: '0 0 30px rgba(239, 68, 68, 0.3)',
        position: 'relative'
      }}>
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}
        >
          <X size={24} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid #ef4444', paddingBottom: '1rem' }}>
          <ShieldAlert size={48} color="#ef4444" />
          <div>
            <h1 style={{ margin: 0, color: '#ef4444', fontSize: '2rem' }}>중증 응급 환자 발생 (CODE RED)</h1>
            <p style={{ margin: '4px 0 0 0', color: '#fbbf24', fontSize: '0.9rem', fontWeight: 'bold' }}>
              합성 데이터 분석 데모 | 임상 진단 아님 · 공모전 프로토타입
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
          <div style={{ backgroundColor: '#2a2a35', padding: '1.5rem', borderRadius: '8px' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#9ca3af' }}>합성 데이터 분석 리포트</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: '1.8' }}>
              <li><strong>환자 ID:</strong> <span style={{ color: '#fff' }}>{patientId || 'Unknown'}</span></li>
              <li>
                <strong>모달리티:</strong>{' '}
                <span style={{ color: '#60a5fa' }}>
                  {modality === 'Brain' ? '🧠 뇌 영상 (Brain MRI)' : '🫁 폐 영상 (Lung CT)'}
                </span>
              </li>
              <li>
                <strong>병변 체적 (Vision):</strong>{' '}
                <span style={{ color: '#60a5fa' }}>{lesionVolume.toLocaleString()} voxels</span>
                {' '}(3D context)
              </li>
              {triggeringCondition && triggeringCondition !== 'Unknown' && (
                <li>
                  <strong>Vitals 위험 패턴:</strong>{' '}
                  <span style={{ color: '#f472b6', fontWeight: 'bold' }}>{triggeringCondition}</span>
                  {' '}(합성 데모)
                </li>
              )}
              <li><strong>최종 분류:</strong> <span style={{ color: '#ef4444', fontWeight: 'bold' }}>{triageLevel}</span></li>
            </ul>
            <p style={{ margin: '1rem 0 0 0', fontSize: '0.75rem', color: '#6b7280' }}>
              * 표시 수치는 합성 데이터 기반 데모이며 임상 진단 결과가 아닙니다.
            </p>
          </div>

          <div style={{ backgroundColor: '#2a2a35', padding: '1.5rem', borderRadius: '8px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#9ca3af' }}>환자 이송 프로토콜</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {modality === 'Brain' ? (
                <div style={{
                  backgroundColor: 'rgba(96, 165, 250, 0.1)', padding: '0.75rem',
                  borderRadius: '8px', border: '1px solid #60a5fa', fontSize: '0.85rem', color: '#93c5fd'
                }}>
                  <strong>🧠 뇌 병변 대응 병원 탐색</strong><br />
                  신경외과·신경과 적합 + 응급수술·뇌 영상 가능 병원을 우선 탐색합니다.<br />
                  <span style={{ color: '#fbbf24', fontSize: '0.75rem' }}>공개 응급의료 정보 기반 추천 (임상 진단 아님)</span>
                </div>
              ) : (
                <div style={{
                  backgroundColor: 'rgba(251, 191, 36, 0.1)', padding: '0.75rem',
                  borderRadius: '8px', border: '1px solid #fbbf24', fontSize: '0.85rem', color: '#fcd34d'
                }}>
                  <strong>⚠️ {modality} 모드 특화 추천 미지원</strong><br />
                  현재 {modality} 분석의 특화 병원 매칭은 지원되지 않습니다.<br />
                  일반 응급실 가용 병상 기준으로 탐색합니다.
                </div>
              )}

              <div style={{
                display: 'flex', alignItems: 'center', gap: '1rem',
                backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '1rem',
                borderRadius: '8px', border: '1px solid #ef4444'
              }}>
                <AlertTriangle size={32} color="#ef4444" />
                <div>
                  <p style={{ margin: 0, color: '#ef4444', fontSize: '0.9rem', fontWeight: 'bold' }}>⚠️ 신속한 병상 수배 요망</p>
                  <h2 style={{ margin: 0, color: '#fca5a5', fontSize: '1.1rem' }}>Golden Time 시스템으로 연결합니다.</h2>
                </div>
              </div>

              <button
                onClick={handleGoldenTimeRedirect}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                  padding: '1rem', backgroundColor: '#f59e0b', color: '#fff', border: 'none', borderRadius: '8px',
                  fontSize: '1.05rem', fontWeight: 'bold', cursor: 'pointer', marginTop: '0.5rem'
                }}
              >
                <MapPin size={20} />
                내 위치(GPS) 기반 Golden Time 병원 탐색 시작
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
