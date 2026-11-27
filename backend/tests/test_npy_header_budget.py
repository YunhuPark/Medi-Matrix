"""Tiny synthetic headers; allocation/storage/network work must never run."""
import io
import sys
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from core.npy_budget import NpyHeaderError, validate_npy_budget


@pytest.fixture
def api():
    stubs = {name: MagicMock() for name in ('services.inference_service', 'services.mamba_service', 'api.mamba_inference') if name not in sys.modules}
    sys.modules.update(stubs)
    try:
        from api.router import router
        from core.auth import CurrentUser, get_current_user
        from core.rate_limit import process_mri_limiter
    finally:
        for name, stub in stubs.items():
            if sys.modules.get(name) is stub:
                sys.modules.pop(name)
    app = FastAPI()
    app.include_router(router, prefix='/api/v1')
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id='00000000-0000-4000-8000-000000000001')
    process_mri_limiter.history.clear()
    yield TestClient(app)
    process_mri_limiter.history.clear()


def header(shape, descr='<f8'):
    stream = io.BytesIO()
    np.lib.format.write_array_header_1_0(stream, {'descr': descr, 'fortran_order': False, 'shape': shape})
    return stream.getvalue()


@pytest.mark.parametrize('data', [header((100000, 100000, 100000)), header((2, 2, 2)), header((2, 2, 2), '|O')])
def test_bad_header_rejected_before_numpy_allocation(api, data):
    with patch.object(np, 'load', side_effect=AssertionError('allocation parser reached')) as load:
        response = api.post('/api/v1/process-mri', files={'file': ('synthetic.npy', data)})
    load.assert_not_called()
    assert response.status_code == 400


@pytest.mark.parametrize('version', [(1, 0), (2, 0), (3, 0)])
@pytest.mark.parametrize('fortran', [False, True])
@pytest.mark.parametrize('dtype', ['<f4', '>i2', '?'])
def test_valid_formats_orders_endianness_and_bool_preserved(version, fortran, dtype):
    array = np.arange(24).reshape(2, 3, 4).astype(dtype)
    if fortran:
        array = np.asfortranarray(array)
    stream = io.BytesIO()
    np.lib.format.write_array(stream, array, version=version, allow_pickle=False)
    data = stream.getvalue()
    with patch.object(np, 'load', side_effect=AssertionError('header validation must not load array')):
        validate_npy_budget(data)
    loaded = np.load(io.BytesIO(data), allow_pickle=False)
    np.testing.assert_array_equal(loaded, array)
    assert loaded.dtype == array.dtype


@pytest.mark.parametrize('data', [
    b'', b'not-numpy', b'\x93NUMPY\x04\x00\x00\x00',
    b'\x93NUMPY\x01\x00\xff\xff',
    header((0, 2, 2)), header((-1, 2, 2)), header((True, 2, 2)),
    header((2**62, 2**62, 2**62)), header((2, 2)),
    header((2, 2, 2), '<U1') + b'x'*32,
    header((2, 2, 2)) + b'x'*63,
])
def test_invalid_or_truncated_budget_rejected(data):
    with pytest.raises(NpyHeaderError):
        validate_npy_budget(data)


def v3(text):
    raw = text.encode('utf-8')
    return b'\x93NUMPY\x03\x00' + len(raw).to_bytes(4, 'little') + raw


@pytest.mark.parametrize('text', [
    '[]', "{'descr':'<f8','shape':(2,2,2)}",
    "{'descr':'<f8','shape':[2,2,2],'fortran_order':False}",
    "{'descr':'<f8','shape':(2,2,2),'fortran_order':'False'}",
    "{'descr':'<f8','shape':tuple([2,2,2]),'fortran_order':False}",
    "{'descr':('u1',(9223372036854775808,)),'shape':(1,1,1),'fortran_order':False}",
])
def test_v3_requires_literal_dictionary_shape_and_boolean(text):
    with pytest.raises(NpyHeaderError):
        validate_npy_budget(v3(text))


def test_large_header_rejected_before_header_parser():
    data = b'\x93NUMPY\x01\x00' + (10001).to_bytes(2, 'little') + b' '*10001
    with patch.object(np.lib.format, 'read_array_header_1_0', side_effect=AssertionError('unbounded parser reached')) as reader:
        with pytest.raises(NpyHeaderError):
            validate_npy_budget(data)
    reader.assert_not_called()


def test_first_array_behavior_with_trailing_data_retained():
    stream = io.BytesIO()
    np.save(stream, np.zeros((2,2,2), dtype=np.uint8))
    validate_npy_budget(stream.getvalue() + b'trailing bytes')
