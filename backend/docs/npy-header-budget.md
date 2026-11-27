# NPY allocation budget

The medical upload route validates NPY metadata before `np.load` can allocate
from its shape. Headers are capped at10000bytes. Formats1.0/2.0 use public NumPy
header readers on a bounded header-only buffer;3.0 uses bounded UTF-8 literal
dictionary parsing per the public NPY specification. No private NumPy API,
pickle loading, temporary service or new dependency is introduced.

The header must describe a positive3D numeric/bool array with at most256³
elements and enough actual payload bytes for `shape product * dtype.itemsize`.
Integer arithmetic does not wrap. Object/non-numeric types and malformed or
truncated files fail with fixed400 messages before the full array loader.
Existing finite-value, per-file/raw-request, auth and rate checks still apply.
Normal C/Fortran order, endian, bool and numeric files retain their loading
behavior, including the first array when trailing bytes exist.

This bounds declared allocation against actual already-bounded upload bytes.
It does not provide a global concurrency/mesh-memory/clinical-validity guarantee.
Tests use tiny headers and allocation spies; they do not allocate giant arrays
or send medical data to a live service.
