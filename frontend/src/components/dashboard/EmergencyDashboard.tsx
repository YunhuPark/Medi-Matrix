import { AlertTriangle, MapPin, X, ShieldAlert } from 'lucide-react';
import { buildGoldenTimeUrl } from '../../lib/goldenTimeUrl';

interface EmergencyDashboardProps {
  onClose: () => void;
  patientId: string | null;
  triageLevel: string | null;
  lesionVolume: number;
  triggeringCondition: string | null;
  hasSepsisRisk: boolean;
  modality: 'Brain' | 'Lung';
}

export function EmergencyDashboard({
  onClose,
  patientId,
  triageLevel,
  lesionVolume,
  modality,
}: EmergencyDashboardProps) {
  const normalizedTriage = triageLevel?.trim().toUpperCase() ?? '';
  const isRed = normalizedTriage.startsWith('RED');
  const isYellow = normalizedTriage.startsWith('YELLOW');
  const isGreen = normalizedTriage.startsWith('GREEN');

  const theme = isRed
    ? {
        accent: '#ef4444',
        soft: 'rgba(239, 68, 68, 0.1)',
        shadow: 'rgba(239, 68, 68, 0.3)',
        light: '#fca5a5',
        title: '중증 응급 환자 발생 (CODE RED)',
        status: '전신 악화 위험 신호 감지',
      }
    : isYellow
      ? {
          accent: '#eab308',
          soft: 'rgba(234, 179, 8, 0.1)',
          shadow: 'rgba(234, 179, 8, 0.3)',
          light: '#fde047',
          title: '집중 모니터링 필요 (YELLOW)',
          status: '집중 모니터링 필요',
        }
      : isGreen
        ? {
            accent: '#22c55e',
            soft: 'rgba(34, 197, 94, 0.1)',
            shadow: 'rgba(34, 197, 94, 0.3)',
            light: '#86efac',
            title: '환자 상태 안정화 (GREEN)',
            status: '안정 범위 모니터링',
          }
        : {
            accent: '#f59e0b',
            soft: 'rgba(245, 158, 11, 0.1)',
            shadow: 'rgba(245, 158, 11, 0.3)',
            light: '#fcd34d',
            title: '환자 상태 모니터링',
            status: '현재 상태 확인',
          };

  const displayTriage = isRed
    ? 'RED (초응급 - 전신 악화 위험)'
    : triageLevel;

  const handleGoldenTimeRedirect = () => {
    // 기존 YELLOW / RED 분기를 그대로 사용합니다.
    // RED 안에서만 ARDS-like / Sepsis-like / Shock-like를 하나의
    // systemic_deterioration_demo 경로로 통일합니다.
    const url = buildGoldenTimeUrl({
      triage: triageLevel,
      modality,
      lesionVolume,
      vitalsCondition: null,
      hasSepsisRisk: false,
    });
    window.open(url, '_blank');
  };

  const brainProtocol = isRed
    ? {
        heading: '🧠 뇌 병변 + 전신악화 대응 병원 탐색',
        body: 'RED에서는 ARDS-like·Sepsis-like·Shock-like 중 무엇이 높든 동일하게 응급실·ICU·뇌 영상·수술 자원을 확인합니다.',
      }
    : {
        heading: '🧠 뇌 병변 대응 병원 탐색',
        body: 'YELLOW에서는 뇌 병변 대응을 위해 CT/MRI·수술 가능 자원을 중심으로 확인합니다.',
      };

  return (
    <div
      data-triage-flow-version="live-yellow-red-v1"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        zIndex: 9999,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontFamily: 'sans-serif'
      }}
    >
      <div style={{
        width: '90%', maxWidth: '800px',
        backgroundColor: '#1e1e24', border: `2px solid ${theme.accent}`,
        borderRadius: '12px', padding: '2rem',
        boxShadow: `0 0 30px ${theme.shadow}`,
        position: 'relative'
      }}>
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}
        >
          <X size={24} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', borderBottom: `1px solid ${theme.accent}`, paddingBottom: '1rem' }}>
          <ShieldAlert size={48} color={theme.accent} />
          <div>
            <h1 style={{ margin: 0, color: theme.accent, fontSize: '2rem' }}>{theme.title}</h1>
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
              <li>
                <strong>Vitals 상태:</strong>{' '}
                <span style={{ color: theme.accent, fontWeight: 'bold' }}>{theme.status}</span>
                {' '}(합성 데모)
              </li>
              <li><strong>최종 분류:</strong> <span style={{ color: theme.accent, fontWeight: 'bold' }}>{displayTriage}</span></li>
            </ul>
            <p style={{ margin: '1rem 0 0 0', fontSize: '0.75rem', color: '#6b7280' }}>
              * ARDS-like / Sepsis-like / Shock-like 점수는 왼쪽 실시간 Vitals 패널의 참고 신호이며, RED 내부의 병원 탐색 경로만 공통 처리합니다.
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
                  <strong>{brainProtocol.heading}</strong><br />
                  {brainProtocol.body}<br />
                  <span style={{ color: '#fbbf24', fontSize: '0.75rem' }}>공개 응급의료 정보 기반 추천 (임상 진단 아님)</span>
                </div>
              ) : (
                <div style={{
                  backgroundColor: 'rgba(251, 191, 36, 0.1)', padding: '0.75rem',
                  borderRadius: '8px', border: '1px solid #fbbf24', fontSize: '0.85rem', color: '#fcd34d'
                }}>
                  <strong>⚠️ {modality} 모드 특화 추천 미지원</strong><br />
                  {isRed
                    ? 'RED에서는 응급실·ICU 등 전신악화 대응 자원을 우선 확인합니다.'
                    : '현재 응급도에 맞는 공개 응급의료 가용자원을 기준으로 탐색합니다.'}<br />
                  공개 응급의료 가용자원을 기준으로 탐색합니다.
                </div>
              )}

              <div style={{
                display: 'flex', alignItems: 'center', gap: '1rem',
                backgroundColor: theme.soft, padding: '1rem',
                borderRadius: '8px', border: `1px solid ${theme.accent}`
              }}>
                <AlertTriangle size={32} color={theme.accent} />
                <div>
                  <p style={{ margin: 0, color: theme.accent, fontSize: '0.9rem', fontWeight: 'bold' }}>
                    {isRed ? '⚠️ 신속한 병상 수배 요망' : isYellow ? '⚠️ 집중 모니터링 대응 병원 탐색' : '현재 상태 기반 병원 탐색'}
                  </p>
                  <h2 style={{ margin: 0, color: theme.light, fontSize: '1.1rem' }}>Golden Time 시스템으로 연결합니다.</h2>
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