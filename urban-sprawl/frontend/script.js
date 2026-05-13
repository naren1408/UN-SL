const API_BASE = window.location.origin.startsWith("http")
  ? window.location.origin
  : "http://localhost:8000";
const PROCESSING_MESSAGES = [
  "Preprocessing pixels…",
  "Extracting RGB features…",
  "Running K-Means clustering…",
  "Mapping cluster labels…",
  "Generating visualizations…",
];

const state = {
  mode: "single",
  files: {
    single: null,
    compare1: null,
    compare2: null,
  },
  dataset: {
    single: "",
    compare1: "",
    compare2: "",
  },
  downloads: {},
  processingTimer: null,
};

const uploadSection = document.getElementById("upload-section");
const resultsSection = document.getElementById("results-section");
const singleMode = document.getElementById("single-mode");
const compareMode = document.getElementById("compare-mode");
const comparisonPanel = document.getElementById("comparison-panel");
const runButton = document.getElementById("run-analysis");
const processingOverlay = document.getElementById("processing-overlay");
const processingText = document.getElementById("processing-text");
const overlayToggle = document.getElementById("overlay-toggle");
const overlayCard = document.getElementById("overlay-card");
const compareSlider = document.getElementById("compare-slider");
const sliderOverlayLayer = document.getElementById("slider-overlay-layer");
const sliderDivider = document.getElementById("slider-divider");
const sliderLabel = document.getElementById("slider-label");
const toastContainer = document.getElementById("toast-container");
const datasetSingleSelect = document.getElementById("dataset-single-select");
const datasetCompare1Select = document.getElementById("dataset-compare-1-select");
const datasetCompare2Select = document.getElementById("dataset-compare-2-select");

const imageEls = {
  original: document.getElementById("original-image"),
  segmented: document.getElementById("segmented-image"),
  overlay: document.getElementById("overlay-image"),
  sliderBase: document.getElementById("slider-base-image"),
  sliderTop: document.getElementById("slider-top-image"),
};

const metricEls = {
  urban: document.getElementById("urban-metric"),
  vegetation: document.getElementById("vegetation-metric"),
  roads: document.getElementById("roads-metric"),
  growth: document.getElementById("growth-metric"),
};

bootstrapDatasetSelectors();

document.querySelectorAll("[data-mode-target]").forEach((button) => {
  button.addEventListener("click", () => {
    setMode(button.dataset.modeTarget);
    uploadSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

document.querySelectorAll(".mode-tab").forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
});

document.querySelectorAll(".drop-zone").forEach((zone) => {
  const input = document.getElementById(zone.dataset.input);

  zone.addEventListener("click", () => input.click());
  input.addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) {
      handleFile(file, zone, input.id);
    }
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add("is-dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.remove("is-dragover");
    });
  });

  zone.addEventListener("drop", (event) => {
    const [file] = event.dataTransfer.files;
    if (file) {
      handleFile(file, zone, input.id);
    }
  });
});

runButton.addEventListener("click", async () => {
  try {
    if (state.mode === "single") {
      if (!state.files.single) {
        if (!state.dataset.single) {
          showToast("Upload or select a PNG, JPG, or TIF satellite image first.");
          return;
        }
      }
      await runSingleSegmentation();
      return;
    }

    if ((!state.files.compare1 && !state.dataset.compare1) || (!state.files.compare2 && !state.dataset.compare2)) {
      showToast("Upload or select both T1 and T2 satellite images first.");
      return;
    }
    if ((state.files.compare1 && state.dataset.compare2) || (state.dataset.compare1 && state.files.compare2)) {
      showToast("Use either two uploads or two dataset frames in compare mode.");
      return;
    }
    await runComparison();
  } catch (error) {
    showToast(error.message || "Analysis failed.");
  }
});

overlayToggle.addEventListener("change", () => {
  overlayCard.classList.toggle("overlay-hidden", !overlayToggle.checked);
});

compareSlider.addEventListener("input", (event) => {
  const value = Number(event.target.value);
  sliderOverlayLayer.style.clipPath = `inset(0 ${100 - value}% 0 0)`;
  sliderDivider.style.left = `${value}%`;
  sliderLabel.textContent = `T2 reveal: ${value}%`;
});

document.querySelectorAll("[data-download]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.download;
    const payload = state.downloads[key];
    if (!payload) {
      showToast("Nothing to download yet.");
      return;
    }
    downloadImage(payload.base64, payload.filename);
  });
});

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-tab").forEach((tab) => {
    tab.classList.toggle("mode-tab--active", tab.dataset.mode === mode);
  });
  singleMode.classList.toggle("hidden", mode !== "single");
  compareMode.classList.toggle("hidden", mode !== "compare");
  comparisonPanel.classList.toggle("hidden", mode !== "compare");
}

function handleFile(file, zone, inputId) {
  if (!isValidImage(file)) {
    showToast("Invalid file type. Please use PNG, JPG, or TIF.");
    return;
  }

  if (inputId === "single-file") {
    state.files.single = file;
    state.dataset.single = "";
  } else if (inputId === "compare-file-1") {
    state.files.compare1 = file;
    state.dataset.compare1 = "";
  } else if (inputId === "compare-file-2") {
    state.files.compare2 = file;
    state.dataset.compare2 = "";
  }

  const reader = new FileReader();
  reader.onload = () => {
    const preview = zone.querySelector(".drop-zone__preview");
    preview.src = reader.result;
    zone.classList.add("has-preview");
  };
  reader.readAsDataURL(file);
}

function isValidImage(file) {
  const allowedTypes = ["image/png", "image/jpeg", "image/tiff"];
  const lowerName = (file.name || "").toLowerCase();
  const allowedExtensions = [".png", ".jpg", ".jpeg", ".tif", ".tiff"];
  return allowedTypes.includes(file.type) || allowedExtensions.some((ext) => lowerName.endsWith(ext));
}

async function runSingleSegmentation() {
  showProcessing();
  try {
    const response = state.files.single
      ? await fetchUploadSegment()
      : await fetch(`${API_BASE}/segment-dataset?filename=${encodeURIComponent(state.dataset.single)}`);
    const data = await parseResponse(response);
    renderSingleResult(data);
  } finally {
    hideProcessing();
  }
}

async function runComparison() {
  showProcessing();
  try {
    const response = state.files.compare1 && state.files.compare2
      ? await fetchUploadComparison()
      : await fetch(
        `${API_BASE}/detect-change-dataset?file1=${encodeURIComponent(state.dataset.compare1)}&file2=${encodeURIComponent(state.dataset.compare2)}`
      );
    const data = await parseResponse(response);
    renderComparisonResult(data);
  } finally {
    hideProcessing();
  }
}

async function fetchUploadSegment() {
  const formData = new FormData();
  formData.append("file", state.files.single);
  return fetch(`${API_BASE}/segment`, {
    method: "POST",
    body: formData,
  });
}

async function fetchUploadComparison() {
  const formData = new FormData();
  const source1 = state.files.compare1;
  const source2 = state.files.compare2;
  formData.append("file1", source1);
  formData.append("file2", source2);
  return fetch(`${API_BASE}/detect-change`, {
    method: "POST",
    body: formData,
  });
}

async function parseResponse(response) {
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error("Backend response was not valid JSON.");
  }
  if (!response.ok) {
    throw new Error(data.detail || "Request failed.");
  }
  return data;
}

function renderSingleResult(data) {
  resultsSection.classList.remove("hidden");
  comparisonPanel.classList.add("hidden");
  imageEls.original.src = toDataUri(data.original_image);
  imageEls.segmented.src = toDataUri(data.segmented_image);
  imageEls.overlay.src = toDataUri(data.overlay_image);

  state.downloads = {
    original: { base64: data.original_image, filename: "original-image.png" },
    segmented: { base64: data.segmented_image, filename: "segmented-map.png" },
    overlay: { base64: data.overlay_image, filename: "overlay-view.png" },
  };

  animateMetrics(data.statistics);
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderComparisonResult(data) {
  resultsSection.classList.remove("hidden");
  comparisonPanel.classList.remove("hidden");

  imageEls.original.src = toDataUri(data.t2.original_image);
  imageEls.segmented.src = toDataUri(data.t2.segmented_image);
  imageEls.overlay.src = toDataUri(data.t2.overlay_image);
  imageEls.sliderBase.src = toDataUri(data.t1.overlay_image);
  imageEls.sliderTop.src = toDataUri(data.t2.overlay_image);

  state.downloads = {
    original: { base64: data.t2.original_image, filename: "t2-original-image.png" },
    segmented: { base64: data.t2.segmented_image, filename: "t2-segmented-map.png" },
    overlay: { base64: data.t2.overlay_image, filename: "t2-overlay-view.png" },
    "change-mask": { base64: data.change_mask, filename: "urban-growth-mask.png" },
  };

  animateMetrics(data.t2.statistics);
  animateGrowthMetric(data.growth_pct);
  drawHeatmap(data.change_points, data.change_mask);

  compareSlider.value = "50";
  compareSlider.dispatchEvent(new Event("input"));
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function animateMetrics(statistics) {
  countUp(metricEls.urban, statistics.urban_pct);
  countUp(metricEls.vegetation, statistics.vegetation_pct);
  countUp(metricEls.roads, statistics.roads_pct);
}

function animateGrowthMetric(value) {
  const formatted = value >= 0 ? `+${value.toFixed(1)}%` : `${value.toFixed(1)}%`;
  metricEls.growth.textContent = "0.0%";
  countUp(metricEls.growth, Math.abs(value), 1500, value < 0 ? "-" : "+");
  setTimeout(() => {
    metricEls.growth.textContent = formatted;
  }, 1550);
}

function countUp(element, target, duration = 1500, prefix = "") {
  clearInterval(element._countTimer);
  let current = 0;
  const step = target / Math.max(duration / 16, 1);

  element._countTimer = setInterval(() => {
    current += step;
    const value = Math.min(current, target);
    element.textContent = `${prefix}${value.toFixed(1)}%`;
    if (current >= target) {
      clearInterval(element._countTimer);
    }
  }, 16);
}

function drawHeatmap(points, maskBase64) {
  const canvas = document.getElementById("heatmap-canvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const image = new Image();
  image.onload = () => {
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(10, 15, 26, 0.62)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    points.forEach(([x, y], index) => {
      const radius = 14 + (index % 5) * 4;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, "rgba(216, 90, 48, 0.7)");
      gradient.addColorStop(0.55, "rgba(216, 90, 48, 0.22)");
      gradient.addColorStop(1, "rgba(216, 90, 48, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    });

    if (!points.length) {
      ctx.fillStyle = "rgba(237, 244, 255, 0.78)";
      ctx.font = "16px Space Mono";
      ctx.textAlign = "center";
      ctx.fillText("No new urban expansion detected", canvas.width / 2, canvas.height / 2);
    }
  };
  image.src = toDataUri(maskBase64);
}

function showProcessing() {
  let index = 0;
  processingText.textContent = PROCESSING_MESSAGES[index];
  processingOverlay.classList.remove("hidden");
  clearInterval(state.processingTimer);
  state.processingTimer = setInterval(() => {
    index = (index + 1) % PROCESSING_MESSAGES.length;
    processingText.textContent = PROCESSING_MESSAGES[index];
  }, 1200);
}

function hideProcessing() {
  clearInterval(state.processingTimer);
  processingOverlay.classList.add("hidden");
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<p>${message}</p>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

function toDataUri(base64) {
  return `data:image/png;base64,${base64}`;
}

function downloadImage(base64, filename) {
  const link = document.createElement("a");
  link.href = toDataUri(base64);
  link.download = filename;
  link.click();
}

async function bootstrapDatasetSelectors() {
  try {
    const response = await fetch(`${API_BASE}/dataset/files?limit=500`);
    const data = await parseResponse(response);
    fillSelect(datasetSingleSelect, data.files);
    fillSelect(datasetCompare1Select, data.files);
    fillSelect(datasetCompare2Select, data.files);

    datasetSingleSelect.addEventListener("change", () => {
      state.dataset.single = datasetSingleSelect.value;
    });
    datasetCompare1Select.addEventListener("change", () => {
      state.dataset.compare1 = datasetCompare1Select.value;
    });
    datasetCompare2Select.addEventListener("change", () => {
      state.dataset.compare2 = datasetCompare2Select.value;
    });

    state.dataset.single = datasetSingleSelect.value;
    state.dataset.compare1 = datasetCompare1Select.value;
    state.dataset.compare2 = datasetCompare2Select.value;

    document.getElementById("dataset-single-preview").addEventListener("click", () => {
      previewDatasetImage(datasetSingleSelect.value, document.querySelector('[data-input="single-file"]'), "single");
    });
    document.getElementById("dataset-compare-1-preview").addEventListener("click", () => {
      previewDatasetImage(datasetCompare1Select.value, document.querySelector('[data-input="compare-file-1"]'), "compare1");
    });
    document.getElementById("dataset-compare-2-preview").addEventListener("click", () => {
      previewDatasetImage(datasetCompare2Select.value, document.querySelector('[data-input="compare-file-2"]'), "compare2");
    });
  } catch (error) {
    showToast(error.message || "Dataset folder could not be loaded.");
  }
}

function fillSelect(select, files) {
  select.innerHTML = files.map((file) => `<option value="${file}">${file}</option>`).join("");
}

async function previewDatasetImage(filename, zone, target) {
  try {
    const response = await fetch(`${API_BASE}/dataset/image/${encodeURIComponent(filename)}`);
    const data = await parseResponse(response);
    const preview = zone.querySelector(".drop-zone__preview");
    preview.src = toDataUri(data.image);
    zone.classList.add("has-preview");

    if (target === "single") {
      state.dataset.single = filename;
      state.files.single = null;
    } else if (target === "compare1") {
      state.dataset.compare1 = filename;
      state.files.compare1 = null;
    } else if (target === "compare2") {
      state.dataset.compare2 = filename;
      state.files.compare2 = null;
    }
  } catch (error) {
    showToast(error.message || "Dataset preview failed.");
  }
}

setMode("single");

window.addEventListener("unhandledrejection", (event) => {
  const message = String(event.reason?.message || event.reason || "");
  if (message.includes("Failed to fetch")) {
    event.preventDefault();
    showToast("Backend is offline. Start `start_backend.bat` and open http://localhost:8000.");
  }
});
