import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

interface AdminAccount {
  id: string;
  email: string;
  fullName: string;
  accountStatus: string;
  createdAt: string;
  tel: string | null;
  roles: string[];
}

const getRoleBadge = (role: string): { classes: string; dot: string } => {
  switch (role) {
    case 'Admin':
      return { classes: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700', dot: 'bg-red-500' };
    case 'Training Provider':
      return { classes: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700', dot: 'bg-purple-500' };
    case 'Developer':
      return { classes: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700', dot: 'bg-blue-500' };
    case 'Trainer':
      return { classes: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700', dot: 'bg-emerald-500' };
    case 'Learner':
      return { classes: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700', dot: 'bg-amber-500' };
    default:
      return { classes: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600', dot: 'bg-gray-400' };
  }
};

const AdminManagementView: React.FC = () => {
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchAdmins = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/training-provider/admin-accounts');
      const json = await res.json();
      if (json.success) {
        setAdmins(json.data.admins);
      } else {
        setError(json.error || 'Failed to fetch admin accounts');
      }
    } catch {
      setError('Failed to fetch admin accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdmins();
  }, []);

  const filteredAdmins = admins.filter(admin => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      admin.fullName?.toLowerCase().includes(q) ||
      admin.email?.toLowerCase().includes(q)
    );
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div>
      <h2 className="text-3xl font-bold mb-6 dark:text-white">Admin Management</h2>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-blue-600">{admins.length}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Total Admin Accounts</p>
        </Card>
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-green-600">{admins.filter(a => a.accountStatus === 'active').length}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Active Admins</p>
        </Card>
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-purple-600">{admins.filter(a => a.roles.length >= 3).length}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Multi-Role Admins</p>
        </Card>
      </div>

      <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
        {/* Search */}
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="Search by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-500 text-lg">Loading admin accounts...</p>
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-red-500">{error}</p>
          </div>
        ) : filteredAdmins.length === 0 ? (
          <div className="text-center py-8">
            <Icon name={IconName.MyAccount} className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No admin accounts found</h3>
            <p className="text-gray-500 dark:text-gray-400">
              {searchQuery ? 'No admins match your search.' : 'No admin accounts exist.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Full Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Roles</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Account Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Created</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                {filteredAdmins.map((admin) => (
                  <tr key={admin.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                      {admin.fullName || '—'}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">
                      {admin.email}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm">
                      <div className="flex flex-wrap gap-1">
                        {admin.roles.map((role) => {
                          const badge = getRoleBadge(role);
                          return (
                            <span
                              key={role}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${badge.classes}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                              {role}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        admin.accountStatus === 'active'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                          : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                      }`}>
                        {admin.accountStatus === 'active' ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">
                      {formatDate(admin.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default AdminManagementView;
