import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const API = process.env.REACT_APP_API_URL || '/oranges';

export default function App() {
  const [gallery, setGallery] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingFilename, setLoadingFilename] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

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
      <header className="header">
        <span className="header-emoji">🍊</span>
        <div>
          <h1>Детектор апельсинов</h1>
          <p>Определение свежести цитрусовых с помощью YOLOv8</p>
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
              {!cameraActive && !filePreview && (
                <button className="cam-open-btn" onClick={startCamera}>📷 Сделать фото</button>
              )}
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

        {/* Results */}
        {result && (
          <section className="card results-card">
            <h2>Результаты детекции</h2>
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
          </section>
        )}
      </main>

      {/* Hidden canvas for photo capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
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
