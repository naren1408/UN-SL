# Urban Sprawl Monitoring System

A full-stack satellite image segmentation web app with an anti-gravity mission-control aesthetic, powered by FastAPI and pure K-Means clustering.

Supported uploads: `.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`

## Structure

```text
urban-sprawl/
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── script.js
├── backend/
│   ├── main.py
│   ├── model.py
│   └── utils.py
└── requirements.txt
```

## Install

```bash
python -m pip install -r requirements.txt
```

## Run Backend

```bash
python -m uvicorn backend.main:app --port 8000
```

Or on Windows, run `start_backend.bat` from the project folder.

## Open Frontend

Open [http://localhost:8000](http://localhost:8000) in any browser after starting the backend.

No build step. No Node.js. No webpack.
