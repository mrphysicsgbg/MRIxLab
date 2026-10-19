"""Development-only conversion; NumPy is never needed by the application."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np

MAPS = ("Rho", "T1", "T2", "T2Star")
SOURCE = "https://raw.githubusercontent.com/JonathanArvidsson/EEN200/main/numPhantom/BrainStandardResolution.npz"
MRILAB_SOURCE = "https://raw.githubusercontent.com/leoliuf/MRiLab/42b7c48dcb1d49893328d53df6b4c0751fdbcec3/Resources/VObj/BrainHighResolution.mat"


def convert(source, destination, compressed=False, source_url=None):
    extra = {}
    if source.suffix.lower() == ".mat":
        # SciPy is a development dependency only; MATLAB maps already use seconds.
        from scipy.io import loadmat
        obj = loadmat(source, simplify_cells=True)["VObj"]
        if obj["TypeNum"] != 1:
            raise ValueError("Only single-component MRiLab objects are supported")
        phantom = {name: obj[name] for name in MAPS}
        expected_shape = (obj["YDim"], obj["XDim"], obj["ZDim"])
        if phantom["Rho"].shape != expected_shape:
            raise ValueError("MRiLab dimensions do not match the maps")
        extra["voxelSpacingMeters"] = [obj["YDimRes"], obj["XDimRes"], obj["ZDimRes"]]
        source_url = source_url or MRILAB_SOURCE
    else:
        with np.load(source) as archive:
            phantom = {name: archive[name] for name in MAPS}
        source_url = source_url or SOURCE
    shape = phantom["Rho"].shape
    if len(shape) != 3:
        raise ValueError("Expected a three-dimensional phantom")
    for name in MAPS:
        if phantom[name].shape != shape or not np.isfinite(phantom[name]).all():
            raise ValueError(f"Invalid {name} map")
    destination.mkdir(parents=True, exist_ok=True)
    offsets = {}
    filename = "phantom.bin.gz" if compressed else "phantom.bin"
    with (destination / filename).open("wb") as raw:
        # Empty filename and fixed mtime make the compressed asset reproducible.
        output = gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) if compressed else raw
        for name in MAPS:
            # Original [row, column, slice] -> contiguous [slice, row, column].
            # imshow uses origin='upper': row 0 remains the top canvas row.
            data = np.ascontiguousarray(phantom[name].transpose(2, 0, 1), dtype="<f4")
            offsets[name] = {"byteOffset": output.tell()}
            output.write(data.tobytes())
        if compressed:
            output.close()
    metadata = {
        "version": 1, "file": filename, "dtype": "float32-le",
        "layout": "slice-row-column", "width": shape[1], "height": shape[0],
        "slices": shape[2], "sourceShape": list(shape), "sourceAxes": ["row", "column", "slice"],
        "displayOrigin": "upper", "units": "seconds", "maps": offsets,
        "source": source_url, "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        **extra,
    }
    if compressed:
        metadata["compression"] = "gzip"
    (destination / "phantom.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"Converted {shape}: {(destination / filename).stat().st_size:,} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "data")
    parser.add_argument("--gzip", action="store_true", help="Write a gzip-compressed binary")
    parser.add_argument("--source-url", help="Override the source URL recorded in metadata")
    args = parser.parse_args()
    convert(args.source, args.output, args.gzip, args.source_url)
