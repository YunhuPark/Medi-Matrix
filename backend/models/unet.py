import torch
import torch.nn as nn
import torch.nn.functional as F

class DoubleConv3D(nn.Module):
    """(conv => BN => ReLU) * 2"""
    def __init__(self, in_channels, out_channels):
        super().__init__()
        self.double_conv = nn.Sequential(
            nn.Conv3d(in_channels, out_channels, kernel_size=3, padding=1),
            nn.BatchNorm3d(out_channels),
            nn.ReLU(inplace=True),
            nn.Conv3d(out_channels, out_channels, kernel_size=3, padding=1),
            nn.BatchNorm3d(out_channels),
            nn.ReLU(inplace=True)
        )

    def forward(self, x):
        return self.double_conv(x)

class UNet3D(nn.Module):
    """
    의료 영상(Brain MRI 등) 3D 분할을 위한 경량화 UNet3D 모델 아키텍처.
    면접 포트폴리오 시연용으로 파라미터 수를 줄여 빠른 추론이 가능하도록 설계되었습니다.
    """
    def __init__(self, in_channels=1, out_channels=1):
        super(UNet3D, self).__init__()
        
        # Encoder (Downsampling)
        self.inc = DoubleConv3D(in_channels, 16)
        self.down1 = nn.Sequential(nn.MaxPool3d(2), DoubleConv3D(16, 32))
        self.down2 = nn.Sequential(nn.MaxPool3d(2), DoubleConv3D(32, 64))
        
        # Decoder (Upsampling)
        self.up1 = nn.ConvTranspose3d(64, 32, kernel_size=2, stride=2)
        self.conv_up1 = DoubleConv3D(64, 32)
        
        self.up2 = nn.ConvTranspose3d(32, 16, kernel_size=2, stride=2)
        self.conv_up2 = DoubleConv3D(32, 16)
        
        # Final Output Layer
        self.outc = nn.Conv3d(16, out_channels, kernel_size=1)
        
    def forward(self, x):
        """
        x: [Batch_size, Channels, Depth, Height, Width]
        """
        # Encode
        x1 = self.inc(x)
        x2 = self.down1(x1)
        x3 = self.down2(x2)
        
        # Decode & Skip Connection
        u1 = self.up1(x3)
        # 3D 텐서 크기 맞춤 (패딩 처리)
        diffZ = x2.size()[2] - u1.size()[2]
        diffY = x2.size()[3] - u1.size()[3]
        diffX = x2.size()[4] - u1.size()[4]
        u1 = F.pad(u1, [diffX // 2, diffX - diffX // 2,
                        diffY // 2, diffY - diffY // 2,
                        diffZ // 2, diffZ - diffZ // 2])
        x_up1 = torch.cat([x2, u1], dim=1)
        c1 = self.conv_up1(x_up1)
        
        u2 = self.up2(c1)
        diffZ = x1.size()[2] - u2.size()[2]
        diffY = x1.size()[3] - u2.size()[3]
        diffX = x1.size()[4] - u2.size()[4]
        u2 = F.pad(u2, [diffX // 2, diffX - diffX // 2,
                        diffY // 2, diffY - diffY // 2,
                        diffZ // 2, diffZ - diffZ // 2])
        x_up2 = torch.cat([x1, u2], dim=1)
        c2 = self.conv_up2(x_up2)
        
        logits = self.outc(c2)
        return torch.sigmoid(logits)

# 모델 초기화 테스트 코드
if __name__ == "__main__":
    model = UNet3D()
    dummy_input = torch.randn(1, 1, 32, 32, 32)
    output = model(dummy_input)
    print(f"Input shape: {dummy_input.shape}")
    print(f"Output shape: {output.shape}")
    print("UNet3D Model Initialized Successfully!")
