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

  const liveStatusColor = isRed
    ? '#ef4444'
    : isYellow
      ? '#eab308'
      : isGreen
        ? '#22c55e'
        : '#f59e0b';

  const liveStatusGlow = isRed
    ? 'rgba(239, 68, 68, 0.30)'
    : isYellow
      ? 'rgba(234, 179, 8, 0.22)'
      : isGreen
        ? 'rgba(34, 197, 94, 0.20)'
        : 'rgba(245, 158, 11, 0.20)';

  const liveVitalsStatus = isRed
    ? '전신 악화 위험 신호 감지'
    : isYellow
      ? '집중 모니터링 필요'
      : isGreen
        ? '안정 범위 모니터링'
        : '현재 상태 확인';

  const displayTriage = isRed
    ? 'RED (초응급 - 전신 악화 위험)'
    : isYellow
      ? 'YELLOW (응급 - 집중 모니터링)'
      : isGreen
        ? 'GREEN (안정 범위 모니터링)'
        : triageLevel;

  const headerTitle = isRed
    ? '상급병원 전원 검토 · RED Context'
    : isYellow
      ? '상급병원 전원 후보 사전 확인 · YELLOW'
      : isGreen
        ? '현재 상태 안정 범위 · GREEN'
        : '전원 지원 Context';

  const handleGoldenTimeRedirect = () => {
    // 현재 실시간 응급도를 그대로 전달해 YELLOW / RED 병원 탐색 분기를 사용합니다.
    // Golden-Time은 의료진을 대신해 전원을 결정하지 않고, 공개 가용자원 기반 후보 탐색만 지원합니다.
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
        heading: '🧠 뇌 병변 Context + 전신악화 대응 자원',
        body: 'RED에서는 합성 Vitals 악화와 영상 Context를 바탕으로 응급실·ICU·뇌 영상·수술 자원이 필요한 전원 시나리오를 구성합니다.',
      }
    : isYellow
      ? {
          heading: '🧠 뇌 병변 Context 기반 전원 후보 사전 확인',
          body: 'YELLOW에서는 상태 악화 가능성에 대비해 CT/MRI·수술 가능 자원을 갖춘 병원 후보를 미리 확인합니다.',
        }
      : {
          heading: '🧠 현재 Case 모니터링',
          body: 'GREEN에서는 현재 상태를 계속 모니터링하고, 응급도가 상승하면 전원 탐색에 필요한 자원 조건도 함께 갱신합니다.',
        };

  const escalationPanel = isRed
    ? {
        backgroundColor: 'rgba(239, 68, 68, 0.10)',
        borderColor: '#ef4444',
        iconColor: '#ef4444',
        labelColor: '#ef4444',
        titleColor: '#fca5a5',
        label: '⚠️ 전원 후보 긴급 탐색 Context',
        title: '현재 RED 데모 기준으로 응급실·ICU 등 대응 자원을 추가 확인합니다.',
      }
    : isYellow
      ? {
          backgroundColor: 'rgba(234, 179, 8, 0.10)',
          borderColor: '#eab308',
          iconColor: '#eab308',
          labelColor: '#eab308',
          titleColor: '#fde68a',
          label: '현재 상태: 집중 모니터링',
          title: '상태 악화에 대비해 영상·수술 자원을 갖춘 전원 후보를 사전 확인합니다.',
        }
      : {
          backgroundColor: 'rgba(34, 197, 94, 0.10)',
          borderColor: '#22c55e',
          iconColor: '#22c55e',
          labelColor: '#22c55e',
          titleColor: '#bbf7d0',
          label: '현재 상태: 안정 범위 모니터링',
          title: '실시간 Vitals 변화를 계속 확인합니다.',
        };

  const goldenTimeButtonLabel = isRed
    ? 'RED · 필요한 자원 기준 전원 후보 탐색'
    : isYellow
      ? 'YELLOW · 대응 가능 병원 후보 사전 확인'
      : '현재 Context 기준 병원 후보 탐색';

  return (
    <div
      data-triage-flow-version="transfer-context-v1"
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
        backgroundColor: '#1e1e24', border: `2px solid ${liveStatusColor}`,
        borderRadius: '12px', padding: '2rem',
        boxShadow: `0 0 30px ${liveStatusGlow}`,
        position: 'relative',
        transition: 'border-color 350ms ease, box-shadow 350ms ease'
      }}>
        <button
          onClick={onClose}
          aria-label="전원 지원 Context 닫기"
          style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}
        >
          <X size={24} />
        </button>

        <div style={{
          display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem',
          borderBottom: `1px solid ${liveStatusColor}`, paddingBottom: '1rem',
          transition: 'border-color 350ms ease'
        }}>
          <ShieldAlert size={48} color={liveStatusColor} style={{ transition: 'color 350ms ease' }} />
          <div>
            <h1 style={{ margin: 0, color: liveStatusColor, fontSize: '2rem', transition: 'color 350ms ease' }}>{headerTitle}</h1>
            <p style={{ margin: '4px 0 0 0', color: '#fbbf24', fontSize: '0.9rem', fontWeight: 'bold' }}>
              합성 데이터 기반 전원 지원 데모 | 임상 진단·전원 지시 아님
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
          <div style={{ backgroundColor: '#2a2a35', padding: '1.5rem', borderRadius: '8px' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#9ca3af' }}>현재 Case Context</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: '1.8' }}>
              <li><strong>Case ID:</strong> <span style={{ color: '#fff' }}>{patientId || 'Unknown'}</span></li>
              <li>
                <strong>영상 Context:</strong>{' '}
                <span style={{ color: '#60a5fa' }}>
                  {modality === 'Brain' ? '🧠 Brain MRI demo' : '🫁 Lung CT demo'}
                </span>
              </li>
              <li>
                <strong>병변 체적 (Vision):</strong>{' '}
                <span style={{ color: '#60a5fa' }}>{lesionVolume.toLocaleString()} voxels</span>
                {' '}(synthetic 3D context)
              </li>
              <li>
                <strong>Vitals 상태:</strong>{' '}
                <span style={{ color: liveStatusColor, fontWeight: 'bold', transition: 'color 350ms ease' }}>{liveVitalsStatus}</span>
                {' '}(합성 Replay)
              </li>
              <li>
                <strong>현재 Demo Triage:</strong>{' '}
                <span style={{ color: liveStatusColor, fontWeight: 'bold', transition: 'color 350ms ease' }}>{displayTriage}</span>
              </li>
            </ul>
            <p style={{ margin: '1rem 0 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>
              * Case ID는 환자명·MRN이 아닌 비식별 데모 Encounter 키입니다. 실제 적용에서는 병원 PACS/EMR Encounter와 서버 측에서 매핑하는 구조를 목표로 합니다.
            </p>
          </div>

          <div style={{ backgroundColor: '#2a2a35', padding: '1.5rem', borderRadius: '8px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#9ca3af' }}>전원 탐색 Context</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {modality === 'Brain' ? (
                <div style={{
                  backgroundColor: 'rgba(96, 165, 250, 0.1)', padding: '0.75rem',
                  borderRadius: '8px', border: '1px solid #60a5fa', fontSize: '0.85rem', color: '#93c5fd'
                }}>
                  <strong>{brainProtocol.heading}</strong><br />
                  {brainProtocol.body}<br />
                  <span style={{ color: '#fbbf24', fontSize: '0.75rem' }}>필요 자원은 데모 정책이며 임상 표준·전원 지시가 아닙니다.</span>
                </div>
              ) : (
                <div style={{
                  backgroundColor: 'rgba(251, 191, 36, 0.1)', padding: '0.75rem',
                  borderRadius: '8px', border: '1px solid #fbbf24', fontSize: '0.85rem', color: '#fcd34d'
                }}>
                  <strong>⚠️ {modality} 모드 특화 전원 정책 미지원</strong><br />
                  현재 응급도에 맞는 공개 응급의료 가용자원을 기준으로 후보 탐색만 지원합니다.
                </div>
              )}

              <div style={{
                display: 'flex', alignItems: 'center', gap: '1rem',
                backgroundColor: escalationPanel.backgroundColor, padding: '1rem',
                borderRadius: '8px', border: `1px solid ${escalationPanel.borderColor}`,
                transition: 'background-color 350ms ease, border-color 350ms ease'
              }}>
                <AlertTriangle size={32} color={escalationPanel.iconColor} />
                <div>
                  <p style={{ margin: 0, color: escalationPanel.labelColor, fontSize: '0.9rem', fontWeight: 'bold' }}>{escalationPanel.label}</p>
                  <h2 style={{ margin: 0, color: escalationPanel.titleColor, fontSize: '1.1rem' }}>{escalationPanel.title}</h2>
                </div>
              </div>

              <button
                onClick={handleGoldenTimeRedirect}
                disabled={isGreen}
                title={isGreen ? 'YELLOW 또는 RED에서 전원 후보 탐색이 활성화됩니다.' : undefined}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                  padding: '1rem', backgroundColor: isGreen ? '#475569' : isRed ? '#ef4444' : '#f59e0b', color: '#fff', border: 'none', borderRadius: '8px',
                  fontSize: '1.05rem', fontWeight: 'bold', cursor: isGreen ? 'not-allowed' : 'pointer', marginTop: '0.5rem', opacity: isGreen ? 0.65 : 1
                }}
              >
                <MapPin size={20} />
                {goldenTimeButtonLabel}
              </button>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.72rem', lineHeight: 1.4 }}>
                Golden-Time은 E-Gen 공개 가용자원과 위치 정보를 이용해 후보 탐색을 지원하며, 최종 전원 결정과 수용 확정은 의료기관 간 절차가 필요합니다.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
