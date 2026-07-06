import random
import hashlib

class MambaSepsisSimulator:
    def __init__(self):
        # 환자별 누적 위험도 상태 저장 (시계열 스트리밍 효과)
        self.patient_risks = {}

    def simulate_continuous_inference(self, patient_id: str, hr: float, bp_sys: float, bp_dia: float, resp: float, temp: float, spo2: float) -> float:
        """
        스트리밍된 생체신호(HR, BP, Resp, Temp, SpO2)를 바탕으로 실시간 패혈증 발병 확률을 추론합니다.
        추후 이 껍데기 인터페이스 안에 IMST-Mamba 파이토치 모델(imst_mamba_best.pth)을 로드하여,
        텐서(Tensor) 변환 후 model.forward()를 호출하도록 교체할 예정입니다.
        """
        # 환자 ID에 따른 기본 베이스라인 확률 결정 (결정론적)
        hash_val = int(hashlib.md5(patient_id.encode()).hexdigest(), 16)
        base_prob = 50.0 + (hash_val % 300) / 10.0  # 50.0 ~ 80.0

        if patient_id not in self.patient_risks:
            self.patient_risks[patient_id] = base_prob
        
        # 생체 신호(Vitals)에 따른 동적 스트레스(위험도) 계산
        # 정상 심박(HR): 60~100, 정상 수축기 혈압(BP_SYS): 90~120
        stress_hr = 0.0
        if hr > 100:
            stress_hr = (hr - 100) * 0.5
        elif hr < 60:
            stress_hr = (60 - hr) * 0.5
            
        stress_bp = 0.0
        if bp_sys < 90:
            stress_bp = (90 - bp_sys) * 0.8  # 저혈압은 패혈증의 강한 징후
        elif bp_sys > 140:
            stress_bp = (bp_sys - 140) * 0.2
            
        total_stress = stress_hr + stress_bp
        
        # 실제 모델이 평가하는 듯한 미세한 노이즈 추가
        noise = random.uniform(-1.5, 1.5)
        
        # 지수 이동 평균(EMA)을 사용하여 부드럽게 확률 업데이트
        current_risk = self.patient_risks[patient_id]
        target_risk = min(max(base_prob + total_stress, 0.0), 99.9)
        
        new_risk = current_risk * 0.8 + target_risk * 0.2 + noise
        new_risk = min(max(new_risk, 0.0), 99.9)
        
        self.patient_risks[patient_id] = new_risk
        
        return round(new_risk, 1)

    def determine_multimodal_triage(self, volume: float, sepsis_prob: float) -> str:
        """
        Vision 모델의 병변 부피와 Time-series 모델의 패혈증 확률을 융합하여 응급도 산출
        """
        if volume > 15000 and sepsis_prob > 80.0:
            return "CODE RED (초응급)"
        elif volume > 10000 or sepsis_prob > 85.0:
            return "RED"
        elif volume > 5000 or sepsis_prob > 75.0:
            return "YELLOW"
        else:
            return "GREEN"

# 싱글톤 인스턴스 생성
mamba_simulator = MambaSepsisSimulator()
