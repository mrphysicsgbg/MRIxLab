"""Check every converted map voxel against the original MRiLab MATLAB object."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.io import loadmat


def validate(source, directory):
    metadata = json.loads((directory / "phantom.json").read_text())
    assert metadata["sourceSha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
    obj = loadmat(source, simplify_cells=True)["VObj"]
    shape = (metadata["slices"], metadata["height"], metadata["width"])
    binary = (directory / metadata["file"]).read_bytes()
    if metadata.get("compression") == "gzip":
        binary = gzip.decompress(binary)
    count = int(np.prod(shape))
    assert len(binary) == count * 4 * 4
    for name in ("Rho", "T1", "T2", "T2Star"):
        converted = np.frombuffer(binary, dtype="<f4", count=count,
                                  offset=metadata["maps"][name]["byteOffset"]).reshape(shape)
        expected = obj[name].transpose(2, 0, 1)
        np.testing.assert_array_equal(converted, expected.astype("<f4"))
        error = float(np.max(np.abs(converted - expected)))
        print(f"{name}: every voxel matches Float32 conversion; maximum error {error:.3g}")
    print(f"Validated {count:,} voxels per map, seconds unchanged, source axes preserved.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--data", type=Path, default=Path(__file__).resolve().parents[1] / "data/brain-high-resolution")
    args = parser.parse_args()
    validate(args.source, args.data)
