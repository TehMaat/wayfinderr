'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { uploadsApi } from '@/lib/api';
import { Upload } from '@/lib/store';

export default function UploadDetailPage({ params }: { params: { id: string } }) {
  const [upload, setUpload] = useState<Upload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    fetchUpload();
  }, [params.id]);

  const fetchUpload = async () => {
    try {
      setLoading(true);
      const { data } = await uploadsApi.getUpload(params.id);
      setUpload(data);
      setError(null);
    } catch (err: any) {
      console.error('Failed to fetch upload:', err);
      setError('Failed to load upload details');
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async () => {
    try {
      setRetrying(true);
      await uploadsApi.retryUpload(params.id);
      await fetchUpload();
    } catch (err: any) {
      console.error('Failed to retry:', err);
      setError('Failed to retry upload');
    } finally {
      setRetrying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8 flex items-center justify-center">
        <div className="text-slate-400">Loading upload details...</div>
      </div>
    );
  }

  if (!upload) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
        <div className="container mx-auto">
          <Link href="/uploads" className="text-blue-400 hover:text-blue-300 mb-4 inline-block">
            ← Back to Uploads
          </Link>
          <div className="bg-slate-700 p-8 rounded-lg text-center">
            <p className="text-slate-400">Upload not found</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="container mx-auto max-w-2xl">
        <Link href="/uploads" className="text-blue-400 hover:text-blue-300 mb-4 inline-block">
          ← Back to Uploads
        </Link>

        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-600 rounded text-red-300">
            {error}
          </div>
        )}

        <div className="bg-slate-700 rounded-lg p-6 mb-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-white break-all">{upload.filename}</h1>
            <p className="text-slate-400 text-sm mt-2">
              {(Number(upload.size) / 1024 / 1024).toFixed(2)} MB
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-600 p-4 rounded">
              <p className="text-slate-400 text-sm">Status</p>
              <div className="mt-2">
                <span className={`px-3 py-1 rounded text-sm font-medium inline-block ${
                  upload.status === 'COMPLETED' ? 'bg-green-700 text-green-200' :
                  upload.status === 'FAILED' ? 'bg-red-700 text-red-200' :
                  upload.status === 'UPLOADING' ? 'bg-blue-700 text-blue-200' :
                  'bg-yellow-700 text-yellow-200'
                }`}>
                  {upload.status}
                </span>
              </div>
            </div>

            <div className="bg-slate-600 p-4 rounded">
              <p className="text-slate-400 text-sm">Progress</p>
              <p className="text-2xl font-bold text-white mt-2">{upload.progress}%</p>
            </div>

            <div className="bg-slate-600 p-4 rounded">
              <p className="text-slate-400 text-sm">Created</p>
              <p className="text-white mt-2">
                {new Date(upload.createdAt).toLocaleString()}
              </p>
            </div>

            {upload.completedAt && (
              <div className="bg-slate-600 p-4 rounded">
                <p className="text-slate-400 text-sm">Completed</p>
                <p className="text-white mt-2">
                  {new Date(upload.completedAt).toLocaleString()}
                </p>
              </div>
            )}
          </div>

          <div className="bg-slate-600 p-4 rounded mb-6">
            <p className="text-slate-400 text-sm mb-3">Media Information</p>
            <div className="space-y-2">
              <div className="flex items-center">
                <span className="text-white mr-2">🔊 Italian Audio:</span>
                <span className={upload.hasItalianAudio ? 'text-green-400' : 'text-red-400'}>
                  {upload.hasItalianAudio ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="flex items-center">
                <span className="text-white mr-2">📝 Italian Subtitles:</span>
                <span className={upload.hasItalianSubtitles ? 'text-green-400' : 'text-red-400'}>
                  {upload.hasItalianSubtitles ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
          </div>

          {upload.error && (
            <div className="bg-red-900/20 border border-red-600 rounded p-4 mb-6">
              <p className="text-red-300 text-sm">
                <span className="font-semibold">Error:</span> {upload.error}
              </p>
            </div>
          )}

          <div className="flex gap-2">
            {upload.status === 'FAILED' && (
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
              >
                {retrying ? 'Retrying...' : 'Retry Upload'}
              </button>
            )}
            <Link
              href="/uploads"
              className="px-4 py-2 bg-slate-600 text-white rounded hover:bg-slate-500"
            >
              Back
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
