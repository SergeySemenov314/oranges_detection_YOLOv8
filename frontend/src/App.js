import React, { useState, useEffect, useCallback } from 'react';
import './App.css';

const API = '/oranges';

export default function App() {
  const [gallery, setGallery] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedGallery, setSelectedGallery] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/gallery`)
      .then(r => r.json())
      .then(data => setGallery(data.images || []))
      .catch(() => setGallery([]));
  }, []);

  const applyFile = useCallback((file) => {
    setSelectedFile(file);
    setSelectedGallery(null);
    setResult(null);
    setError(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
  }, []);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) applyFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) applyFile(file);
  };

  const handleGallerySelect = (filename) => {
    setSelectedGallery(filename);
    setSelectedFile(null);
    setResult(null);
    setError(null);
    setPreview(`${API}/api/gallery/${encodeURIComponent(filename)}`);
  };

  const handleDetect = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      let response;
      if (selectedFile) {
        const formData = new FormData();
        formData.append('image', selectedFile);
        response = await fetch(`${API}/api/detect`, { method: 'POST', body: formData });
      } else {
        response = await fetch(
          `${API}/api/detect-gallery/${encodeURIComponent(selectedGallery)}`,
          { method: 'POST' }
        );
      }
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status}`);
      }
      setResult(await response.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const hasSelection = selectedFile || selectedGallery;

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
          {/* Upload */}
          <section className="card">
            <h2>Загрузить изображение</h2>
            <label
              className={`upload-area ${dragOver ? 'drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <span className="upload-icon">📁</span>
              <p>Перетащите или нажмите для выбора</p>
              <p className="upload-hint">JPG, PNG, WebP · до 20 МБ</p>
            </label>
          </section>

          {/* Preview + detect button */}
          <section className="card preview-card">
            <h2>Выбранное изображение</h2>
            {preview ? (
              <>
                <img className="preview-img" src={preview} alt="preview" />
                <button
                  className="detect-btn"
                  onClick={handleDetect}
                  disabled={loading || !hasSelection}
                >
                  {loading ? (
                    <><span className="spinner" /> Анализ...</>
                  ) : (
                    '🔍 Определить свежесть'
                  )}
                </button>
                {error && <div className="error-msg">⚠ {error}</div>}
              </>
            ) : (
              <div className="empty-preview">
                <span>Выберите изображение из галереи или загрузите своё</span>
              </div>
            )}
          </section>
        </div>

        {/* Gallery */}
        <section className="card">
          <h2>Галерея тестовых изображений</h2>
          {gallery.length === 0 ? (
            <p className="muted">Загрузка галереи...</p>
          ) : (
            <div className="gallery">
              {gallery.map(filename => (
                <button
                  key={filename}
                  className={`gallery-item ${selectedGallery === filename ? 'active' : ''}`}
                  onClick={() => handleGallerySelect(filename)}
                  title={filename}
                >
                  <img
                    src={`${API}/api/gallery/${encodeURIComponent(filename)}`}
                    alt={filename}
                    loading="lazy"
                  />
                  {selectedGallery === filename && (
                    <span className="gallery-check">✓</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Results */}
        {result && (
          <section className="card results-card">
            <h2>Результаты детекции</h2>
            <div className="results-layout">
              <div className="result-img-wrap">
                <img
                  src={`data:image/jpeg;base64,${result.annotated_image}`}
                  alt="Результат"
                  className="result-img"
                />
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
