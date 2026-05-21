import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const API = process.env.REACT_APP_API_URL || '/oranges';

const ML_DESCRIPTION = [
  {
    title: 'Датасет',
    text: 'За основу взят публичный датасет с Roboflow, содержащий фотографии апельсинов с разметкой bounding box для двух классов: Fresh Orange и Rotten Orange. Датасет был доразмечен вручную: добавлены bounding boxes для изображений с несколькими апельсинами, где разметка отсутствовала или была некорректной. Полигональная разметка (AI-assisted аннотации) конвертирована в формат bbox. Итоговый датасет: 2695 train / 771 valid / 385 test изображений в формате YOLOv8.'
  },
  {
    title: 'Модель',
    text: 'На первом этапе была обучена модель YOLOv8n (nano) — самая лёгкая версия архитектуры, которая показала mAP50 = 0.911 на тестовой выборке. Для улучшения качества была обучена модель YOLOv8s (small) — одноэтапный детектор объектов на основе свёрточной нейронной сети с большим количеством параметров. Обе модели инициализированы предобученными весами на датасете COCO (transfer learning). Параметры финальной модели: 11 млн весов, 28.4 GFLOPs.'
  },
  {
    title: 'Обучение',
    text: 'Платформа: Kaggle Notebooks, GPU Tesla T4. Фреймворк: Ultralytics 8.4.51, PyTorch 2.10. Параметры обучения: epochs=50, imgsz=640, batch=16, optimizer=auto, patience=10. Финальная модель обучалась все 50 эпох.'
  },
  {
    title: 'Результаты на тестовой выборке (YOLOv8s)',
    text: (
      <>
        mAP50: <b>0.983</b><br />
        mAP50-95: <b>0.965</b><br />
        Precision: <b>0.980</b><br />
        Recall: <b>0.981</b>
      </>
    )
  },
  {
    title: 'Инференс',
    text: 'Модель принимает изображения любого размера и формата. Перед обработкой изображение масштабируется до внутреннего разрешения модели с сохранением пропорций. При необходимости imgsz можно увеличить для лучшего распознавания мелких объектов на крупных фотографиях. Модель возвращает bounding boxes с классом и confidence для каждого найденного апельсина, а также подсчитывает процент испорченных плодов в партии.'
  },
  {
    title: 'Деплой',
    text: 'Модель упакована в Docker-контейнер с FastAPI-сервисом инференса. Рядом развёрнут Node.js бэкенд на Express, который раздаёт галерею тестовых фото и проксирует запросы к инференсу. Фронтенд на React загружает фото и показывает результат со статистикой по партии.'
  }
];

export default function App() {
  const [gallery, setGallery] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingFilename, setLoadingFilename] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches
  );
  const [resultModalOpen, setResultModalOpen] = useState(false);

  // Track viewport width
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)');
    const onChange = e => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Auto-open result modal on mobile when a new result arrives
  useEffect(() => {
    if (result && isMobile) setResultModalOpen(true);
  }, [result, isMobile]);

  // Camera
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/api/gallery`)
      .then(r => r.json())
      .then(data => setGallery(data.images || []))
      .catch(() => setGallery([]));
  }, []);

  // Stop camera stream on unmount
  useEffect(() => {
    return () => stopCamera();
  }, []);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const startCamera = async () => {
    setError(null);
    setSelectedFile(null);
    setFilePreview(null);
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      setCameraActive(true);
      // Attach stream after state update renders the video element
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }, 50);
    } catch {
      setError('Нет доступа к камере');
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      const file = new File([blob], 'camera.jpg', { type: 'image/jpeg' });
      stopCamera();
      setSelectedFile(file);
      setFilePreview(URL.createObjectURL(file));
      setResult(null);
      setError(null);
      detectWithFile(file);
    }, 'image/jpeg', 0.92);
  };

  const detectWithFile = async (file) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const response = await fetch(`${API}/api/detect`, { method: 'POST', body: formData });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
      setResult(await response.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const applyFile = useCallback((file) => {
    setSelectedFile(file);
    setResult(null);
    setError(null);
    setFilePreview(URL.createObjectURL(file));
    detectWithFile(file);
  }, []);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) { stopCamera(); applyFile(file); }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) { stopCamera(); applyFile(file); }
  };

  const detectGallery = async (filename) => {
    setLoadingFilename(filename);
    setError(null);
    setResult(null);
    setSelectedFile(null);
    setFilePreview(null);
    stopCamera();
    try {
      const response = await fetch(`${API}/api/detect-gallery/${encodeURIComponent(filename)}`, { method: 'POST' });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
      setResult(await response.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingFilename(null);
    }
  };

  const resetUpload = () => {
    stopCamera();
    setSelectedFile(null);
    setFilePreview(null);
    setResult(null);
    setError(null);
  };

  return (
    <div className="app">
      <button className="info-btn" onClick={() => setShowModal(true)}>
        Как модель создавалась?
      </button>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Как создавалась модель</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {ML_DESCRIPTION.map((section, i) => (
                <div key={i} className="modal-section">
                  <div className="modal-section-number">{i + 1}</div>
                  <div className="modal-section-content">
                    <h3>{section.title}</h3>
                    <p>{section.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <header className="header">
        <span className="header-emoji">🍊</span>
        <div>
          <h1>Детектор свежести апельсинов</h1>
          <p>Определение свежести апельсинов с помощью YOLOv8</p>
        </div>
      </header>

      <main className="main">
        <div className="top-row">

          {/* Upload card */}
          <section className="card upload-card">
            <h2>Загрузить изображение</h2>

            {/* Camera view */}
            {cameraActive && (
              <div className="camera-wrap">
                <video ref={videoRef} className="camera-video" autoPlay playsInline muted />
                <div className="camera-controls">
                  <button className="cam-btn capture-btn" onClick={capturePhoto}>📸 Снять</button>
                  <button className="cam-btn cancel-btn" onClick={stopCamera}>✕ Отмена</button>
                </div>
              </div>
            )}

            {/* Preview */}
            {!cameraActive && filePreview && (
              <div className="preview-wrap">
                <img className="upload-preview" src={filePreview} alt="preview" />
                <button className="reset-btn" onClick={resetUpload} title="Удалить">✕</button>
              </div>
            )}

            {/* Drop zone */}
            {!cameraActive && !filePreview && (
              <label
                className={`upload-area ${dragOver ? 'drag-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <input type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
                <span className="upload-icon">📁</span>
                <p>Перетащите или нажмите для выбора</p>
                <p className="upload-hint">JPG, PNG, WebP · до 20 МБ</p>
              </label>
            )}

            {/* Action buttons */}
            <div className="upload-actions">
              {loading && !loadingFilename && (
                <div className="detecting-indicator"><span className="spinner" /> Анализ...</div>
              )}
            </div>

            {error && <div className="error-msg">⚠ {error}</div>}
          </section>

          {/* Gallery card */}
          <section className="card gallery-card">
            <h2>Галерея тестовых изображений</h2>
            {gallery.length === 0 ? (
              <p className="muted">Загрузка...</p>
            ) : (
              <div className="gallery">
                {gallery.map(filename => (
                  <button
                    key={filename}
                    className={`gallery-item ${loadingFilename === filename ? 'loading' : ''}`}
                    onClick={() => detectGallery(filename)}
                    disabled={!!loadingFilename || loading || cameraActive}
                    title={filename}
                  >
                    <img
                      src={`${API}/api/gallery/${encodeURIComponent(filename)}`}
                      alt={filename}
                      loading="lazy"
                    />
                    {loadingFilename === filename && <span className="gallery-spinner" />}
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Results — inline (desktop only) */}
        {result && !isMobile && (
          <section className="card results-card">
            <h2>Результаты детекции</h2>
            <ResultBody result={result} />
          </section>
        )}
      </main>

      {/* Results — modal (mobile) */}
      {result && isMobile && resultModalOpen && (
        <div className="modal-overlay" onClick={() => setResultModalOpen(false)}>
          <div className="modal results-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Результаты детекции</h2>
              <button className="modal-close" onClick={() => setResultModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <ResultBody result={result} />
            </div>
          </div>
        </div>
      )}

      {/* Hidden canvas for photo capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}

function ResultBody({ result }) {
  return (
    <div className="results-layout">
      <div className="result-img-wrap">
        <img src={`data:image/jpeg;base64,${result.annotated_image}`} alt="Результат" className="result-img" />
      </div>
      <div className="stats">
        <StatCard label="Всего апельсинов" value={result.stats.total} color="white" icon="🍊" />
        <StatCard label="Свежих" value={result.stats.fresh} color="green" icon="✅" />
        <StatCard label="Испорченных" value={result.stats.rotten} color="red" icon="❌" />
        <StatCard label="Процент брака" value={`${result.stats.rotten_percent}%`} color="yellow" icon="📊" />
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon }) {
  return (
    <div className={`stat-card stat-${color}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
