'use client';

import Link from 'next/link';
import { useServersStore } from '@/lib/store';
import { useEffect, useState } from 'react';
import { serversApi, spaceApi } from '@/lib/api';
import Modal from '@/components/Modal';
import ServerForm from '@/components/ServerForm';

export default function ServersPage() {
  const serversStore = useServersStore();
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchServers();
  }, []);

  const fetchServers = async () => {
    try {
      setLoading(true);
      const { data: serversRes } = await serversApi.listServers();
      const { data: spaceRes } = await spaceApi.getAllSpace();

      // Merge server data with space info
      const merged = serversRes.map((server: any) => ({
        ...server,
        ...spaceRes.find((s: any) => s.id === server.id),
      }));

      serversStore.setServers(merged);
      setError(null);
    } catch (err: any) {
      console.error('Failed to fetch servers:', err);
      setError('Failed to load servers');
    } finally {
      setLoading(false);
    }
  };

  const handleTestServer = async (serverId: string) => {
    try {
      setTesting(serverId);
      await serversApi.testServer(serverId);
      // Refresh space info for this server
      await serversApi.refreshSpace(serverId);
      await fetchServers();
    } catch (err: any) {
      console.error('Server test failed:', err);
      setError('Server test failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setTesting(null);
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    if (!confirm('Are you sure you want to delete this server?')) return;

    try {
      await serversApi.deleteServer(serverId);
      await fetchServers();
    } catch (err: any) {
      console.error('Failed to delete server:', err);
      setError('Failed to delete server');
    }
  };

  const handleFormSuccess = async () => {
    setShowAddModal(false);
    setEditingServer(null);
    await fetchServers();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="container mx-auto">
        <div className="mb-8 flex justify-between items-center">
          <div>
            <Link href="/" className="text-blue-400 hover:text-blue-300 mb-4 inline-block">
              ← Back to Dashboard
            </Link>
            <h1 className="text-3xl font-bold text-white">Server Management</h1>
          </div>
          <button
            onClick={fetchServers}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-600 rounded text-red-300">
            {error}
          </div>
        )}

        {loading && serversStore.servers.length === 0 ? (
          <div className="text-center text-slate-400">Loading servers...</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {serversStore.servers.map((server) => (
                <div key={server.id} className="bg-slate-700 p-6 rounded-lg">
                  <h2 className="text-xl font-bold text-white mb-4">{server.name}</h2>
                  <div className="space-y-3">
                    <div>
                      <p className="text-slate-400 text-sm">Free Space</p>
                      <p className="text-2xl font-bold text-white">{server.freeSpaceGB} GB</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-sm">Bytes</p>
                      <p className="text-sm text-slate-300">{server.freeSpaceBytes}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-sm">Last Updated</p>
                      <p className="text-sm text-slate-300">
                        {server.lastSpaceCheckAt
                          ? new Date(server.lastSpaceCheckAt).toLocaleString()
                          : 'Never'}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => setEditingServer(server.id)}
                      className="px-3 py-1 bg-slate-600 text-white rounded text-sm hover:bg-slate-500"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleTestServer(server.id)}
                      disabled={testing === server.id}
                      className="px-3 py-1 bg-slate-600 text-white rounded text-sm hover:bg-slate-500 disabled:opacity-50"
                    >
                      {testing === server.id ? 'Testing...' : 'Test'}
                    </button>
                    <button
                      onClick={() => handleDeleteServer(server.id)}
                      className="px-3 py-1 bg-red-600/50 text-red-200 rounded text-sm hover:bg-red-600"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {serversStore.servers.length === 0 && (
              <div className="bg-slate-700 p-8 rounded-lg text-center mb-8">
                <p className="text-slate-400 mb-4">No servers configured yet.</p>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Add Server
                </button>
              </div>
            )}

            <div className="bg-slate-700 p-6 rounded-lg">
              <button
                onClick={() => {
                  setEditingServer(null);
                  setShowAddModal(true);
                }}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 mb-4"
              >
                + Add New Server
              </button>
            </div>
          </>
        )}
      </div>

      <Modal
        isOpen={showAddModal || editingServer !== null}
        title={editingServer ? 'Edit Server' : 'Add New Server'}
        onClose={() => {
          setShowAddModal(false);
          setEditingServer(null);
        }}
      >
        <ServerForm
          server={
            editingServer
              ? serversStore.servers.find((s) => s.id === editingServer)
              : undefined
          }
          onSuccess={handleFormSuccess}
          onCancel={() => {
            setShowAddModal(false);
            setEditingServer(null);
          }}
        />
      </Modal>
    </div>
  );
}
