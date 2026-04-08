import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';
import { useLms } from '@contexts/LmsContext';

const ALL_ROLES = ['Learner', 'Trainer', 'Admin', 'Developer', 'Finance', 'Training Provider'];

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
    case 'Finance':
      return { classes: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-700', dot: 'bg-teal-500' };
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
  const { currentUser } = useLms();
  const currentUserId = currentUser?.id;

  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState<string>('All');
  const [filterStatus, setFilterStatus] = useState<string>('All');

  // Edit modal state
  const [editingAdmin, setEditingAdmin] = useState<AdminAccount | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [editAccountStatus, setEditAccountStatus] = useState('active');
  const [isSaving, setIsSaving] = useState(false);

  // Disable confirmation
  const [disablingAdmin, setDisablingAdmin] = useState<AdminAccount | null>(null);
  const [isDisabling, setIsDisabling] = useState(false);

  // Delete confirmation
  const [deletingAdmin, setDeletingAdmin] = useState<AdminAccount | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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
    const matchesSearch = !searchQuery ||
      admin.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      admin.email?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = filterRole === 'All' || admin.roles.includes(filterRole);
    const matchesStatus = filterStatus === 'All' || admin.accountStatus === filterStatus;
    return matchesSearch && matchesRole && matchesStatus;
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  // Edit handlers
  const openEditModal = (admin: AdminAccount) => {
    setEditingAdmin(admin);
    setEditFullName(admin.fullName || '');
    setEditRoles([...admin.roles]);
    setEditAccountStatus(admin.accountStatus);
  };

  const handleToggleRole = (role: string) => {
    setEditRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  };

  const handleSaveEdit = async () => {
    if (!editingAdmin || editRoles.length === 0) {
      alert('At least one role must be selected.');
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch('/api/training-provider/update-user-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editingAdmin.id,
          roles: editRoles,
          accountStatus: editAccountStatus,
          currentUserId,
          full_name: editFullName,
        }),
      });
      const result = await response.json();
      if (result.success) {
        await fetchAdmins();
        setEditingAdmin(null);
      } else {
        throw new Error(result.error || 'Failed to update admin');
      }
    } catch (err) {
      alert(`Failed to update: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Disable/Enable handler
  const handleDisableAdmin = async () => {
    if (!disablingAdmin) return;
    setIsDisabling(true);
    try {
      const response = await fetch('/api/training-provider/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: disablingAdmin.id }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.message || 'Failed to disable admin');
      await fetchAdmins();
      setDisablingAdmin(null);
    } catch (err) {
      alert(`Failed to disable: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsDisabling(false);
    }
  };

  const handleEnableAdmin = async (admin: AdminAccount) => {
    try {
      const response = await fetch('/api/training-provider/update-user-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: admin.id,
          roles: admin.roles,
          accountStatus: 'active',
          currentUserId,
        }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.message || 'Failed to enable admin');
      await fetchAdmins();
    } catch (err) {
      alert(`Failed to enable: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  // Delete handler
  const handleDeleteAdmin = async () => {
    if (!deletingAdmin) return;
    setIsDeleting(true);
    try {
      const response = await fetch('/api/training-provider/hard-delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: deletingAdmin.id }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.message || 'Failed to delete admin');
      await fetchAdmins();
      setDeletingAdmin(null);
      alert('Admin permanently deleted.');
    } catch (err) {
      alert(`Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsDeleting(false);
    }
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
        {/* Search & Filters */}
        <div className="mb-6 space-y-4">
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
            <select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              <option value="All">All Roles</option>
              {ALL_ROLES.map(role => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              <option value="All">All Status</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
            {(searchQuery || filterRole !== 'All' || filterStatus !== 'All') && (
              <button
                onClick={() => { setSearchQuery(''); setFilterRole('All'); setFilterStatus('All'); }}
                className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Clear
              </button>
            )}
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
              {(searchQuery || filterRole !== 'All' || filterStatus !== 'All') ? 'No admins match your filters. Try adjusting the search or filters.' : 'No admin accounts exist.'}
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Actions</th>
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
                    <td className="px-4 py-3 whitespace-nowrap">
                      {admin.id === currentUserId ? (
                        <span className="text-xs text-gray-400 italic">Cannot edit self</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          {/* Edit */}
                          <button
                            onClick={() => openEditModal(admin)}
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 border border-blue-300 dark:border-blue-600 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                          >
                            <Icon name={IconName.Edit} className="w-3.5 h-3.5" />
                            Edit
                          </button>
                          {/* Disable / Enable */}
                          {admin.accountStatus === 'active' ? (
                            <button
                              onClick={() => setDisablingAdmin(admin)}
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-yellow-700 hover:text-yellow-900 dark:text-yellow-400 dark:hover:text-yellow-300 border border-yellow-400 dark:border-yellow-600 rounded-md hover:bg-yellow-50 dark:hover:bg-yellow-900/30 transition-colors"
                            >
                              <Icon name={IconName.Delete} className="w-3.5 h-3.5" />
                              Disable
                            </button>
                          ) : (
                            <button
                              onClick={() => handleEnableAdmin(admin)}
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-green-700 hover:text-green-900 dark:text-green-400 dark:hover:text-green-300 border border-green-400 dark:border-green-600 rounded-md hover:bg-green-50 dark:hover:bg-green-900/30 transition-colors"
                            >
                              <Icon name={IconName.Check} className="w-3.5 h-3.5" />
                              Enable
                            </button>
                          )}
                          {/* Delete */}
                          <button
                            onClick={() => setDeletingAdmin(admin)}
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 border border-red-300 dark:border-red-600 rounded-md hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                          >
                            <Icon name={IconName.Delete} className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Edit Modal */}
      {editingAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Edit Admin</h3>

            <div className="space-y-4">
              {/* Full Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full Name</label>
                <input
                  type="text"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>

              {/* Email (read-only) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                <input
                  type="text"
                  value={editingAdmin.email}
                  disabled
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-md px-3 py-2 text-sm bg-gray-50 dark:bg-gray-600 text-gray-500 dark:text-gray-400"
                />
              </div>

              {/* Roles */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Roles</label>
                <div className="flex flex-wrap gap-2">
                  {ALL_ROLES.map(role => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => handleToggleRole(role)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        editRoles.includes(role)
                          ? getRoleBadge(role).classes
                          : 'bg-gray-50 text-gray-400 border-gray-200 dark:bg-gray-700 dark:text-gray-500 dark:border-gray-600'
                      }`}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>

              {/* Account Status */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Account Status</label>
                <select
                  value={editAccountStatus}
                  onChange={(e) => setEditAccountStatus(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                >
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setEditingAdmin(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={isSaving || editRoles.length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disable Confirmation Modal */}
      {disablingAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Disable Admin</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Are you sure you want to disable <span className="font-medium text-gray-900 dark:text-white">{disablingAdmin.fullName || disablingAdmin.email}</span>? They will no longer be able to log in.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDisablingAdmin(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDisableAdmin}
                disabled={isDisabling}
                className="px-4 py-2 text-sm font-medium text-white bg-yellow-600 rounded-md hover:bg-yellow-700 disabled:opacity-50 transition-colors"
              >
                {isDisabling ? 'Disabling...' : 'Disable'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">Permanently Delete Admin</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              Are you sure you want to permanently delete <span className="font-medium text-gray-900 dark:text-white">{deletingAdmin.fullName || deletingAdmin.email}</span>?
            </p>
            <p className="text-sm text-red-600 dark:text-red-400 font-medium mb-4">
              This action cannot be undone. All data for this user will be permanently removed.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeletingAdmin(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAdmin}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {isDeleting ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminManagementView;
