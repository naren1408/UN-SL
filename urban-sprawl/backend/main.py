import base64
import io
from pathlib import Path
from urllib.parse import unquote

import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image

from backend.model import detect_change_data, segment
from backend.utils import preprocess, read_upload_bytes


app = FastAPI(title="Urban Sprawl API")
BASE_DIR = Path(__file__).resolve().parents[1]
FRONTEND_DIR = BASE_DIR / "frontend"
DATASET_DIR = BASE_DIR.parent / "archive (1)" / "patches" / "Images"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def encode_image(arr: np.ndarray) -> str:
    img = Image.fromarray(arr.astype(np.uint8))
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def validate_upload(upload: UploadFile) -> None:
    filename = (upload.filename or "").lower()
    if not filename.endswith((".png", ".jpg", ".jpeg", ".tif", ".tiff")):
        raise HTTPException(status_code=400, detail="Only PNG, JPG, and TIF images are supported.")


@app.get("/")
async def index():
    try:
        return FileResponse(FRONTEND_DIR / "index.html")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load frontend: {exc}") from exc


@app.get("/styles.css")
async def styles():
    try:
        return FileResponse(FRONTEND_DIR / "styles.css", media_type="text/css")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load stylesheet: {exc}") from exc


@app.get("/script.js")
async def script():
    try:
        return FileResponse(FRONTEND_DIR / "script.js", media_type="application/javascript")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load script: {exc}") from exc


@app.get("/api/health")
async def healthcheck():
    return {"status": "ok", "service": "Urban Sprawl API"}


def dataset_files() -> list[Path]:
    if not DATASET_DIR.exists():
        raise HTTPException(status_code=404, detail=f"Dataset folder not found: {DATASET_DIR}")
    return sorted(
        [
            path for path in DATASET_DIR.iterdir()
            if path.is_file() and path.suffix.lower() in {".tif", ".tiff", ".png", ".jpg", ".jpeg"}
        ],
        key=lambda path: path.name.lower(),
    )


def resolve_dataset_image(filename: str) -> Path:
    decoded = unquote(filename)
    path = DATASET_DIR / decoded
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail=f"Dataset image not found: {decoded}")
    if path.suffix.lower() not in {".tif", ".tiff", ".png", ".jpg", ".jpeg"}:
        raise HTTPException(status_code=400, detail="Unsupported dataset image format.")
    return path


def load_dataset_image(filename: str) -> np.ndarray:
    path = resolve_dataset_image(filename)
    with path.open("rb") as handle:
        return preprocess(handle)


def build_segment_payload(image: np.ndarray, result: dict) -> dict:
    return {
        "segmented_image": encode_image(result["segmented"]),
        "overlay_image": encode_image(result["overlay"]),
        "original_image": encode_image(image),
        "statistics": {
            "urban_pct": result["urban_pct"],
            "vegetation_pct": result["vegetation_pct"],
            "roads_pct": result["roads_pct"],
        },
    }


@app.get("/dataset/files")
async def list_dataset_files(limit: int = Query(default=200, ge=1, le=2000)):
    try:
        files = dataset_files()
        payload = [path.name for path in files[:limit]]
        return {"files": payload, "total": len(files)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read dataset folder: {exc}") from exc


@app.get("/dataset/image/{filename:path}")
async def dataset_image_preview(filename: str):
    try:
        image = load_dataset_image(filename)
        return JSONResponse({"filename": filename, "image": encode_image(image)})
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load dataset image: {exc}") from exc


@app.post("/segment")
async def segment_image(file: UploadFile = File(...)):
    try:
        validate_upload(file)
        contents = await file.read()
        image = preprocess(read_upload_bytes(contents))
        result = segment(image)

        return JSONResponse(build_segment_payload(image, result))
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Segmentation failed: {exc}") from exc


@app.get("/segment-dataset")
async def segment_dataset(filename: str = Query(...)):
    try:
        image = load_dataset_image(filename)
        result = segment(image)
        payload = build_segment_payload(image, result)
        payload["filename"] = filename
        return JSONResponse(payload)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Dataset segmentation failed: {exc}") from exc


@app.post("/detect-change")
async def detect_change(
    file1: UploadFile = File(...),
    file2: UploadFile = File(...),
):
    try:
        validate_upload(file1)
        validate_upload(file2)

        image1 = preprocess(read_upload_bytes(await file1.read()))
        image2 = preprocess(read_upload_bytes(await file2.read()))
        result = detect_change_data(image1, image2)

        return JSONResponse(
            {
                "t1": build_segment_payload(image1, result["t1"]),
                "t2": build_segment_payload(image2, result["t2"]),
                "growth_pct": result["growth_pct"],
                "t1_urban_pct": result["t1"]["urban_pct"],
                "t2_urban_pct": result["t2"]["urban_pct"],
                "change_mask": encode_image(result["change_mask"]),
                "change_points": result["change_points"],
            }
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Change detection failed: {exc}") from exc


@app.get("/detect-change-dataset")
async def detect_change_dataset(
    file1: str = Query(...),
    file2: str = Query(...),
):
    try:
        image1 = load_dataset_image(file1)
        image2 = load_dataset_image(file2)
        result = detect_change_data(image1, image2)

        return JSONResponse(
            {
                "t1": build_segment_payload(image1, result["t1"]),
                "t2": build_segment_payload(image2, result["t2"]),
                "growth_pct": result["growth_pct"],
                "t1_urban_pct": result["t1"]["urban_pct"],
                "t2_urban_pct": result["t2"]["urban_pct"],
                "change_mask": encode_image(result["change_mask"]),
                "change_points": result["change_points"],
                "t1_filename": file1,
                "t2_filename": file2,
            }
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Change detection failed: {exc}") from exc
