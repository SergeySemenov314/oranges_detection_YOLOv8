import io
import base64
import numpy as np
import cv2
from pathlib import Path
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
from ultralytics import YOLO

app = FastAPI()

MODEL_PATH = Path("/app/model/best_v4_s.pt")
model = YOLO(str(MODEL_PATH))

CLASS_NAMES = {0: "Fresh Orange", 1: "Rotten Orange"}
IMGSZ = 1024
CONF = 0.20
AUGMENT = False


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": MODEL_PATH.name,
        "imgsz": IMGSZ,
        "conf": CONF,
        "augment": AUGMENT,
    }


@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        return JSONResponse(status_code=400, content={"error": "Cannot decode image"})

    h, w = img.shape[:2]

    results = model.predict(
        source=img,
        imgsz=IMGSZ,
        conf=CONF,
        iou=0.5,
        device="cpu",
        augment=AUGMENT,
        verbose=False,
    )
    result = results[0]

    annotated = result.plot()
    _, buffer = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 90])
    img_b64 = base64.b64encode(buffer).decode()

    fresh = rotten = 0
    boxes = result.boxes
    confs = []
    if boxes is not None and len(boxes) > 0:
        confs = boxes.conf.tolist()
        for c in boxes.cls.tolist():
            if int(c) == 0:
                fresh += 1
            else:
                rotten += 1

    n = fresh + rotten
    conf_range = f"{min(confs):.2f}..{max(confs):.2f}" if confs else "—"
    print(
        f"[detect] input={w}x{h} imgsz={IMGSZ} aug={AUGMENT} "
        f"found={n} (fresh={fresh}, rotten={rotten}) conf={conf_range}",
        flush=True,
    )

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
