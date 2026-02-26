import { useState, useEffect, useRef } from 'react';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Settings, UploadCloud, Folder, File as FileIcon, X, CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import './App.css';

interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucket: string;
}

interface UploadTask {
  id: string;
  file: File;
  path: string;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
}

function App() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [showConfig, setShowConfig] = useState(true);
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);

  // Load credentials from local storage on mount
  useEffect(() => {
    const saved = localStorage.getItem('r2_credentials');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.accessKeyId && parsed.secretAccessKey && parsed.endpoint && parsed.bucket) {
          setCredentials(parsed);
          setShowConfig(false);
        }
      } catch (e) {
        // ignore
      }
    }
  }, []);

  const saveCredentials = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const creds: Credentials = {
      accessKeyId: formData.get('accessKeyId') as string,
      secretAccessKey: formData.get('secretAccessKey') as string,
      endpoint: formData.get('endpoint') as string,
      bucket: formData.get('bucket') as string,
    };
    setCredentials(creds);
    localStorage.setItem('r2_credentials', JSON.stringify(creds));
    setShowConfig(false);
  };

  const handleFilesAdded = (files: FileList | File[]) => {
    const newTasks: UploadTask[] = Array.from(files).map((file: any) => {
      // If the file comes from directory input, it has a webkitRelativePath like "RootFolder/file.txt"
      // We want to strip the "RootFolder/" from the path.
      let path = file.customPath || file.name;

      if (!file.customPath && file.webkitRelativePath) {
        const parts = file.webkitRelativePath.split('/');
        // If it has multiple parts, remove the first one (the root folder name)
        if (parts.length > 1) {
          path = parts.slice(1).join('/');
        } else {
          path = file.webkitRelativePath;
        }
      }

      return {
        id: Math.random().toString(36).substring(7),
        file,
        path,
        progress: 0,
        status: 'pending' as const,
      };
    });
    setTasks((prev) => [...prev, ...newTasks]);
  };

  // Recursive algorithm for folders drop, modified to ignore root folder name
  const getFilesFromEntry = async (entry: any, path: string = '', isRoot: boolean = false): Promise<File[]> => {
    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file((file: File) => {
          (file as any).customPath = path + file.name;
          resolve([file]);
        });
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      return new Promise<File[]>((resolve) => {
        const entries: any[] = [];
        const readEntries = () => {
          dirReader.readEntries(async (results: any[]) => {
            if (!results.length) {
              const promises = entries.map((subEntry) => {
                // Ignore the root folder name from the path mapping
                const newPath = isRoot ? path : path + entry.name + '/';
                return getFilesFromEntry(subEntry, newPath, false);
              });
              const filesArrays = await Promise.all(promises);
              resolve(filesArrays.flat());
            } else {
              entries.push(...results);
              readEntries();
            }
          });
        };
        readEntries();
      });
    }
    return [];
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const items = e.dataTransfer.items;

    if (items) {
      const promises = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            promises.push(getFilesFromEntry(entry, '', true));
          }
        }
      }
      const filesArrays = await Promise.all(promises);
      const allFiles = filesArrays.flat();
      if (allFiles.length > 0) {
        handleFilesAdded(allFiles);
      }
    } else if (e.dataTransfer.files) {
      handleFilesAdded(e.dataTransfer.files);
    }
  };

  const removeTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const clearCompleted = () => {
    setTasks((prev) => prev.filter((t) => t.status !== 'completed'));
  };

  const retryTask = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTasks((prev) =>
      prev.map(task =>
        task.id === id ? { ...task, status: 'pending', error: undefined, progress: 0 } : task
      )
    );
  };

  const startUpload = async () => {
    if (!credentials) return;
    setIsUploading(true);

    try {
      // Formatear correctamente el endpoint para Cloudflare R2
      // R2 demanda que NO tenga / final, y si es path style que no intercepte el bucket en el host
      let formattedEndpoint = credentials.endpoint.replace(/\/$/, '');

      const client = new S3Client({
        region: 'auto',
        endpoint: formattedEndpoint,
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
        },
        // Configuraciones CLAVES para Cloudflare R2
        forcePathStyle: true,
      });

      const pendingTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'error');

      // Run uploads concurrently. Increased pool size to 10 for faster uploads of many files.
      const poolSize = 10;
      let index = 0;

      const worker = async () => {
        while (true) {
          const currentIndex = index++;
          if (currentIndex >= pendingTasks.length) break;

          const task = pendingTasks[currentIndex];

          // Update status to uploading
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, status: 'uploading' } : t))
          );

          try {
            const upload = new Upload({
              client,
              params: {
                Bucket: credentials.bucket,
                Key: task.path,
                Body: task.file,
              },
              // Reduce part size to 10MB to be safe, Cloudflare supports large parts
              partSize: 10 * 1024 * 1024,
              leavePartsOnError: false, // Clean up on failure
            });

            upload.on('httpUploadProgress', (progress) => {
              const percentage = Math.round((progress.loaded! / progress.total!) * 100);
              setTasks((prev) =>
                prev.map((t) => (t.id === task.id ? { ...t, progress: percentage } : t))
              );
            });

            await upload.done();

            setTasks((prev) =>
              prev.map((t) =>
                t.id === task.id ? { ...t, status: 'completed', progress: 100 } : t
              )
            );
          } catch (error: any) {
            console.error("Detalles completos del error AWS S3:", {
              name: error.name,
              message: error.message,
              statusCode: error.$metadata?.httpStatusCode,
              requestId: error.$metadata?.requestId,
              extendedRequestId: error.$metadata?.extendedRequestId,
              error: error
            });

            let detailedError = error.message || 'Error desconocido';
            if (error.name === 'NetworkingError' || error.message.includes('fetch')) {
              detailedError = 'Error de Red: Verifica las políticas CORS en la configuración de R2.';
            } else if (error.$metadata?.httpStatusCode === 403) {
              detailedError = 'Acceso Denegado (403): Verifica tus credenciales (Access Key y Secret).';
            }

            setTasks((prev) =>
              prev.map((t) =>
                t.id === task.id
                  ? { ...t, status: 'error', error: detailedError, progress: 0 }
                  : t
              )
            );
          }
        }
      };

      const workers = [];
      for (let i = 0; i < poolSize; i++) {
        workers.push(worker());
      }

      await Promise.all(workers);
      setIsUploading(false);

    } catch (err: any) {
      console.error("Error inicializando S3 Client:", err);
      setIsUploading(false);
    }
  };

  // Cálculo para barra de progreso general
  const totalBytes = tasks.reduce((sum, task) => sum + task.file.size, 0);
  const uploadedBytes = tasks.reduce((sum, task) => {
    if (task.status === 'completed') return sum + task.file.size;
    if (task.status === 'error') return sum + 0;
    return sum + (task.file.size * (task.progress / 100));
  }, 0);
  const globalProgress = totalBytes === 0 ? 0 : Math.round((uploadedBytes / totalBytes) * 100);

  return (
    <div className="app-container">
      <header className="header glass">
        <div className="logo">
          <UploadCloud className="logo-icon" size={32} />
          <h1>Geeks S3 Api upload</h1>
        </div>
        {!showConfig && credentials && (
          <button className="icon-btn" onClick={() => setShowConfig(true)} title="Configuration">
            <Settings size={20} />
            <span>Settings</span>
          </button>
        )}
      </header>

      <main className="main-content">
        {showConfig ? (
          <div className="config-card glass animate-in">
            <h2>Configure S3 / R2 Credentials</h2>
            <p className="subtitle">Set up access to Cloudflare R2 or any S3-Compatible Storage.</p>

            <form onSubmit={saveCredentials} className="config-form">
              <div className="form-group">
                <label>Endpoint URL</label>
                <input
                  type="url"
                  name="endpoint"
                  required
                  defaultValue={credentials?.endpoint || ''}
                  placeholder="https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
                />
              </div>
              <div className="form-group">
                <label>Access Key ID</label>
                <input
                  type="text"
                  name="accessKeyId"
                  required
                  defaultValue={credentials?.accessKeyId || ''}
                  placeholder="Tu Access Key"
                />
              </div>
              <div className="form-group">
                <label>Secret Access Key</label>
                <input
                  type="password"
                  name="secretAccessKey"
                  required
                  defaultValue={credentials?.secretAccessKey || ''}
                  placeholder="Tu Secret Key"
                />
              </div>
              <div className="form-group">
                <label>Nombre del Bucket</label>
                <input
                  type="text"
                  name="bucket"
                  required
                  defaultValue={credentials?.bucket || ''}
                  placeholder="nombre-de-tu-bucket"
                />
              </div>
              <div className="form-actions">
                {credentials && (
                  <button type="button" className="btn-secondary" onClick={() => setShowConfig(false)}>
                    Cancelar
                  </button>
                )}
                <button type="submit" className="btn-primary">Guardar Credenciales</button>
              </div>
            </form>
          </div>
        ) : (
          <div className="dashboard animate-in">
            <div className="bucket-info glass">
              <span className="dot"></span>
              Connected to bucket: <strong>{credentials?.bucket}</strong>
            </div>

            <div className="action-panels">
              <div className="upload-panel glass">
                <div
                  className="dropzone"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                >
                  <UploadCloud size={48} className="drop-icon" />
                  <h3>Drag & Drop files here</h3>
                  <p>or select from the options below</p>

                  <div className="select-buttons">
                    <button className="btn-outline" onClick={() => fileInputRef.current?.click()}>
                      <FileIcon size={18} /> Select Files
                    </button>
                    <button className="btn-outline" onClick={() => dirInputRef.current?.click()}>
                      <Folder size={18} /> Select Folder
                    </button>
                  </div>

                  <input
                    type="file"
                    multiple
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    onChange={(e) => e.target.files && handleFilesAdded(e.target.files)}
                  />
                  <input
                    type="file"
                    // @ts-ignore - webkitdirectory is non-standard but widely supported
                    webkitdirectory="true"
                    directory="true"
                    multiple
                    ref={dirInputRef}
                    style={{ display: 'none' }}
                    onChange={(e) => e.target.files && handleFilesAdded(e.target.files)}
                  />
                </div>
              </div>

              <div className="tasks-panel glass">
                <div className="tasks-header">
                  <h3>Upload Queue ({tasks.length})</h3>
                  <div className="task-actions">
                    <button className="text-btn" onClick={clearCompleted} disabled={isUploading}>
                      Clear Completed
                    </button>
                    <button
                      className="btn-primary btn-small"
                      onClick={startUpload}
                      disabled={isUploading || tasks.filter(t => t.status === 'pending' || t.status === 'error').length === 0}
                    >
                      {isUploading ? <><Loader2 size={16} className="spin" /> Uploading...</> : 'Start Upload'}
                    </button>
                  </div>
                </div>

                {tasks.length > 0 && (
                  <div className="global-progress-container mb-1">
                    <div className="global-progress-header">
                      <span>Overall Progress</span>
                      <span className="accent">{globalProgress}%</span>
                    </div>
                    <div className="global-progress-bar">
                      <div
                        className="global-progress-fill"
                        style={{ width: `${globalProgress}%` }}
                      ></div>
                    </div>
                    <div className="global-progress-stats text-muted">
                      {tasks.filter(t => t.status === 'completed').length} / {tasks.length} Files Completed • {(uploadedBytes / (1024 * 1024)).toFixed(2)} MB of {(totalBytes / (1024 * 1024)).toFixed(2)} MB
                    </div>
                  </div>
                )}

                <div className="tasks-list">
                  {tasks.length === 0 ? (
                    <div className="empty-state">No files queued for upload.</div>
                  ) : (
                    tasks
                      .filter((task) => {
                        // Si no estamos subiendo nada, mostramos algunos pendientes o errores
                        if (!isUploading) {
                          return task.status !== 'completed';
                        }
                        // Si estamos subiendo, solo mostramos los que están activos o fallaron
                        return task.status === 'uploading' || task.status === 'error';
                      })
                      .map((task) => (
                        <div key={task.id} className="task-row-container">
                          <div className={`task-item ${task.status}`}>
                            <div className="task-info">
                              <span className="task-name" title={task.path}>{task.path}</span>
                              <span className="task-size">{(task.file.size / (1024 * 1024)).toFixed(2)} MB</span>
                            </div>

                            <div className="task-progress-bar">
                              <div
                                className={`task-progress-fill ${task.status}`}
                                style={{ width: `${task.progress}%` }}
                              ></div>
                            </div>

                            <div className="task-status">
                              {task.status === 'pending' && <span className="status-text">Pending</span>}
                              {task.status === 'uploading' && <span className="status-text accent">{task.progress}%</span>}
                              {task.status === 'completed' && <CheckCircle size={18} className="success-icon" />}

                              {(task.status === 'pending') && (
                                <button className="remove-btn" onClick={(e) => { e.stopPropagation(); removeTask(task.id); }}>
                                  <X size={16} />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Error details row that is always visible if there is an error */}
                          {task.status === 'error' && (
                            <div className="task-error-details animate-in">
                              <div className="error-header">
                                <span className="status-text error">Upload Failed</span>
                                <div className="error-actions" style={{ display: 'flex', gap: '8px' }}>
                                  <button className="remove-btn" onClick={(e) => retryTask(task.id, e)} title="Retry Upload" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <RefreshCw size={14} /> Retry
                                  </button>
                                  <button className="remove-btn" onClick={(e) => { e.stopPropagation(); removeTask(task.id); }}>
                                    <X size={16} />
                                  </button>
                                </div>
                              </div>
                              <p className="error-message-text">{task.error}</p>
                            </div>
                          )}
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
