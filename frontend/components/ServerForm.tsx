'use client';

import { useState } from 'react';
import { Server } from '@/lib/store';
import { serversApi } from '@/lib/api';

interface ServerFormProps {
  server?: Server;
  onSuccess: () => void;
  onCancel: () => void;
}

const inputClass =
  'w-full px-4 py-2 bg-slate-600 text-white rounded border border-slate-500 focus:border-blue-400 outline-none';

export default function ServerForm({ server, onSuccess, onCancel }: ServerFormProps) {
  const isEdit = Boolean(server?.id);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: server?.name || '',
    apiEndpoint: server?.apiEndpoint || '',
    apiToken: server?.apiToken || '',
    sshHost: server?.sshHost || '',
    sshPort: String(server?.sshPort ?? 22),
    sshUsername: server?.sshUsername || '',
    sshPassword: '',
    sshPath: server?.sshPath || '',
    mediaCheckPolicy: server?.mediaCheckPolicy || 'SKIP_NO_ITA',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const payload = { ...formData, sshPort: parseInt(formData.sshPort, 10) || 22 };

    try {
      if (server?.id) {
        await serversApi.updateServer(server.id, payload);
      } else {
        await serversApi.createServer(payload);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 bg-red-900/20 border border-red-600 rounded text-red-300 text-sm">
          {error}
        </div>
      )}

      <div>
        <label className="block text-slate-300 mb-2">Server Name</label>
        <input
          type="text"
          name="name"
          value={formData.name}
          onChange={handleChange}
          className={inputClass}
          placeholder="e.g., Server 1"
          required
        />
      </div>

      <div>
        <label className="block text-slate-300 mb-2">API Endpoint</label>
        <input
          type="url"
          name="apiEndpoint"
          value={formData.apiEndpoint}
          onChange={handleChange}
          className={inputClass}
          placeholder="https://user.host.usbx.me/ultra-api/get_diskquota"
          required
        />
      </div>

      <div>
        <label className="block text-slate-300 mb-2">API Token</label>
        <input
          type="password"
          name="apiToken"
          value={formData.apiToken}
          onChange={handleChange}
          className={inputClass}
          placeholder="Your API token"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-slate-300 mb-2">SSH Host</label>
          <input
            type="text"
            name="sshHost"
            value={formData.sshHost}
            onChange={handleChange}
            className={inputClass}
            placeholder="host.usbx.me"
            required
          />
        </div>
        <div>
          <label className="block text-slate-300 mb-2">SSH Port</label>
          <input
            type="number"
            name="sshPort"
            value={formData.sshPort}
            onChange={handleChange}
            className={inputClass}
            placeholder="22"
            required
          />
        </div>
      </div>

      <div>
        <label className="block text-slate-300 mb-2">SSH Username</label>
        <input
          type="text"
          name="sshUsername"
          value={formData.sshUsername}
          onChange={handleChange}
          className={inputClass}
          placeholder="Your SSH username"
          required
        />
      </div>

      <div>
        <label className="block text-slate-300 mb-2">SSH Password</label>
        <input
          type="password"
          name="sshPassword"
          value={formData.sshPassword}
          onChange={handleChange}
          className={inputClass}
          placeholder={
            isEdit && server?.hasSshPassword
              ? 'Leave blank to keep the current password'
              : 'Leave blank to use SSH_PRIVATE_KEY_PATH'
          }
          autoComplete="new-password"
        />
      </div>

      <div>
        <label className="block text-slate-300 mb-2">Remote Folder</label>
        <input
          type="text"
          name="sshPath"
          value={formData.sshPath}
          onChange={handleChange}
          className={inputClass}
          placeholder="/home/username/media/movies"
          required
        />
      </div>

      <div>
        <label className="block text-slate-300 mb-2">Media Policy</label>
        <select
          name="mediaCheckPolicy"
          value={formData.mediaCheckPolicy}
          onChange={handleChange}
          className={inputClass}
        >
          <option value="SKIP_NO_ITA">Skip files without Italian audio/subs</option>
          <option value="ALWAYS_UPLOAD">Always upload</option>
        </select>
      </div>

      <div className="flex gap-2 pt-4">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Saving...' : 'Save Server'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-4 py-2 bg-slate-600 text-white rounded hover:bg-slate-500"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
