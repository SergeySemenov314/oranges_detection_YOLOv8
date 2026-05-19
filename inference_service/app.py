import io
import base64
import numpy as np
import cv2
from pathlib import Path
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
from ultralytics import YOLO

app = FastAPI()

MODEL_PATH = Path("/app/model/best_v2_s.pt")
model = YOLO(str(MODEL_PATH))

CLASS_NAMES = {0: "Fresh Orange", 1: "Rotten Orange"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        return JSONResponse(status_code=400, content={"error": "Cannot decode image"})

    results = model.predict(
        source=img,
        imgsz=640,
        conf=0.25,
        iou=0.5,
        device="cpu",
        verbose=False,
    )
    result = results[0]

    annotated = result.plot()
    _, buffer = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 90])
    img_b64 = base64.b64encode(buffer).decode()

    fresh = rotten = 0
    boxes = result.boxes
    if boxes is not None and len(boxes) > 0:
        for c in boxes.cls.tolist():
            if int(c) == 0:
                fresh += 1
            else:
                rotten += 1

    total = fresh + rotten
    rotten_pct = round(rotten / total * 100, 1) if total > 0 else 0.0

    return {
        "annotated_image": img_b64,
        "stats": {
            "total": total,
            "fresh": fresh,
            "rotten": rotten,
            "rotten_percent": rotten_pct,
        },
    }
