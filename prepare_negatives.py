"""
Подготовка негативных примеров (фото без апельсинов) для дообучения YOLOv8.

Скрипт НЕ трогает локальный dataset/. Он только готовит папку с уже
отресайзенными фото, которую потом нужно догрузить в train/images/
датасета на Kaggle (БЕЗ соответствующих .txt файлов в train/labels/).

Три режима:

  1) `scrape`   — скачать фото из DuckDuckGo Images по набору поисковых
                  запросов («apples on table», «orange traffic cone» и т.п.),
                  сразу отресайзить до 640px и сохранить.
                  Зависимости: pip install ddgs requests

  2) `mine`     — hard negative mining: прогнать текущую модель по папке
                  заведомо «пустых» фото и сохранить только те, на которых
                  модель ошиблась (нашла апельсин с conf >= threshold).
                  Это самые ценные негативы. На выходе — папка с фото,
                  уже отресайзенными до 640px.

  3) `prepare`  — просто отресайзить папку с фото до 640px по длинной
                  стороне, без фильтрации моделью.

Файлы на выходе называются с префиксом `neg_` — так их легко найти
в train/images на Kaggle, если потребуется удалить.

Типовой пайплайн:
  python prepare_negatives.py scrape --out candidates --per-query 30
  python prepare_negatives.py mine --src candidates --out negatives_for_kaggle
"""

import argparse
import hashlib
import re
from pathlib import Path

import cv2
import numpy as np

IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
MAX_SIDE = 640  # как в исходном датасете
NEG_PREFIX = "neg_"

# Поисковые запросы для сбора негативов. Подобраны так, чтобы покрыть случаи,
# на которых YOLO чаще всего ложно срабатывает: другие круглые/оранжевые фрукты,
# оранжевые предметы, кухонные сцены без апельсинов.
DEFAULT_QUERIES = [
    # Другие круглые фрукты — самая частая причина FP
    "red apples on table",
    "green apples close up",
    "mandarins pile",
    "tangerines on plate",
    "grapefruit halves",
    "lemons in bowl",
    "peaches close up",
    "persimmon fruit",
    "tomatoes on table",
    "pomegranates",
    # Оранжевые предметы — модель цепляется за цвет
    "orange traffic cone street",
    "basketball on floor",
    "orange balloon",
    "pumpkin on porch",
    "carrot bunch",
    # Пустые/нейтральные сцены
    "empty wooden kitchen table",
    "empty white plate top view",
    "kitchen counter no food",
    "fruit bowl with grapes and bananas",
    "supermarket vegetable aisle",
]


def iter_images(folder: Path):
    for p in folder.rglob("*"):
        if p.is_file() and p.suffix.lower() in IMG_EXTS:
            yield p


def resize_to_max_side(img, max_side: int = MAX_SIDE):
    h, w = img.shape[:2]
    longest = max(h, w)
    if longest <= max_side:
        return img
    scale = max_side / longest
    new_w, new_h = int(round(w * scale)), int(round(h * scale))
    return cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)


def unique_path(folder: Path, stem: str, ext: str = ".jpg") -> Path:
    out = folder / f"{stem}{ext}"
    i = 1
    while out.exists():
        out = folder / f"{stem}_{i}{ext}"
        i += 1
    return out


def slugify(q: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", q.lower()).strip("_")[:40]


def cmd_scrape(args):
    try:
        from ddgs import DDGS
    except ImportError:
        try:
            from duckduckgo_search import DDGS  # старое имя пакета
        except ImportError:
            raise SystemExit(
                "Нужны пакеты. Установите:\n"
                "  pip install ddgs requests"
            )
    try:
        import requests
    except ImportError:
        raise SystemExit("pip install requests")

    queries = args.queries if args.queries else DEFAULT_QUERIES
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
        )
    })

    seen_hashes: set[str] = set()
    # подхватим хэши уже скачанного, чтобы повторный запуск не дублировал
    for existing in iter_images(out):
        img = cv2.imread(str(existing))
        if img is not None:
            seen_hashes.add(hashlib.md5(img.tobytes()).hexdigest())

    saved = duplicates = failed = 0

    for q in queries:
        print(f"\n[{q}]")
        slug = slugify(q)
        try:
            with DDGS() as ddgs:
                results = list(ddgs.images(q, max_results=args.per_query))
        except Exception as e:
            print(f"  search failed: {e}")
            continue

        for r in results:
            url = r.get("image") or r.get("url")
            if not url:
                continue
            try:
                resp = session.get(url, timeout=10)
                resp.raise_for_status()
            except Exception:
                failed += 1
                continue

            nparr = np.frombuffer(resp.content, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                failed += 1
                continue

            img = resize_to_max_side(img)

            digest = hashlib.md5(img.tobytes()).hexdigest()
            if digest in seen_hashes:
                duplicates += 1
                continue
            seen_hashes.add(digest)

            stem = f"{NEG_PREFIX}{slug}_{digest[:8]}"
            out_path = unique_path(out, stem)
            cv2.imwrite(str(out_path), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
            saved += 1

        print(f"  saved so far: {saved}")

    print()
    print(f"Сохранено:   {saved}")
    print(f"Дубликаты:   {duplicates}")
    print(f"Ошибки:      {failed}")
    print()
    print(f"Папка: {out}")
    print("Дальше: python prepare_negatives.py mine --src", out, "--out negatives_for_kaggle")
    print("        (отобрать только те, на которых модель реально ошибается)")


def cmd_prepare(args):
    src = Path(args.src)
    out = Path(args.out)

    if not src.exists():
        raise SystemExit(f"Source folder not found: {src}")
    out.mkdir(parents=True, exist_ok=True)

    copied = skipped = 0
    for img_path in iter_images(src):
        img = cv2.imread(str(img_path))
        if img is None:
            print(f"  skip (cannot read): {img_path.name}")
            skipped += 1
            continue

        img = resize_to_max_side(img)
        out_path = unique_path(out, f"{NEG_PREFIX}{img_path.stem}")
        cv2.imwrite(str(out_path), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        copied += 1

    print()
    print(f"Сохранено в {out}: {copied}")
    print(f"Пропущено (нечитаемые): {skipped}")
    print()
    print("Дальше: загрузите содержимое этой папки в train/images/ на Kaggle.")
    print("Файлы меток (.txt) создавать НЕ нужно — отсутствие .txt = фон для YOLO.")


def cmd_mine(args):
    from ultralytics import YOLO  # импорт здесь, чтобы prepare работал без ultralytics

    src = Path(args.src)
    out = Path(args.out)
    model_path = Path(args.model)

    if not src.exists():
        raise SystemExit(f"Source folder not found: {src}")
    if not model_path.exists():
        raise SystemExit(f"Model not found: {model_path}")

    out.mkdir(parents=True, exist_ok=True)
    model = YOLO(str(model_path))

    kept = clean = 0
    for img_path in iter_images(src):
        img = cv2.imread(str(img_path))
        if img is None:
            continue

        # ресайз до 640 — точно так же, как пойдёт в train; модель видит то же,
        # что и при будущем обучении, и FP отбираются честно.
        img = resize_to_max_side(img)

        results = model.predict(
            source=img,
            imgsz=MAX_SIDE,
            conf=args.conf,
            iou=0.5,
            device=args.device,
            verbose=False,
        )
        boxes = results[0].boxes
        n_det = 0 if boxes is None else len(boxes)

        if n_det > 0:
            top_conf = float(boxes.conf.max())
            stem = f"{NEG_PREFIX}{img_path.stem}__fp{n_det}_c{top_conf:.2f}"
            out_path = unique_path(out, stem)
            cv2.imwrite(str(out_path), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
            kept += 1
            print(f"  FP×{n_det} (max conf={top_conf:.2f}): {img_path.name}")
        else:
            clean += 1

    print()
    print(f"Проверено фото:                  {kept + clean}")
    print(f"Hard negatives (ошибки модели):  {kept}")
    print(f"Чистых (модель не ошиблась):     {clean}")
    print()
    print(f"Hard negatives лежат в: {out}")
    print("Дальше: загрузите содержимое этой папки в train/images/ на Kaggle.")
    print("Файлы меток (.txt) создавать НЕ нужно — отсутствие .txt = фон для YOLO.")


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_scrape = sub.add_parser("scrape", help="Скачать фото-кандидаты из DuckDuckGo Images")
    p_scrape.add_argument("--out", default="candidates", help="Куда сохранять")
    p_scrape.add_argument("--per-query", type=int, default=30, help="Сколько фото на каждый запрос")
    p_scrape.add_argument(
        "--queries", nargs="+", default=None,
        help="Свои запросы вместо встроенного списка (через пробел, в кавычках)"
    )
    p_scrape.set_defaults(func=cmd_scrape)

    p_mine = sub.add_parser("mine", help="Hard negative mining текущей моделью")
    p_mine.add_argument("--src", required=True, help="Папка с фото-кандидатами без апельсинов")
    p_mine.add_argument("--out", default="negatives_for_kaggle", help="Куда сохранить негативы")
    p_mine.add_argument("--model", default="model/best_v3_s.pt", help="Путь к .pt модели")
    p_mine.add_argument("--conf", type=float, default=0.25, help="Порог уверенности при отборе FP")
    p_mine.add_argument("--device", default="cpu", help="cpu или 0 (для GPU)")
    p_mine.set_defaults(func=cmd_mine)

    p_prep = sub.add_parser("prepare", help="Просто отресайзить папку с фото в негативы")
    p_prep.add_argument("--src", required=True, help="Папка с фото без апельсинов")
    p_prep.add_argument("--out", default="negatives_for_kaggle", help="Куда сохранить негативы")
    p_prep.set_defaults(func=cmd_prepare)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
