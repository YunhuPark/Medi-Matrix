import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EmergencyDashboard } from '../components/dashboard/EmergencyDashboard';

describe('EmergencyDashboard submission copy', () => {
  it('separates Vision demo, Vitals provenance, and nonclinical triage policy', () => {
    render(
      <EmergencyDashboard
        onClose={vi.fn()}
        patientId="demo-case-1"
        triageLevel="YELLOW"
        lesionVolume={1234}
        triggeringCondition={null}
        hasSepsisRisk={false}
        modality="Brain"
      />,
    );

    expect(screen.getByText(/Vision은 합성\/결정론적 데모/)).toBeInTheDocument();
    expect(screen.getByText(/Vitals AI는 서버 provenance 기준/)).toBeInTheDocument();
    expect(screen.getByText('Case Context & Triage')).toBeInTheDocument();
    expect(screen.getByText(/Demo Case ID:/)).toBeInTheDocument();
    expect(screen.getByText(/Case Vitals 스트림 \+ 비임상 demo policy/)).toBeInTheDocument();
    expect(screen.getByText(/Golden-Time 검색 필터입니다/)).toBeInTheDocument();

    expect(screen.queryByText('합성 데이터 분석 리포트')).not.toBeInTheDocument();
    expect(screen.queryByText(/Vitals 상태:.*합성 데모/)).not.toBeInTheDocument();
  });
});
