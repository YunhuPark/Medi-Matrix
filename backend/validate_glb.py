import numpy as np
from skimage import measure
import trimesh
import tempfile, os

# 테스트 마스크 생성
size = 64
x, y, z = np.mgrid[-1:1:64j, -1:1:64j, -1:1:64j]
mask = (np.sqrt(x**2 + y**2 + z**2) <= 0.5).astype(np.float32)

# marching cubes
verts, faces, normals, values = measure.marching_cubes(mask, level=0.5)
print(f'Vertices: {verts.shape}, Faces: {faces.shape}')
print(f'Verts range X: [{verts[:,0].min():.1f}, {verts[:,0].max():.1f}]')
print(f'Verts range Y: [{verts[:,1].min():.1f}, {verts[:,1].max():.1f}]')
print(f'Verts range Z: [{verts[:,2].min():.1f}, {verts[:,2].max():.1f}]')

# trimesh
mesh = trimesh.Trimesh(vertices=verts, faces=faces, vertex_normals=normals)
print(f'Trimesh valid: {mesh.is_volume}')
print(f'Trimesh bounds: {mesh.bounds}')

# GLB export
path = os.path.join(tempfile.gettempdir(), 'test_check.glb')
mesh.export(path, file_type='glb')
filesize = os.path.getsize(path)
print(f'GLB file size: {filesize} bytes')

# GLB 검증 - 다시 로드
loaded = trimesh.load(path)
print(f'Loaded type: {type(loaded)}')
if hasattr(loaded, 'geometry'):
    for name, geom in loaded.geometry.items():
        print(f'  Geometry "{name}": {geom.vertices.shape[0]} verts, {geom.faces.shape[0]} faces')
elif hasattr(loaded, 'vertices'):
    print(f'  Direct mesh: {loaded.vertices.shape[0]} verts, {loaded.faces.shape[0]} faces')
