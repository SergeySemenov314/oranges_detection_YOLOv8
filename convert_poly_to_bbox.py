"""
Конвертирует полигоны в bounding boxes в YOLO label файлах.
Строки с polygon (>5 значений) заменяются на bbox (5 значений).
Строки с bbox (5 значений) остаются без изменений.
Оригинальные файлы перезаписываются.
"""

from pathlib import Path

DATASET_DIR = Path(r"D:\My_projects\oranges_detection\dataset")

converted_files = 0
converted_lines = 0
total_files = 0

for split in ("train", "valid", "test"):
    labels_dir = DATASET_DIR / split / "labels"
    if not labels_dir.exists():
        print(f"Пропускаю (не найдено): {labels_dir}")
        continue

    label_files = list(labels_dir.glob("*.txt"))
    print(f"\n[{split}] {len(label_files)} label-файлов")

    for label_path in label_files:
        total_files += 1
        lines = label_path.read_text(encoding="utf-8").strip().splitlines()
        new_lines = []
        file_changed = False

        for line in lines:
            parts = line.strip().split()
            if not parts:
                continue

            class_id = parts[0]
            vals = list(map(float, parts[1:]))

            if len(vals) == 4:
                # уже bbox — оставляем как есть
                new_lines.append(line.strip())

            elif len(vals) >= 6 and len(vals) % 2 == 0:
                # polygon → конвертируем в bbox
                xs = [vals[i] for i in range(0, len(vals), 2)]
                ys = [vals[i] for i in range(1, len(vals), 2)]

                x_min, x_max = min(xs), max(xs)
                y_min, y_max = min(ys), max(ys)

                x_center = (x_min + x_max) / 2
                y_center = (y_min + y_max) / 2
                bbox_w = x_max - x_min
                bbox_h = y_max - y_min

                new_line = f"{class_id} {x_center:.6f} {y_center:.6f} {bbox_w:.6f} {bbox_h:.6f}"
                new_lines.append(new_line)
                file_changed = True
                converted_lines += 1

            else:
                # непонятный формат — оставляем как есть
                new_lines.append(line.strip())

        if file_changed:
            label_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
            converted_files += 1

print(f"\nГотово:")
print(f"  Всего label-файлов обработано : {total_files}")
print(f"  Файлов с изменениями          : {converted_files}")
print(f"  Строк полигонов конвертировано: {converted_lines}")
