import { AlertTriangle, MapPin, X, ShieldAlert } from 'lucide-react';
import { buildGoldenTimeUrl } from '../../lib/goldenTimeUrl';
import { buildTransferRequirements } from '../../lib/transferSupport';

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
  const requiredResources = buildTransferRequirements(triageLevel, modality);

  // 모달은 사용자가 X를 누를 때까지 유지하되, 실시간 스트리밍의 현재 Triage에 맞춰
  // 제목/테두리/상태 패널만 부드럽게 갱신합니다. pulse 같은 반복 애니메이션은 사용하지 않아
  // YELLOW <-> RED 전환이 잦아도 화면 피로도를 최소화합니다.
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
    ? '중증 응급 환자 발생 (CODE RED)'
    : isYellow
      ? '집중 모니터링 필요 (YELLOW)'
      : isGreen
        ? '현재 상태 안정 범위 (GREEN)'
        : '실시간 응급도 모니터링';

  const handleGoldenTimeRedirect = () => {
    // 현재 실시간 응급도를 그대로 전달해 YELLOW / RED 병원 탐색 분기를 사용합니다.
    // RED 내부에서는 ARDS-like / Sepsis-like / Shock-like가 공통 systemic 경로를 사용합니다.
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
        body: 'RED에서는 응급실·ICU·뇌 CT/MRI·응급의학과·내과·신경외과·신경과 대응 여부를 확인합니다.',
      }
    : isYellow
      ? {
          heading: '🧠 뇌 병변 대응 병원 후보 사전 확인',
          body: 'YELLOW에서는 상태 악화에 대비해 ICU·뇌 CT/MRI·신경외과·신경과 대응 여부를 갖춘 병원 후보를 미리 확인합니다.',
        }
      : {
          heading: '🧠 현재 상태 모니터링',
          body: 'GREEN에서는 현재 상태를 계속 모니터링하고, 응급도가 상승하면 해당 기준으로 병원 탐색 조건을 갱신합니다.',
        };

  const escalationPanel = isRed
    ? {
        backgroundColor: 'rgba(239, 68, 68, 0.10)',
        borderColor: '#ef4444',
        iconColor: '#ef4444',
        labelColor: '#ef4444',
        titleColor: '#fca5a5',
        label: '⚠️ 긴급 이송 병원 탐색',
        title: '현재 RED 기준으로 응급실·ICU 등 대응 자원을 확인합니다.',
      }
    : isYellow
      ? {
          backgroundColor: 'rgba(234, 179, 8, 0.10)',
          borderColor: '#eab308',
          iconColor: '#eab308',
          labelColor: '#eab308',
          titleColor: '#fde68a',
          label: '현재 상태: 집중 모니터링',
          title: '상태 악화에 대비해 필요한 병원 후보를 사전 확인합니다.',
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
    ? 'RED · 긴급 이송 병원 탐색'
    : isYellow
      ? 'YELLOW · 대응 병원 후보 확인'
      : '현재 상태 기준 Golden Time 병원 탐색';

  return (
    <div
      data-triage-flow-version="live-triage-shell-v4"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.82)',
        zIndex: 9999,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '1.25rem',
        color: '#fff', fontFamily: 'sans-serif'
      }}
    >
      <div style={{
        width: '82%', maxWidth: '920px', maxHeight: '78vh', overflowY: 'auto',
        backgroundColor: '#1e1e24', border: `2px solid ${liveStatusColor}`,
        borderRadius: '12px', padding: '1.25rem 1.35rem',
        boxShadow: `0 0 24px ${liveStatusGlow}`,
        position: 'relative',
        transition: 'border-color 350ms ease, box-shadow 350ms ease'
      }}>
        <button
          onClick={onClose}
          aria-label="전원 의사결정 대시보드 닫기"
          style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}
        >
          <X size={21} />
        </button>

        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem',
          borderBottom: `1px solid ${liveStatusColor}`, paddingBottom: '0.75rem',
          transition: 'border-color 350ms ease'
        }}>
          <ShieldAlert size={36} color={liveStatusColor} style={{ transition: 'color 350ms ease', flex: '0 0 auto' }} />
          <div style={{ paddingRight: '1.75rem' }}>
            <h1 style={{ margin: 0, color: liveStatusColor, fontSize: '1.45rem', lineHeight: 1.2, transition: 'color 350ms ease' }}>{headerTitle}</h1>
            <p style={{ margin: '3px 0 0 0', color: '#fbbf24', fontSize: '0.72rem', lineHeight: 1.35, fontWeight: 'bold' }}>
              전원 의사결정 지원 프로토타입 · Vision은 합성/결정론적 데모 · Vitals AI는 서버 provenance 기준 · 임상 진단 아님
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '0.95fr 1.05fr', gap: '1rem', marginBottom: 0 }}>
          <div style={{ backgroundColor: '#2a2a35', padding: '1rem', borderRadius: '8px' }}>
            <h3 style={{ margin: '0 0 0.7rem 0', color: '#9ca3af', fontSize: '0.98rem' }}>Case Context & Triage</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: '1.55', fontSize: '0.86rem' }}>
              <li><strong>Demo Case ID:</strong> <span style={{ color: '#fff' }}>{patientId || 'Unknown'}</span></li>
              <li>
                <strong>영상 Context:</strong>{' '}
                <span style={{ color: '#60a5fa' }}>
                  {modality === 'Brain' ? '🧠 뇌 영상 (Brain MRI)' : '🫁 폐 영상 (Lung CT)'}
                </span>
                {' '}(합성/결정론적 Vision demo)
              </li>
              <li>
                <strong>병변 체적 (Vision):</strong>{' '}
                <span style={{ color: '#60a5fa' }}>{lesionVolume.toLocaleString()} voxels</span>
                {' '}(3D context)
              </li>
              <li>
                <strong>Vitals/Triage 상태:</strong>{' '}
                <span style={{ color: liveStatusColor, fontWeight: 'bold', transition: 'color 350ms ease' }}>{liveVitalsStatus}</span>
                {' '}(Case Vitals 스트림 + 비임상 demo policy)
              </li>
              <li>
                <strong>현재 실시간 분류:</strong>{' '}
                <span style={{ color: liveStatusColor, fontWeight: 'bold', transition: 'color 350ms ease' }}>{displayTriage}</span>
              </li>
            </ul>
            <p style={{ margin: '0.75rem 0 0 0', fontSize: '0.66rem', lineHeight: 1.4, color: '#6b7280' }}>
              * Vitals AI의 실제 model/demo 구분과 모델 provenance는 메인 AI Risk 카드에 표시됩니다. 이 대시보드의 Triage와 자원 조건은 비임상 전원 지원 데모 정책입니다.
            </p>
          </div>

          <div style={{ backgroundColor: '#2a2a35', padding: '1rem', borderRadius: '8px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <h3 style={{ margin: '0 0 0.7rem 0', color: '#9ca3af', fontSize: '0.98rem' }}>전원 후보 탐색 가이드</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {modality === 'Brain' ? (
                <div style={{
                  backgroundColor: 'rgba(96, 165, 250, 0.1)', padding: '0.62rem 0.68rem',
                  borderRadius: '8px', border: '1px solid #60a5fa', fontSize: '0.76rem', lineHeight: 1.45, color: '#93c5fd'
                }}>
                  <strong>{brainProtocol.heading}</strong><br />
                  {brainProtocol.body}<br />
                  <span style={{ color: '#fbbf24', fontSize: '0.67rem' }}>공개 응급의료 정보 기반 후보 탐색 · 임상 진단/자동 전원 결정 아님</span>
                </div>
              ) : (
                <div style={{
                  backgroundColor: 'rgba(251, 191, 36, 0.1)', padding: '0.62rem 0.68rem',
                  borderRadius: '8px', border: '1px solid #fbbf24', fontSize: '0.76rem', lineHeight: 1.45, color: '#fcd34d'
                }}>
                  <strong>⚠️ {modality} 모드 특화 추천 미지원</strong><br />
                  {isRed
                    ? 'RED에서는 응급실·ICU·응급의학과·내과 등 전신악화 대응 자원을 우선 확인합니다.'
                    : '현재 응급도에 맞는 공개 응급의료 가용자원을 기준으로 탐색합니다.'}
                </div>
              )}

              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.7rem',
                backgroundColor: escalationPanel.backgroundColor, padding: '0.72rem',
                borderRadius: '8px', border: `1px solid ${escalationPanel.borderColor}`,
                transition: 'background-color 350ms ease, border-color 350ms ease'
              }}>
                <AlertTriangle size={25} color={escalationPanel.iconColor} />
                <div>
                  <p style={{ margin: 0, color: escalationPanel.labelColor, fontSize: '0.76rem', fontWeight: 'bold' }}>{escalationPanel.label}</p>
                  <h2 style={{ margin: '2px 0 0', color: escalationPanel.titleColor, fontSize: '0.95rem', lineHeight: 1.3 }}>{escalationPanel.title}</h2>
                </div>
              </div>

              {(isRed || isYellow) && requiredResources.length > 0 && (
                <div
                  data-testid="transfer-resource-requirements"
                  style={{
                    padding: '0.68rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(147,197,253,0.28)',
                    backgroundColor: 'rgba(59,130,246,0.08)',
                  }}
                >
                  <div style={{ color: '#bfdbfe', fontSize: '0.76rem', fontWeight: 800 }}>전원 후보 탐색 자원 조건</div>
                  <div style={{ marginTop: 4, color: '#9ca3af', fontSize: '0.65rem', lineHeight: 1.38 }}>
                    현재 Case의 비임상 Triage와 영상 Context에서 구조적으로 도출한 Golden-Time 검색 필터입니다. 의료진 판단을 대체하지 않습니다.
                  </div>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 17, color: '#dbeafe', fontSize: '0.69rem', lineHeight: 1.4, columns: requiredResources.length >= 6 ? 2 : 1, columnGap: 22 }}>
                    {requiredResources.map((resource) => (
                      <li key={`${resource.kind}:${resource.id}`}>{resource.label}</li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                onClick={handleGoldenTimeRedirect}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem',
                  padding: '0.72rem', backgroundColor: isRed ? '#ef4444' : '#f59e0b', color: '#fff', border: 'none', borderRadius: '8px',
                  fontSize: '0.9rem', fontWeight: 'bold', cursor: 'pointer', marginTop: '0.1rem'
                }}
              >
                <MapPin size={18} />
                {goldenTimeButtonLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
