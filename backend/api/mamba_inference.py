import os


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

            self.model_path = os.path.join(
                os.path.dirname(__file__), "../models/imst_mamba_systemic_model.pth"
            )
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

            if not os.path.exists(self.model_path):
                raise FileNotFoundError(
                    f"[Real-Data Policy Error] 실제 Mamba Systemic 모델 파일이 없습니다: {self.model_path}. "
                    "검증된 모델 가중치를 해당 경로에 넣어주세요."
                )

            self.model = DummyMambaModel().to(self.device)
            self.model.load_state_dict(
                torch.load(self.model_path, map_location=self.device, weights_only=True)
            )
            self.model.eval()

    @staticmethod
    def _clamp01(value: float) -> float:
        return max(0.0, min(float(value), 1.0))

    def _demo_scores(self, row: dict) -> dict[str, float]:
        """합성 Vitals의 변화가 화면에서 재현되도록 만든 결정론적 데모 점수.

        임상 확률이나 진단 결과가 아니다. 각 병증 유사 패턴을 서로 다른
        Vitals 조합으로 계산해 Stable/Warning/Critical 구간의 차이를 보여준다.
        """
        hr = float(row.get("hr", 80))
        bp_sys = float(row.get("bpSys", 120))
        resp = float(row.get("resp", 16))
        temp = float(row.get("temp", 36.5))
        spo2 = float(row.get("spo2", 98))

        hr_risk = self._clamp01((hr - 85.0) / 35.0)
        hypotension_risk = self._clamp01((105.0 - bp_sys) / 30.0)
        resp_risk = self._clamp01((resp - 18.0) / 12.0)
        fever_risk = self._clamp01((temp - 37.0) / 2.0)
        hypoxia_risk = self._clamp01((96.0 - spo2) / 10.0)

        sepsis = (
            0.08
            + 0.22 * hr_risk
            + 0.25 * hypotension_risk
            + 0.20 * fever_risk
            + 0.15 * resp_risk
            + 0.10 * hypoxia_risk
        )
        ards = 0.05 + 0.45 * hypoxia_risk + 0.35 * resp_risk + 0.10 * hr_risk
        shock = 0.05 + 0.45 * hypotension_risk + 0.30 * hr_risk + 0.10 * hypoxia_risk

        return {
            "sepsis": min(sepsis, 0.95),
            "ards": min(ards, 0.95),
            "shock": min(shock, 0.95),
        }

    def predict(self, window_data):
        """
        window_data: list of dicts (시계열 데이터)
        반환값: demo 모드에서는 합성 Vitals 기반 비임상 위험 점수,
        model 모드에서는 로드된 모델의 출력값.
        """
        if self.mode == "demo":
            if not window_data:
                return {"sepsis": 0.0, "ards": 0.0, "shock": 0.0}
            return self._demo_scores(window_data[-1])

        # model 모드 추론
        import torch

        features = []
        for row in window_data:
            features.append(
                [
                    float(row.get("hr", 80)),
                    float(row.get("bpSys", 120)),
                    float(row.get("bpDia", 80)),
                    float(row.get("resp", 16)),
                    float(row.get("temp", 36.5)),
                    float(row.get("spo2", 98)),
                ]
            )

        x = torch.tensor([features], dtype=torch.float32).to(self.device)

        with torch.no_grad():
            probs = self.model(x)[0].tolist()

        return {
            "sepsis": probs[0],
            "ards": probs[1],
            "shock": probs[2],
        }
