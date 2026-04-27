import numpy as np
import cv2
from sklearn.cluster import KMeans


CLUSTER_COLORS = {
    "urban": np.array([216, 90, 48], dtype=np.uint8),
    "vegetation": np.array([29, 158, 117], dtype=np.uint8),
    "roads": np.array([136, 135, 128], dtype=np.uint8),
}

ROLE_ORDER = ("urban", "vegetation", "roads")


def _assign_roles(centers: np.ndarray) -> dict:
    remaining = set(range(len(centers)))

    green_scores = centers[:, 1] - (centers[:, 0] + centers[:, 2]) / 2.0
    vegetation_idx = int(np.argmax(green_scores))
    remaining.remove(vegetation_idx)

    saturation_scores = centers.max(axis=1) - centers.min(axis=1)
    remaining_list = list(remaining)
    roads_idx = min(remaining_list, key=lambda idx: saturation_scores[idx])
    remaining.remove(roads_idx)

    urban_idx = remaining.pop()

    return {
        urban_idx: "urban",
        vegetation_idx: "vegetation",
        roads_idx: "roads",
    }


def _stats_from_roles(labels: np.ndarray, label_to_role: dict) -> dict:
    total = labels.size
    stats = {}
    for role in ROLE_ORDER:
        cluster_ids = [idx for idx, mapped_role in label_to_role.items() if mapped_role == role]
        count = sum(int((labels == cluster_id).sum()) for cluster_id in cluster_ids)
        stats[f"{role}_pct"] = round((count / total) * 100, 2)
    return stats


def _colorize(labels: np.ndarray, label_to_role: dict, shape: tuple[int, int]) -> np.ndarray:
    flat_colors = np.array(
        [CLUSTER_COLORS[label_to_role[label]] for label in labels],
        dtype=np.uint8,
    )
    return flat_colors.reshape(shape[0], shape[1], 3)


def _urban_mask(labels: np.ndarray, label_to_role: dict, shape: tuple[int, int]) -> np.ndarray:
    mask = np.array(
        [255 if label_to_role[label] == "urban" else 0 for label in labels],
        dtype=np.uint8,
    )
    return mask.reshape(shape)


def _sample_change_points(mask: np.ndarray, limit: int = 180) -> list[list[int]]:
    coords = np.argwhere(mask > 0)
    if coords.size == 0:
        return []

    if len(coords) > limit:
        step = max(len(coords) // limit, 1)
        coords = coords[::step][:limit]

    return [[int(col), int(row)] for row, col in coords]


def segment(img_array: np.ndarray, n_clusters: int = 3):
    height, width = img_array.shape[:2]
    pixels = img_array.reshape(-1, 3).astype(np.float32)

    kmeans = KMeans(
        n_clusters=n_clusters,
        random_state=42,
        n_init=10,
        max_iter=300,
    )
    labels = kmeans.fit_predict(pixels)
    label_to_role = _assign_roles(kmeans.cluster_centers_)

    segmented = _colorize(labels, label_to_role, (height, width))
    overlay = cv2.addWeighted(img_array, 0.58, segmented, 0.42, 0)
    urban_mask = _urban_mask(labels, label_to_role, (height, width))
    stats = _stats_from_roles(labels, label_to_role)

    return {
        "segmented": segmented,
        "overlay": overlay,
        "urban_mask": urban_mask,
        "urban_pct": stats["urban_pct"],
        "vegetation_pct": stats["vegetation_pct"],
        "roads_pct": stats["roads_pct"],
    }


def detect_change_data(t1_img: np.ndarray, t2_img: np.ndarray) -> dict:
    t1_result = segment(t1_img)
    t2_result = segment(t2_img)

    urban_gain_mask = np.where(
        (t1_result["urban_mask"] == 0) & (t2_result["urban_mask"] == 255),
        255,
        0,
    ).astype(np.uint8)

    growth_pct = round(t2_result["urban_pct"] - t1_result["urban_pct"], 2)
    change_points = _sample_change_points(urban_gain_mask)

    return {
        "t1": t1_result,
        "t2": t2_result,
        "growth_pct": growth_pct,
        "change_mask": urban_gain_mask,
        "change_points": change_points,
    }
