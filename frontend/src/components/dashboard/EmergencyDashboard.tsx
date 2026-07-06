
import { AlertTriangle, MapPin, X, ShieldAlert } from 'lucide-react';

interface EmergencyDashboardProps {
  onClose: () => void;
  patientId: string | null;
  triageLevel: string | null;
  lesionVolume: number;
  triggeringCondition: string | null;
}

export function EmergencyDashboard({ onClose, patientId, triageLevel, lesionVolume, triggeringCondition }: EmergencyDashboardProps) {
  const handleGoldenTimeRedirect = () => {
    const diseaseParam = encodeURIComponent(triggeringCondition || 'Unknown');
    // 배포된 응급실(Golden Time) 사이트로 리디렉션
    window.open(`https://golden-time.vercel.app/?triage=RED&disease=${diseaseParam}&volume=${lesionVolume}`, '_blank');
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
            <p style={{ margin: 0, color: '#fca5a5', fontSize: '1.2rem' }}>Multi-modal AI Triage System 자동 관제</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
          <div style={{ backgroundColor: '#2a2a35', padding: '1.5rem', borderRadius: '8px' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#9ca3af' }}>AI 분석 리포트</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: '1.8' }}>
              <li><strong>환자 ID:</strong> <span style={{ color: '#fff' }}>{patientId || 'Unknown'}</span></li>
              <li><strong>병변 체적 (Vision):</strong> <span style={{ color: '#60a5fa' }}>{lesionVolume.toLocaleString()} voxels</span> (위험 수치)</li>
              <li><strong>초응급 유발 원인:</strong> <span style={{ color: '#f472b6', fontWeight: 'bold' }}>{triggeringCondition || 'N/A'}</span> (급성 진행 위험)</li>
              <li><strong>최종 분류:</strong> <span style={{ color: '#ef4444', fontWeight: 'bold' }}>{triageLevel}</span></li>
            </ul>
          </div>

          <div style={{ backgroundColor: '#2a2a35', padding: '1.5rem', borderRadius: '8px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#9ca3af' }}>환자 이송 프로토콜</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '1rem', borderRadius: '8px', border: '1px solid #ef4444' }}>
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
                fontSize: '1.05rem', fontWeight: 'bold', cursor: 'pointer', marginTop: '1rem'
              }}>
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
