'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useUploadsStore, useServersStore } from '@/lib/store';
import { useWebSocket } from '@/lib/useWebSocket';

export default function Dashboard() {
  const uploadsStore = useUploadsStore();
  const serversStore = useServersStore();
  useWebSocket();

  useEffect(() => {
    // Fetch initial uploads and servers data
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const { uploadsApi, spaceApi } = await import('@/lib/api');

      // Fetch uploads
      const { data: uploadsRes } = await uploadsApi.listUploads({ limit: 10 });
      uploadsStore.setUploads(uploadsRes.uploads || uploadsRes || []);

      // Fetch servers with space info
      const { data: serversRes } = await spaceApi.getAllSpace();
      serversStore.setServers(serversRes || []);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    }
  };

  const activeUpload = uploadsStore.uploads.find((u) => u.status === 'UPLOADING');
  const completedCount = uploadsStore.uploads.filter(
    (u) => u.status === 'COMPLETED'
  ).length;
  const failedCount = uploadsStore.uploads.filter(
    (u) => u.status === 'FAILED'
  ).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Wayfinderr</h1>
          <p className="text-slate-400">Automatic MKV uploader with smart server selection</p>
        </div>

        {/* Navigation */}
        <div className="flex gap-4 mb-8">
          <Link
            href="/"
            className="px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-600"
          >
            Dashboard
          </Link>
          <Link
            href="/uploads"
            className="px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-600"
          >
            Uploads
          </Link>
          <Link
            href="/servers"
            className="px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-600"
          >
            Servers
          </Link>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-700 p-6 rounded-lg">
            <p className="text-slate-400 text-sm">Total Uploads</p>
            <p className="text-3xl font-bold text-white">{uploadsStore.uploads.length}</p>
          </div>
          <div className="bg-slate-700 p-6 rounded-lg">
            <p className="text-slate-400 text-sm">Completed</p>
            <p className="text-3xl font-bold text-green-400">{completedCount}</p>
          </div>
          <div className="bg-slate-700 p-6 rounded-lg">
            <p className="text-slate-400 text-sm">Failed</p>
            <p className="text-3xl font-bold text-red-400">{failedCount}</p>
          </div>
          <div className="bg-slate-700 p-6 rounded-lg">
            <p className="text-slate-400 text-sm">Queue Size</p>
            <p className="text-3xl font-bold text-blue-400">{uploadsStore.queueSize}</p>
          </div>
        </div>

        {/* Current Upload */}
        {activeUpload && (
          <div className="bg-slate-700 p-6 rounded-lg mb-8">
            <h2 className="text-xl font-bold text-white mb-4">Current Upload</h2>
            <p className="text-slate-300 mb-2">{activeUpload.filename}</p>
            <div className="w-full bg-slate-600 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${activeUpload.progress}%` }}
              />
            </div>
            <p className="text-slate-400 text-sm mt-2">{activeUpload.progress}%</p>
          </div>
        )}

        {/* Recent Uploads */}
        <div className="bg-slate-700 p-6 rounded-lg">
          <h2 className="text-xl font-bold text-white mb-4">Recent Uploads</h2>
          <div className="space-y-3">
            {uploadsStore.uploads.slice(0, 5).map((upload) => (
              <div key={upload.id} className="flex items-center justify-between bg-slate-600 p-3 rounded">
                <div>
                  <p className="text-white font-medium">{upload.filename}</p>
                  <p className="text-slate-400 text-sm">
                    {upload.hasItalianAudio && '🔊 ITA Audio'}{' '}
                    {upload.hasItalianSubtitles && '📝 ITA Subs'}
                  </p>
                </div>
                <span className={`px-3 py-1 rounded text-sm font-medium ${
                  upload.status === 'COMPLETED' ? 'bg-green-700 text-green-200' :
                  upload.status === 'FAILED' ? 'bg-red-700 text-red-200' :
                  upload.status === 'UPLOADING' ? 'bg-blue-700 text-blue-200' :
                  'bg-yellow-700 text-yellow-200'
                }`}>
                  {upload.status}
                </span>
              </div>
            ))}
          </div>
          <Link
            href="/uploads"
            className="text-blue-400 hover:text-blue-300 text-sm mt-4 inline-block"
          >
            View all uploads →
          </Link>
        </div>
      </div>
    </div>
  );
}
