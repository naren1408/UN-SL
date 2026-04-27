import io

import numpy as np
from PIL import Image, UnidentifiedImageError


ALLOWED_FORMATS = {"PNG", "JPEG", "JPG", "TIFF", "TIF"}
IMAGE_SIZE = (256, 256)


def preprocess(file_bytes) -> np.ndarray:
    try:
        image = Image.open(file_bytes)
    except UnidentifiedImageError as exc:
        raise ValueError("Unsupported or corrupted image file.") from exc

    image_format = (image.format or "").upper()
    if image_format not in ALLOWED_FORMATS:
        raise ValueError("Only PNG, JPG, and TIF images are supported.")

    image = image.convert("RGB")
    image = image.resize(IMAGE_SIZE, Image.LANCZOS)
    return np.array(image, dtype=np.uint8)


def read_upload_bytes(contents: bytes) -> io.BytesIO:
    if not contents:
        raise ValueError("Uploaded file is empty.")
    return io.BytesIO(contents)
