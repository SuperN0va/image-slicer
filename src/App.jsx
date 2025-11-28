import React, { useState, useEffect, useRef } from 'react';
import { Upload, Download, Play, Pause, Settings, Image as ImageIcon, Grid3X3, Film, Package, Layers, RefreshCw } from 'lucide-react';

const SpriteSheetToGif = () => {
  // --- State Management ---
  const [imageSrc, setImageSrc] = useState(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [cols, setCols] = useState(4);
  const [rows, setRows] = useState(1);
  const [fps, setFps] = useState(10);
  const [isPlaying, setIsPlaying] = useState(true);
  const [generatedGif, setGeneratedGif] = useState(null);
  const [isGeneratingGif, setIsGeneratingGif] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [workerBlobUrl, setWorkerBlobUrl] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // New: 预览相关状态
  const [slicedPreviews, setSlicedPreviews] = useState([]); 
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // --- Refs ---
  const previewCanvasRef = useRef(null);
  const originalImageRef = useRef(null);
  const frameIndexRef = useRef(0);
  const debounceTimerRef = useRef(null); // 用于防抖

  // --- Initialization (Load GIF.js & JSZip) ---
  useEffect(() => {
    const gifScript = document.createElement('script');
    gifScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js';
    gifScript.async = true;
    document.body.appendChild(gifScript);

    const zipScript = document.createElement('script');
    zipScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    zipScript.async = true;
    document.body.appendChild(zipScript);

    fetch('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js')
      .then(resp => resp.text())
      .then(text => {
        const blob = new Blob([text], { type: 'application/javascript' });
        setWorkerBlobUrl(URL.createObjectURL(blob));
      })
      .catch(err => console.error("Failed to load gif worker", err));

    return () => {
      if (gifScript.parentNode) document.body.removeChild(gifScript);
      if (zipScript.parentNode) document.body.removeChild(zipScript);
      if (workerBlobUrl) URL.revokeObjectURL(workerBlobUrl);
    };
  }, []);

  // --- File Processing Logic ---
  const processFile = (file) => {
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          setImageSize({ width: img.width, height: img.height });
          originalImageRef.current = img;
          setImageSrc(event.target.result);
          setGeneratedGif(null);
          // 切换图片时立即清空预览，等待 useEffect 触发重新生成
          setSlicedPreviews([]); 
          frameIndexRef.current = 0;
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleImageUpload = (e) => processFile(e.target.files[0]);
  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    processFile(e.dataTransfer.files[0]);
  };

  // --- Animation Logic ---
  useEffect(() => {
    if (!isPlaying || !imageSrc || !originalImageRef.current) return;
    let timeoutId;
    let requestId;

    const renderLoop = () => {
      const canvas = previewCanvasRef.current;
      const img = originalImageRef.current;
      if (!canvas || !img) return;

      const ctx = canvas.getContext('2d');
      const totalFrames = cols * rows;
      const frameWidth = Math.floor(imageSize.width / cols);
      const frameHeight = Math.floor(imageSize.height / rows);

      if (frameWidth <= 0 || frameHeight <= 0) return;

      if (canvas.width !== frameWidth || canvas.height !== frameHeight) {
        canvas.width = frameWidth;
        canvas.height = frameHeight;
      }

      const currentFrame = frameIndexRef.current % totalFrames;
      const colIndex = currentFrame % cols;
      const rowIndex = Math.floor(currentFrame / cols);
      const sx = colIndex * frameWidth;
      const sy = rowIndex * frameHeight;

      ctx.clearRect(0, 0, frameWidth, frameHeight);
      ctx.drawImage(img, sx, sy, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);

      timeoutId = setTimeout(() => {
        frameIndexRef.current = (frameIndexRef.current + 1) % totalFrames;
        requestId = requestAnimationFrame(renderLoop);
      }, 1000 / fps);
    };
    renderLoop();
    return () => { clearTimeout(timeoutId); cancelAnimationFrame(requestId); };
  }, [isPlaying, imageSrc, cols, rows, fps, imageSize]);


  // --- Helper: Get Canvas for a specific frame ---
  const getFrameCanvas = (frameIndex, width, height) => {
    const colIndex = frameIndex % cols;
    const rowIndex = Math.floor(frameIndex / cols);
    const sx = colIndex * width;
    const sy = rowIndex * height;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    ctx.drawImage(
      originalImageRef.current,
      sx, sy, width, height,
      0, 0, width, height
    );
    return canvas;
  }

  // --- Automatic Slice Preview Generation (New Logic) ---
  useEffect(() => {
    if (!imageSrc || !originalImageRef.current) return;

    // 清除之前的定时器
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    setIsPreviewLoading(true);

    // 设置防抖，延迟 500ms 执行生成，避免拖动滑块时卡顿
    debounceTimerRef.current = setTimeout(() => {
      generatePreviews();
    }, 500);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [imageSrc, cols, rows, imageSize]);

  const generatePreviews = () => {
    if (!originalImageRef.current) return;

    const frameWidth = Math.floor(imageSize.width / cols);
    const frameHeight = Math.floor(imageSize.height / rows);
    const totalFrames = cols * rows;
    
    // 如果切片数量过多（例如超过200），可能需要限制一下或者提示用户，这里暂不做硬性限制但需注意性能
    const newPreviews = [];

    for (let i = 0; i < totalFrames; i++) {
      const canvas = getFrameCanvas(i, frameWidth, frameHeight);
      newPreviews.push(canvas.toDataURL('image/png'));
    }

    setSlicedPreviews(newPreviews);
    setIsPreviewLoading(false);
  };

  // --- GIF Generation ---
  const generateGif = () => {
    if (!window.GIF || !workerBlobUrl || !originalImageRef.current) return;
    setIsGeneratingGif(true);
    setGeneratedGif(null);

    const frameWidth = Math.floor(imageSize.width / cols);
    const frameHeight = Math.floor(imageSize.height / rows);
    const totalFrames = cols * rows;

    const gif = new window.GIF({
      workers: 2,
      quality: 1,
      workerScript: workerBlobUrl,
      width: frameWidth,
      height: frameHeight,
      transparent: null
    });

    for (let i = 0; i < totalFrames; i++) {
      const canvas = getFrameCanvas(i, frameWidth, frameHeight);
      
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, frameWidth, frameHeight);
      const data = imageData.data;
      for (let j = 0; j < data.length; j += 4) {
        if (data[j+3] < 128) data[j+3] = 0;
        else data[j+3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);

      gif.addFrame(canvas, { copy: true, delay: 1000 / fps });
    }

    gif.on('finished', (blob) => {
      setGeneratedGif(URL.createObjectURL(blob));
      setIsGeneratingGif(false);
    });

    gif.render();
  };

  // --- ZIP Generation ---
  const generateZip = async () => {
    if (!window.JSZip || !originalImageRef.current) {
        alert("JSZip库尚未加载，请稍后再试。");
        return;
    }

    setIsZipping(true);
    
    const zip = new window.JSZip();
    const folder = zip.folder("slices");
    const frameWidth = Math.floor(imageSize.width / cols);
    const frameHeight = Math.floor(imageSize.height / rows);
    const totalFrames = cols * rows;
    
    const getBlob = (canvas) => new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

    try {
      for (let i = 0; i < totalFrames; i++) {
        const canvas = getFrameCanvas(i, frameWidth, frameHeight);
        const blob = await getBlob(canvas);
        const fileName = `slice_${i + 1}.png`;
        folder.file(fileName, blob);
      }

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = "slices.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (error) {
      console.error("Error generating ZIP:", error);
      alert("ZIP生成失败");
    } finally {
      setIsZipping(false);
    }
  };

  const ImageWithGrid = () => {
    if (!imageSrc) return null;
    return (
      <div className="relative inline-block border border-gray-600 rounded overflow-hidden shadow-xl">
        <img src={imageSrc} alt="Source" className="max-w-full max-h-[400px] object-contain block opacity-80" />
        <div className="absolute inset-0 pointer-events-none" 
             style={{ 
               display: 'grid', 
               gridTemplateColumns: `repeat(${cols}, 1fr)`,
               gridTemplateRows: `repeat(${rows}, 1fr)`
             }}>
          {Array.from({ length: cols * rows }).map((_, i) => (
            <div key={i} className="border border-cyan-400/60 text-[10px] text-cyan-300 flex items-start justify-start p-0.5 hover:bg-cyan-500/10 transition-colors">
               <span className="bg-black/60 px-1 rounded shadow backdrop-blur-sm">{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-700 pb-4">
          <div className="flex items-center gap-3">
            <Layers className="w-8 h-8 text-cyan-400" />
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                图片切片与GIF工具
              </h1>
              <p className="text-xs text-slate-400">Image Slicer & GIF Generator</p>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Panel: Settings & Upload */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* 1. Upload */}
            <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-lg">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-cyan-400" /> 
                1. 上传图片
              </h2>
              <label 
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`
                  flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer transition-all group
                  ${isDragging 
                    ? 'border-cyan-400 bg-cyan-900/30' 
                    : 'border-slate-600 bg-slate-700/50 hover:bg-slate-700 hover:border-cyan-500'
                  }
                `}
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6 pointer-events-none">
                  <Upload className={`w-8 h-8 mb-2 transition-colors ${isDragging ? 'text-cyan-400' : 'text-slate-400 group-hover:text-cyan-400'}`} />
                  <p className="mb-1 text-sm text-slate-400 font-semibold">点击或拖拽上传</p>
                  <p className="text-xs text-slate-500">支持 PNG, JPG</p>
                </div>
                <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
              </label>
            </div>

            {/* 2. Grid Settings */}
            <div className={`bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-lg transition-opacity ${!imageSrc ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Grid3X3 className="w-5 h-5 text-cyan-400" /> 
                2. 切割设定
              </h2>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wider">横向分割 (列)</label>
                    <input 
                      type="number" min="1" max="50"
                      value={cols} 
                      onChange={(e) => setCols(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 focus:border-cyan-500 focus:outline-none text-center font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wider">纵向分割 (行)</label>
                    <input 
                      type="number" min="1" max="50"
                      value={rows} 
                      onChange={(e) => setRows(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 focus:border-cyan-500 focus:outline-none text-center font-mono"
                    />
                  </div>
                </div>

                <div className="bg-slate-900/50 p-3 rounded border border-slate-700/50 text-xs space-y-1">
                  <div className="flex justify-between text-slate-400">
                    <span>原图尺寸:</span>
                    <span className="font-mono text-slate-200">{imageSize.width} x {imageSize.height} px</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>切片尺寸:</span>
                    <span className="font-mono text-cyan-300">
                      {Math.floor(imageSize.width / cols)} x {Math.floor(imageSize.height / rows)} px
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>切片总数:</span>
                    <span className="font-mono text-slate-200">{cols * rows}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-700">
                   <label className="block text-xs text-slate-400 mb-2 flex justify-between">
                    <span>GIF 预览速度</span>
                    <span className="text-cyan-400">{fps} FPS</span>
                  </label>
                  <input 
                    type="range" min="1" max="60" 
                    value={fps} 
                    onChange={(e) => setFps(parseInt(e.target.value))}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                  />
                </div>
              </div>
            </div>

            {/* 3. Animation Preview (Mini) */}
            <div className={`bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-lg transition-opacity ${!imageSrc ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
               <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Play className="w-5 h-5 text-cyan-400" /> 
                  GIF 预览
                </h2>
                <button 
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="bg-slate-700 hover:bg-slate-600 p-2 rounded-full transition-colors text-cyan-400"
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                </button>
               </div>
               
               <div className="flex justify-center items-center bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] bg-slate-900 border border-slate-600 rounded-lg h-[150px] overflow-hidden">
                 <canvas ref={previewCanvasRef} className="max-w-full max-h-full object-contain pixelated" style={{ imageRendering: 'pixelated' }} />
               </div>
            </div>
          </div>

          {/* Right Panel: Main View & Actions */}
          <div className="lg:col-span-8 space-y-6">
            
            {/* Source Image Viewer */}
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg min-h-[400px] flex flex-col">
              <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
                <Settings className="w-5 h-5 text-cyan-400" /> 
                3. 切割网格确认
              </h2>
              <div className="flex-1 flex justify-center items-center bg-slate-900/30 rounded-lg p-4 border border-slate-700/50">
                {imageSrc ? (
                   <ImageWithGrid />
                ) : (
                  <div className="text-slate-500 flex flex-col items-center">
                    <Grid3X3 size={48} className="mb-2 opacity-30" />
                    <p>请上传图片以查看网格</p>
                  </div>
                )}
              </div>
            </div>

             {/* Live Slices Preview (Moved Up) */}
             {(imageSrc) && (
              <div className="bg-slate-800 p-6 rounded-xl border border-cyan-500/30 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-md font-bold text-cyan-400 flex items-center gap-2">
                      <Layers size={18} /> 实时切片预览
                    </h3>
                    {isPreviewLoading && (
                      <span className="flex items-center text-xs text-slate-400">
                        <RefreshCw className="animate-spin w-3 h-3 mr-1" /> 更新中...
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-500">共 {slicedPreviews.length} 张</span>
                </div>
                
                {slicedPreviews.length > 0 ? (
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 max-h-[300px] overflow-y-auto p-2 bg-slate-900/50 rounded-lg border border-slate-700 custom-scrollbar">
                    {slicedPreviews.map((src, idx) => (
                      <div key={idx} className="relative group aspect-square bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] bg-slate-800 rounded border border-slate-600 overflow-hidden flex items-center justify-center transition-all hover:border-cyan-400">
                        <img src={src} alt={`slice-${idx}`} className="max-w-full max-h-full object-contain" />
                        <div className="absolute top-0 left-0 bg-black/60 text-[10px] text-white px-1 rounded-br">
                          {idx + 1}
                        </div>
                        {/* Individual Download Overlay */}
                        <a 
                          href={src} 
                          download={`slice_${idx+1}.png`}
                          className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                          title="下载此切片"
                        >
                          <Download size={16} className="text-white" />
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-24 flex items-center justify-center text-slate-500 text-sm italic">
                    {isPreviewLoading ? '正在生成切片...' : '等待图片加载...'}
                  </div>
                )}
              </div>
            )}


            {/* Action Buttons */}
            <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${!imageSrc && 'opacity-50 pointer-events-none'}`}>
              {/* Generate GIF Button */}
              <button
                onClick={generateGif}
                disabled={isGeneratingGif}
                className={`
                  flex items-center justify-center gap-3 px-6 py-4 rounded-xl text-lg font-bold shadow-lg transition-all
                  ${isGeneratingGif 
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed' 
                    : 'bg-slate-700 hover:bg-slate-600 text-cyan-400 border border-cyan-500/30 hover:border-cyan-400'}
                `}
              >
                {isGeneratingGif ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current"></div> : <Film className="w-6 h-6" />}
                <span>{isGeneratingGif ? 'GIF 生成中...' : '生成 GIF 动画'}</span>
              </button>

              {/* Generate ZIP Button (Primary) */}
              <button
                onClick={generateZip}
                disabled={isZipping}
                className={`
                  flex items-center justify-center gap-3 px-6 py-4 rounded-xl text-lg font-bold shadow-lg transition-all
                  ${isZipping 
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed' 
                    : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-cyan-500/20'}
                `}
              >
                {isZipping ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div> : <Package className="w-6 h-6" />}
                <span>{isZipping ? '正在打包...' : '下载所有切片 (ZIP)'}</span>
              </button>
            </div>

            {/* Results Section (GIF Only now, since slices are always visible) */}
            {generatedGif && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="bg-slate-800 p-6 rounded-xl border border-cyan-500/30">
                  <h3 className="text-md font-bold text-cyan-400 mb-4 flex items-center gap-2">
                    <Film size={18} /> GIF 结果
                  </h3>
                  <div className="flex flex-col sm:flex-row gap-6 items-center">
                    <div className="p-2 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] bg-slate-900 rounded border border-slate-600">
                      <img src={generatedGif} alt="Generated GIF" className="max-h-[150px] object-contain" />
                    </div>
                    <a 
                      href={generatedGif} 
                      download="sprite-animation.gif"
                      className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
                    >
                      <Download size={16} /> 下载 GIF
                    </a>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
};

export default SpriteSheetToGif;