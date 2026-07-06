import os
import torch
import torch.nn as nn

class DummyMambaModel(nn.Module):
    """
    실제 IMST-Mamba 아키텍처의 뼈대(Skeleton)입니다.
    사용자가 진짜 가중치를 넣을 때까지 이 구조가 대신 에러 핸들링을 수행합니다.
    다중 병증(Multi-label) 동시 예측을 위해 output 차원이 3개입니다.
    """
    def __init__(self, input_dim=6, hidden_dim=64):
        super(DummyMambaModel, self).__init__()
        self.fc1 = nn.Linear(input_dim, hidden_dim)
        # 3가지 병증 출력: Sepsis, ARDS, Shock
        self.fc2 = nn.Linear(hidden_dim, 3)
        self.sigmoid = nn.Sigmoid()

    def forward(self, x):
        # x shape: (batch, seq_len, input_dim)
        out = self.fc1(x[:, -1, :])
        out = torch.relu(out)
        out = self.fc2(out)
        return self.sigmoid(out)

class MambaSystemicPredictor:
    def __init__(self):
        self.model_path = os.path.join(os.path.dirname(__file__), "../models/imst_mamba_systemic_model.pth")
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
        # 모델 부재 시 강제 에러 발생 (Real-Data-Only 정책)
        if not os.path.exists(self.model_path):
            raise FileNotFoundError(
                f"[Real-Data Policy Error] 실제 Mamba Systemic 모델 파일이 없습니다: {self.model_path}. "
                "회사에서 학습시킨 다중 병증(패혈증/ARDS/쇼크) 모델 가중치(.pth)를 해당 경로에 넣어주세요."
            )
            
        # 실제 모델 로드 로직
        self.model = DummyMambaModel().to(self.device)
        self.model.load_state_dict(torch.load(self.model_path, map_location=self.device))
        self.model.eval()
        
    def predict(self, window_data):
        """
        window_data: list of dicts (10초~60초 분량의 시계열 데이터)
        반환값: 3가지 질환에 대한 발생 확률 딕셔너리
        """
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
            # shape: (1, 3)
            probs = self.model(x)[0].tolist()
            
        return {
            "sepsis": probs[0],
            "ards": probs[1],
            "shock": probs[2]
        }
