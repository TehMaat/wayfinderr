'use client';

import Link from 'next/link';
import { useUploadsStore } from '@/lib/store';
import { useEffect, useState } from 'react';
import { useWebSocket } from '@/lib/useWebSocket';
import { uploadsApi } from '@/lib/api';

export default function UploadsPage() {
  const uploadsStore = useUploadsStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  useWebSocket();

  useEffect(() => {
    fetchUploads();
  }, []);

  const fetchUploads = async () => {
    try {
      setLoading(true);
      const { data } = await uploadsApi.listUploads({ limit: 50 });
      uploadsStore.setUploads(data.uploads || data || []);
      setError(null);
    } catch (err: any) {
      console.error('Failed to fetch uploads:', err);
      setError('Failed to load uploads');
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async (uploadId: string) => {
    try {
      setRetrying(uploadId);
      await uploadsApi.retryUpload(uploadId);
      await fetchUploads();
    } catch (err: any) {
      console.error('Failed to retry upload:', err);
      setError('Failed to retry upload');
    } finally {
      setRetrying(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="container mx-auto">
        <div className="mb-8">
          <Link href="/" className="text-blue-400 hover:text-blue-300 mb-4 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-white">Upload History</h1>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-600 rounded text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center text-slate-400">Loading uploads...</div>
        ) : (
          <>
            <div className="bg-slate-700 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-600">
                  <tr>
                    <th className="px-6 py-3 text-left text-white">Filename</th>
                    <th className="px-6 py-3 text-left text-white">Status</th>
                    <th className="px-6 py-3 text-left text-white">Audio/Subs</th>
                    <th className="px-6 py-3 text-left text-white">Uploaded</th>
                    <th className="px-6 py-3 text-left text-white">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadsStore.uploads.map((upload) => (
                    <tr key={upload.id} className="border-t border-slate-600 hover:bg-slate-600">
                      <td className="px-6 py-4 text-white">{upload.filename}</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded text-sm font-medium inline-block ${
                          upload.status === 'COMPLETED' ? 'bg-green-700 text-green-200' :
                          upload.status === 'FAILED' ? 'bg-red-700 text-red-200' :
                          upload.status === 'UPLOADING' ? 'bg-blue-700 text-blue-200' :
                          'bg-yellow-700 text-yellow-200'
                        }`}>
                          {upload.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-300">
                        {upload.hasItalianAudio && '🔊 Audio'}{' '}
                        {upload.hasItalianSubtitles && '📝 Subs'}
                      </td>
                      <td className="px-6 py-4 text-slate-300">
                        {new Date(upload.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 space-x-2">
                        <Link href={`/uploads/${upload.id}`} className="text-blue-400 hover:text-blue-300 text-sm">
                          View
                        </Link>
                        {upload.status === 'FAILED' && (
                          <button
                            onClick={() => handleRetry(upload.id)}
                            disabled={retrying === upload.id}
                            className="text-orange-400 hover:text-orange-300 text-sm disabled:opacity-50"
                          >
                            {retrying === upload.id ? 'Retrying...' : 'Retry'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {uploadsStore.uploads.length === 0 && (
              <div className="bg-slate-700 p-8 rounded-lg text-center">
                <p className="text-slate-400">No uploads yet. Start copying MKV files to the watch directory!</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
