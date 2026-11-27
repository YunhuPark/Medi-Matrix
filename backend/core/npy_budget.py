"""Validate NPY allocation metadata before invoking the array loader."""
import ast
import io
import math

import numpy as np

MAX_NPY_HEADER_BYTES = 10_000


class NpyHeaderError(ValueError):
    """Only fixed, non-sensitive messages are returned to API callers."""


def validate_npy_budget(contents: bytes) -> None:
    invalid = 'Invalid NumPy medical data.'
    if len(contents) < 10 or contents[:6] != b'\x93NUMPY':
        raise NpyHeaderError(invalid)
    version = tuple(contents[6:8])
    if version not in {(1, 0), (2, 0), (3, 0)}:
        raise NpyHeaderError(invalid)
    width = 2 if version == (1, 0) else 4
    start = 8 + width
    header_size = int.from_bytes(contents[8:start], 'little')
    end = start + header_size
    if not 0 < header_size <= MAX_NPY_HEADER_BYTES or end > len(contents):
        raise NpyHeaderError(invalid)
    try:
        # Only copy the bounded header, not a second full upload buffer.
        if version == (3, 0):
            header = ast.literal_eval(contents[start:end].decode('utf-8').strip())
            if not isinstance(header, dict) or set(header) != {'descr', 'shape', 'fortran_order'}:
                raise ValueError
            if type(header['fortran_order']) is not bool:
                raise ValueError
            shape = header['shape']
            dtype = np.lib.format.descr_to_dtype(header['descr'])
        else:
            reader = np.lib.format.read_array_header_1_0 if width == 2 else np.lib.format.read_array_header_2_0
            shape, _, dtype = reader(io.BytesIO(contents[8:end]), max_header_size=MAX_NPY_HEADER_BYTES)
    except (ValueError, TypeError, SyntaxError, UnicodeError, EOFError, RecursionError):
        raise NpyHeaderError(invalid) from None
    if dtype.hasobject:
        raise NpyHeaderError(invalid)
    if not isinstance(shape, tuple) or len(shape) != 3:
        raise NpyHeaderError('Medical array must be three-dimensional.')
    if any(type(size) is not int or size <= 0 for size in shape):
        raise NpyHeaderError(invalid)
    if not (np.issubdtype(dtype, np.number) or np.issubdtype(dtype, np.bool_)):
        raise NpyHeaderError('Medical array dtype is not supported.')
    count = math.prod(shape)
    if count > 256 ** 3:
        raise NpyHeaderError('Medical array dimensions exceed the allowed limit.')
    if dtype.itemsize <= 0 or count * dtype.itemsize > len(contents) - end:
        raise NpyHeaderError(invalid)
