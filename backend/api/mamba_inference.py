import os
import hashlib

class MambaSystemicPredictor:
    def __init__(self):
        self.mode = os.environ.get("INFERENCE_MODE", "demo")
        self.model = None
        self.device = None
        
        if self.mode == "model":
            # Lazy import torch
            import torch
            import torch.nn as nn

            class DummyMambaModel(nn.Module):
                """
                실제 IMST-Mamba 아키텍처의 뼈대(Skeleton)입니다.
                사용자가 진짜 가중치를 넣을 때까지 이 구조가 대신 에러 핸들링을 수행합니다.
                """
                def __init__(self, input_dim=6, hidden_dim=64):
                    super(DummyMambaModel, self).__init__()
                    self.fc1 = nn.Linear(input_dim, hidden_dim)
                    self.fc2 = nn.Linear(hidden_dim, 3)
                    self.sigmoid = nn.Sigmoid()

                def forward(self, x):
                    out = self.fc1(x[:, -1, :])
                    out = torch.relu(out)
                    out = self.fc2(out)
                    return self.sigmoid(out)

            self.model_path = os.path.join(os.path.dirname(__file__), "../models/imst_mamba_systemic_model.pth")
            self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
            
            if not os.path.exists(self.model_path):
                raise FileNotFoundError(
                    f"[Real-Data Policy Error] 실제 Mamba Systemic 모델 파일이 없습니다: {self.model_path}. "
                    "회사에서 학습시킨 다중 병증(패혈증/ARDS/쇼크) 모델 가중치(.pth)를 해당 경로에 넣어주세요."
                )
                
            self.model = DummyMambaModel().to(self.device)
            self.model.load_state_dict(torch.load(self.model_path, map_location=self.device, weights_only=True))
            self.model.eval()
        
    def predict(self, window_data):
        """
        window_data: list of dicts (10초~60초 분량의 시계열 데이터)
        반환값: 3가지 질환에 대한 발생 확률 딕셔너리
        """
        if self.mode == "demo":
            # Demo는 결정론적 시뮬레이터입니다. 임상 진단 및 학습 모델 추론이 아닙니다.
            # 합성 데이터 UI·API·스트리밍 흐름 검증용입니다.
            if not window_data:
                return {"sepsis": 0.0, "ards": 0.0, "shock": 0.0}
            
            # 결정론적 시뮬레이션
            last_row = window_data[-1]
            hr = float(last_row.get("hr", 80))
            bp = float(last_row.get("bpSys", 120))
            
            # 입력값 기반 결정론적 난수 효과
            seed_str = f"{hr}_{bp}"
            hash_val = int(hashlib.md5(seed_str.encode()).hexdigest(), 16)
            base = (hash_val % 200) / 1000.0  # 0 ~ 0.2
            
            if hr > 100 and bp < 90:
                sepsis = 0.7 + base
            else:
                sepsis = 0.2 + base
                
            return {
                "sepsis": min(sepsis, 0.99),
                "ards": min(sepsis * 0.8, 0.99),
                "shock": min(sepsis * 0.9, 0.99)
            }
            
        else:
            # model 모드 실제 추론
            import torch
            features = []
            for row in window_data:
                features.append([
                    float(row.get('hr', 80)),
                    float(row.get('bpSys', 120)),
                    float(row.get('bpDia', 80)),
                    float(row.get('resp', 16)),
                    float(row.get('temp', 36.5)),
                    float(row.get('spo2', 98))
                ])
                
            x = torch.tensor([features], dtype=torch.float32).to(self.device)
            
            with torch.no_grad():
                probs = self.model(x)[0].tolist()
                
            return {
                "sepsis": probs[0],
                "ards": probs[1],
                "shock": probs[2]
            }
