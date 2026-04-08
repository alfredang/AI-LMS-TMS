import React, { useState, useEffect, useRef } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { authService } from '@lib/services/authService';

const inputClasses = "block w-full px-3 py-2 text-on-surface bg-surface border border-default rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent";

const ALL_ROLES = ['Learner', 'Trainer', 'Developer', 'Admin', 'Finance', 'Training Provider'] as const;

// Role badge config
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

// Legacy helper for places that only need className string
const getRoleBadgeColor = (role: string) => getRoleBadge(role).classes;

interface UserData {
    id: string;
    email: string;
    secondary_email?: string;
    full_name: string;
    account_status: string;
    roles: string[];
}

const UserManagementView: React.FC = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [users, setUsers] = useState<UserData[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    // Filter state
    const [showFilterDropdown, setShowFilterDropdown] = useState(false);
    const [filterColumn, setFilterColumn] = useState('');
    const [filterValue, setFilterValue] = useState('');
    const [activeFilter, setActiveFilter] = useState<{ column: string; value: string } | null>(null);

    // Sort state
    const [showSortDropdown, setShowSortDropdown] = useState(false);
    const [sortColumn, setSortColumn] = useState('');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

    // Role filter state
    const [showRoleFilterDropdown, setShowRoleFilterDropdown] = useState(false);
    const [selectedRoleFilters, setSelectedRoleFilters] = useState<string[]>([]);

    // Refs for click-outside closing
    const roleFilterRef = useRef<HTMLDivElement>(null);
    const filterRef = useRef<HTMLDivElement>(null);
    const sortRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (roleFilterRef.current && !roleFilterRef.current.contains(target)) setShowRoleFilterDropdown(false);
            if (filterRef.current && !filterRef.current.contains(target)) setShowFilterDropdown(false);
            if (sortRef.current && !sortRef.current.contains(target)) setShowSortDropdown(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Account status filter checkboxes
    const [showActive, setShowActive] = useState(true);
    const [showDisabled, setShowDisabled] = useState(false);

    // Edit role modal state
    const [editingUser, setEditingUser] = useState<UserData | null>(null);
    const [editRoles, setEditRoles] = useState<string[]>([]);
    const [editAccountStatus, setEditAccountStatus] = useState<string>('active');
    const [editFullName, setEditFullName] = useState<string>('');
    const [isSaving, setIsSaving] = useState(false);

    // Add User Modal State
    const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
    const [newUser, setNewUser] = useState({
        full_name: '',
        email: '',
        telephone: '',
        roles: ['Learner'] as string[]
    });
    const [isAddingUser, setIsAddingUser] = useState(false);

    // Disable User State
    const [deletingUser, setDeletingUser] = useState<UserData | null>(null);
    const [isDeletingUser, setIsDeletingUser] = useState(false);
    const [deletingUserOrgInfo, setDeletingUserOrgInfo] = useState<{
        isLastMember: boolean;
        companyName: string;
        uen: string;
    } | null>(null);

    // Hard Delete User State
    const [hardDeletingUser, setHardDeletingUser] = useState<UserData | null>(null);
    const [isHardDeletingUser, setIsHardDeletingUser] = useState(false);

    const filterableColumns = [
        { value: 'full_name', label: 'Full Name' },
        { value: 'roles', label: 'Roles' },
        { value: 'account_status', label: 'Account Status' },
    ];

    // Fetch all users
    const fetchUsers = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/training-provider/users');
            if (!response.ok) {
                throw new Error(`Failed to fetch users (Error ${response.status})`);
            }
            const result = await response.json();
            if (result.success && result.data) {
                setUsers(result.data);
            } else {
                throw new Error(result.error || 'Failed to fetch users');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch users');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
        const userData = authService.getUserData();
        if (userData?.id) {
            setCurrentUserId(userData.id);
        }
    }, []);

    // Apply column filter
    const applyFilter = () => {
        if (filterColumn && filterValue.trim()) {
            setActiveFilter({ column: filterColumn, value: filterValue.trim() });
            setCurrentPage(1);
        }
        setShowFilterDropdown(false);
    };

    const clearFilter = () => {
        setActiveFilter(null);
        setFilterColumn('');
        setFilterValue('');
        setCurrentPage(1);
    };

    // Filter users
    const filteredUsers = users.filter(user => {
        // Apply account status checkboxes
        const isActive = user.account_status === 'active';
        if (isActive && !showActive) return false;
        if (!isActive && !showDisabled) return false;

        // Apply role filter checkboxes
        if (selectedRoleFilters.length > 0) {
            if (!user.roles.some(r => selectedRoleFilters.includes(r))) return false;
        }

        // Apply column-based filter
        if (activeFilter) {
            if (activeFilter.column === 'roles') {
                const rolesStr = (user.roles || []).join(', ').toLowerCase();
                if (!rolesStr.includes(activeFilter.value.toLowerCase())) {
                    return false;
                }
            } else {
                const fieldValue = ((user as any)[activeFilter.column] || '').toString().toLowerCase();
                if (!fieldValue.includes(activeFilter.value.toLowerCase())) {
                    return false;
                }
            }
        }

        // Apply search query
        if (!searchQuery.trim()) return true;
        const query = searchQuery.toLowerCase();
        return (
            (user.full_name || '').toLowerCase().includes(query) ||
            (user.email || '').toLowerCase().includes(query) ||
            (user.secondary_email || '').toLowerCase().includes(query) ||
            (user.roles || []).join(', ').toLowerCase().includes(query)
        );
    });

    // Sort users
    const sortedUsers = [...filteredUsers].sort((a, b) => {
        if (!sortColumn) return 0;

        let valA: string;
        let valB: string;

        if (sortColumn === 'roles') {
            valA = (a.roles || []).join(', ').toLowerCase();
            valB = (b.roles || []).join(', ').toLowerCase();
        } else {
            valA = ((a as any)[sortColumn] || '').toString().toLowerCase();
            valB = ((b as any)[sortColumn] || '').toString().toLowerCase();
        }

        if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    // Pagination
    const totalPages = Math.ceil(sortedUsers.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedUsers = sortedUsers.slice(startIndex, endIndex);

    // Reset to page 1 when search changes
    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery]);

    // Reset to page 1 when sort changes
    useEffect(() => {
        setCurrentPage(1);
    }, [sortColumn, sortDirection]);

    const goToPage = (page: number) => {
        if (page >= 1 && page <= totalPages && page !== currentPage) {
            setCurrentPage(page);
        }
    };

    // Generate page numbers
    const getPageNumbers = () => {
        const pages: (number | string)[] = [];
        const maxVisible = 5;

        if (totalPages <= maxVisible) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
        } else {
            if (currentPage <= 3) {
                for (let i = 1; i <= 4; i++) pages.push(i);
                pages.push('...');
                pages.push(totalPages);
            } else if (currentPage >= totalPages - 2) {
                pages.push(1);
                pages.push('...');
                for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
            } else {
                pages.push(1);
                pages.push('...');
                pages.push(currentPage - 1);
                pages.push(currentPage);
                pages.push(currentPage + 1);
                pages.push('...');
                pages.push(totalPages);
            }
        }
        return pages;
    };

    // Open edit role modal
    const openEditModal = (user: UserData) => {
        setEditingUser(user);
        setEditRoles([...user.roles]);
        setEditAccountStatus(user.account_status);
        setEditFullName(user.full_name || '');
        setResetPasswordMessage(null);
    };

    // Toggle a role in the edit list
    const toggleEditRole = (role: string) => {
        setEditRoles(prev => {
            if (prev.includes(role)) {
                // Don't allow removing the last role
                if (prev.length === 1) return prev;
                return prev.filter(r => r !== role);
            } else {
                return [...prev, role];
            }
        });
    };

    // Select all roles
    const selectAllRoles = () => {
        setEditRoles([...ALL_ROLES]);
    };

    // Save role changes
    const handleSaveRoles = async () => {
        if (!editingUser || editRoles.length === 0) return;

        setIsSaving(true);
        try {
            const response = await fetch('/api/training-provider/update-user-roles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: editingUser.id,
                    roles: editRoles,
                    accountStatus: editAccountStatus,
                    currentUserId: currentUserId,
                    full_name: editFullName,
                }),
            });

            const result = await response.json();
            if (result.success) {
                // Update local state
                setUsers(prev =>
                    prev.map(u =>
                        u.id === editingUser.id ? { ...u, roles: editRoles, account_status: editAccountStatus, full_name: editFullName.trim() || u.full_name } : u
                    )
                );
                setEditingUser(null);
            } else {
                throw new Error(result.error || 'Failed to update roles');
            }
        } catch (err) {
            alert(`Failed to update roles: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setIsSaving(false);
        }
    };

    // Handle Hard Delete User
    const handleHardDeleteUser = async () => {
        if (!hardDeletingUser) return;
        setIsHardDeletingUser(true);
        try {
            const response = await fetch('/api/training-provider/hard-delete-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: hardDeletingUser.id }),
            });
            const result = await response.json();
            if (!result.success) throw new Error(result.message || 'Failed to delete user');
            await fetchUsers();
            setHardDeletingUser(null);
            alert('User permanently deleted.');
        } catch (err) {
            alert(`Failed to delete user: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setIsHardDeletingUser(false);
        }
    };

    // Handle Reset Password (admin resets user to default password)
    const [isResettingPassword, setIsResettingPassword] = useState(false);
    const [resetPasswordMessage, setResetPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const handleResetPassword = async (userId: string) => {
        if (!confirm('Are you sure you want to reset this user\'s password to the default password? They will be required to change it on next login.')) return;

        setIsResettingPassword(true);
        setResetPasswordMessage(null);
        try {
            const response = await fetch('/api/auth/admin-reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId }),
            });
            const result = await response.json();
            if (result.success) {
                setResetPasswordMessage({ type: 'success', text: result.message });
            } else {
                setResetPasswordMessage({ type: 'error', text: result.error || 'Failed to reset password' });
            }
        } catch (err) {
            setResetPasswordMessage({ type: 'error', text: 'Failed to reset password. Please try again.' });
        } finally {
            setIsResettingPassword(false);
            setTimeout(() => setResetPasswordMessage(null), 5000);
        }
    };

    // Handle Add User
    const handleAddUser = async () => {
        // Basic validation
        if (!newUser.full_name.trim() || !newUser.email.trim()) {
            alert('Please fill in all required fields (Name, Email).');
            return;
        }
        if (newUser.roles.length === 0) {
            alert('Please select at least one role.');
            return;
        }

        setIsAddingUser(true);
        try {
            // Real API call
            const payload = {
                ...newUser,
                password: 'default' // Default password from Company Settings will be applied server-side
            };

            const response = await fetch('/api/training-provider/add-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.message || 'Failed to add user');
            }

            // Success - refresh list
            await fetchUsers();

            setIsAddUserModalOpen(false);
            setNewUser({
                full_name: '',
                email: '',
                telephone: '',
                roles: ['Learner']
            });
            alert('User added successfully!');

        } catch (err) {
            alert(`Failed to add user: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setIsAddingUser(false);
        }
    };

    const toggleNewUserRole = (role: string) => {
        setNewUser(prev => {
            if (prev.roles.includes(role)) {
                // Don't allow removing the last role
                if (prev.roles.length === 1) return prev;
                return { ...prev, roles: prev.roles.filter(r => r !== role) };
            } else {
                return { ...prev, roles: [...prev.roles, role] };
            }
        });
    };

    // Check if user is last member of their organization
    const checkIfLastMember = async (userId: string) => {
        try {
            const response = await fetch(`/api/training-provider/check-last-member?userId=${userId}`);
            const result = await response.json();

            if (result.success) {
                setDeletingUserOrgInfo({
                    isLastMember: result.isLastMember,
                    companyName: result.companyName || '',
                    uen: result.uen || ''
                });
            }
        } catch (err) {
            console.error('Error checking last member status:', err);
            setDeletingUserOrgInfo(null);
        }
    };

    // Handle opening delete modal
    const handleOpenDeleteModal = async (user: UserData) => {
        setDeletingUser(user);
        // Check if this user is the last member of their organization
        if (user.roles.includes('Training Provider')) {
            await checkIfLastMember(user.id);
        }
    };

    // Handle Enable User (re-activate a disabled account)
    const handleEnableUser = async (user: UserData) => {
        try {
            const response = await fetch('/api/training-provider/update-user-roles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.id,
                    roles: user.roles,
                    accountStatus: 'active',
                    currentUserId,
                }),
            });
            const result = await response.json();
            if (!result.success) throw new Error(result.message || 'Failed to enable user');
            setUsers(prev => prev.map(u => u.id === user.id ? { ...u, account_status: 'active' } : u));
        } catch (err) {
            alert(`Failed to enable user: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    };

    // Handle Delete User
    const handleDeleteUser = async () => {
        if (!deletingUser) return;

        setIsDeletingUser(true);
        try {
            const response = await fetch('/api/training-provider/delete-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: deletingUser.id,
                }),
            });

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.message || 'Failed to delete user');
            }

            // Success - refresh list
            await fetchUsers();
            setDeletingUser(null);
            setDeletingUserOrgInfo(null);

            if (deletingUserOrgInfo?.isLastMember) {
                alert(`User deleted successfully!\n\nThe training provider organization "${deletingUserOrgInfo.companyName}" has been removed and UEN ${deletingUserOrgInfo.uen} is now available for reuse.`);
            } else {
                alert('User deleted successfully!');
            }

        } catch (err) {
            alert(`Failed to delete user: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setIsDeletingUser(false);
        }
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6">User Management</h2>


            {/* Search and Refresh Controls */}
            <Card className="p-4 sm:p-6 mb-6">
                <div className="flex flex-col gap-4">
                    <div className="w-full">
                        <label htmlFor="search-users" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                            Search Users
                        </label>
                        <input
                            id="search-users"
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search by name, email, or role..."
                            className={inputClasses}
                        />
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3 items-center flex-wrap">
                        <Button onClick={fetchUsers} disabled={isLoading} className="w-full sm:w-auto">
                            {isLoading ? (
                                <div className="flex items-center justify-center">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                    Loading...
                                </div>
                            ) : (
                                <>
                                    <Icon name={IconName.Download} className="w-4 h-4 mr-2" />
                                    Refresh
                                </>
                            )}
                        </Button>
                        <Button onClick={() => setIsAddUserModalOpen(true)} className="bg-green-600 hover:bg-green-700 w-full sm:w-auto">
                            <Icon name={IconName.Plus} className="w-4 h-4 mr-2" />
                            Add User
                        </Button>
                        <label className="flex items-center gap-2 text-sm font-medium text-on-surface cursor-pointer">
                            <input
                                type="checkbox"
                                checked={showActive}
                                onChange={(e) => { setShowActive(e.target.checked); setCurrentPage(1); }}
                                className="w-4 h-4 rounded border-default text-primary focus:ring-primary"
                            />
                            Active accounts
                        </label>
                        <label className="flex items-center gap-2 text-sm font-medium text-on-surface cursor-pointer">
                            <input
                                type="checkbox"
                                checked={showDisabled}
                                onChange={(e) => { setShowDisabled(e.target.checked); setCurrentPage(1); }}
                                className="w-4 h-4 rounded border-default text-primary focus:ring-primary"
                            />
                            Disabled accounts
                        </label>
                    </div>
                </div>
                {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
            </Card>

            {/* Loading State */}
            {isLoading && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600">Fetching users...</p>
                    </div>
                </div>
            )}

            {/* Results Table */}
            {!isLoading && (
                <Card className="p-0">
                    <div className="p-6 border-b">
                        <div>
                            <h3 className="text-xl font-bold">All Users</h3>
                            <p className="text-gray-500 mt-1">
                                Showing {sortedUsers.length > 0 ? startIndex + 1 : 0}-{Math.min(endIndex, sortedUsers.length)} of {sortedUsers.length} users
                                {(searchQuery || activeFilter) && ` (filtered from ${users.length} total)`}
                            </p>
                        </div>
                    </div>

                    {/* Toolbar - Filter, Sort */}
                    <div className="px-4 py-3 border-b bg-gray-50 dark:bg-gray-800 dark:border-gray-700 flex flex-wrap items-center gap-2">
                        {/* Filter Button */}
                        <div className="relative" ref={filterRef}>
                            <button
                                onClick={() => { setShowFilterDropdown(!showFilterDropdown); setShowSortDropdown(false); setShowRoleFilterDropdown(false); }}
                                className="inline-flex items-center px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
                            >
                                <Icon name={IconName.Eye} className="w-4 h-4 mr-1.5" />
                                Filter
                            </button>
                            {showFilterDropdown && (
                                <div className="absolute left-0 top-full mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 p-3">
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Column</label>
                                            <select
                                                value={filterColumn}
                                                onChange={(e) => setFilterColumn(e.target.value)}
                                                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
                                            >
                                                <option value="">Select column...</option>
                                                {filterableColumns.map(col => (
                                                    <option key={col.value} value={col.value}>{col.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Value</label>
                                            <input
                                                type="text"
                                                value={filterValue}
                                                onChange={(e) => setFilterValue(e.target.value)}
                                                placeholder="Enter a value..."
                                                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
                                            />
                                        </div>
                                        <button
                                            onClick={applyFilter}
                                            disabled={!filterColumn || !filterValue.trim()}
                                            className="w-full px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                                        >
                                            Apply filter
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Role Filter Button */}
                        <div className="relative" ref={roleFilterRef}>
                            <button
                                onClick={() => { setShowRoleFilterDropdown(!showRoleFilterDropdown); setShowFilterDropdown(false); setShowSortDropdown(false); }}
                                className={`inline-flex items-center px-3 py-1.5 text-sm border rounded bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors ${selectedRoleFilters.length > 0 ? 'border-blue-400 text-blue-700 dark:text-blue-300' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200'}`}
                            >
                                <Icon name={IconName.Users} className="w-4 h-4 mr-1.5" />
                                Roles
                                {selectedRoleFilters.length > 0 && (
                                    <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 text-xs font-bold bg-blue-500 text-white rounded-full">
                                        {selectedRoleFilters.length}
                                    </span>
                                )}
                            </button>
                            {showRoleFilterDropdown && (
                                <div className="absolute left-0 top-full mt-1 w-52 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 p-3">
                                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Filter by Role</p>
                                    <div className="space-y-1">
                                        {ALL_ROLES.map(role => {
                                            const badge = getRoleBadge(role);
                                            const checked = selectedRoleFilters.includes(role);
                                            return (
                                                <label key={role} className="flex items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => {
                                                            setSelectedRoleFilters(prev =>
                                                                checked ? prev.filter(r => r !== role) : [...prev, role]
                                                            );
                                                            setCurrentPage(1);
                                                        }}
                                                        className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                    />
                                                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-md border ${badge.classes}`}>
                                                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                                                        {role}
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                    {selectedRoleFilters.length > 0 && (
                                        <button
                                            onClick={() => { setSelectedRoleFilters([]); setCurrentPage(1); }}
                                            className="mt-2 w-full px-2 py-1 text-xs text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 border border-dashed border-gray-300 dark:border-gray-600 rounded hover:border-red-300 transition-colors"
                                        >
                                            Clear role filter
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Sort Button */}
                        <div className="relative" ref={sortRef}>
                            <button
                                onClick={() => { setShowSortDropdown(!showSortDropdown); setShowFilterDropdown(false); setShowRoleFilterDropdown(false); }}
                                className="inline-flex items-center px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
                            >
                                <Icon name={IconName.ChevronDown} className="w-4 h-4 mr-1.5" />
                                Sort
                            </button>
                            {showSortDropdown && (
                                <div className="absolute left-0 top-full mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 p-3">
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Column</label>
                                            <select
                                                value={sortColumn}
                                                onChange={(e) => setSortColumn(e.target.value)}
                                                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
                                            >
                                                <option value="">Default order</option>
                                                {filterableColumns.map(col => (
                                                    <option key={col.value} value={col.value}>{col.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => { setSortDirection('asc'); setShowSortDropdown(false); }}
                                                className={`flex-1 px-2 py-1 text-xs rounded border ${sortDirection === 'asc' ? 'bg-blue-100 dark:bg-blue-900 border-blue-400 dark:border-blue-600' : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600'} dark:text-gray-200`}
                                            >
                                                Ascending
                                            </button>
                                            <button
                                                onClick={() => { setSortDirection('desc'); setShowSortDropdown(false); }}
                                                className={`flex-1 px-2 py-1 text-xs rounded border ${sortDirection === 'desc' ? 'bg-blue-100 dark:bg-blue-900 border-blue-400 dark:border-blue-600' : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600'} dark:text-gray-200`}
                                            >
                                                Descending
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Active Filter Badge */}
                        {activeFilter && (
                            <div className="inline-flex items-center px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded border border-blue-200">
                                <span className="font-medium">{filterableColumns.find(c => c.value === activeFilter.column)?.label}:</span>
                                <span className="ml-1">{activeFilter.value}</span>
                                <button onClick={clearFilter} className="ml-1.5 hover:text-red-600">×</button>
                            </div>
                        )}
                    </div>

                    {paginatedUsers.length > 0 ? (
                        <>
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-600">
                                    <thead className="bg-gray-50 dark:bg-gray-800">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Full Name</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Email</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Roles</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Account Status</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white dark:bg-gray-700 divide-y divide-gray-200 dark:divide-gray-600">
                                        {paginatedUsers.map((user) => (
                                            <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-600">
                                                <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                                                    {user.full_name || 'N/A'}
                                                    {user.id === currentUserId && (
                                                        <span className="ml-2 inline-flex px-1.5 py-0.5 text-xs font-medium rounded bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-300">
                                                            You
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-200">
                                                    <div>{user.email || 'N/A'}</div>
                                                    {user.secondary_email && (
                                                        <div className="text-xs text-gray-400 dark:text-gray-400 mt-0.5">{user.secondary_email}</div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {user.roles && user.roles.length > 0 ? (
                                                            user.roles.length === ALL_ROLES.length ? (
                                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-700">
                                                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                                                                    All Roles
                                                                </span>
                                                            ) : (
                                                                user.roles.map((role) => {
                                                                    const badge = getRoleBadge(role);
                                                                    return (
                                                                        <span
                                                                            key={role}
                                                                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border ${badge.classes}`}
                                                                        >
                                                                            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                                                                            {role}
                                                                        </span>
                                                                    );
                                                                })
                                                            )
                                                        ) : (
                                                            <span className="text-gray-400 text-sm">No roles</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm">
                                                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${user.account_status === 'active'
                                                            ? 'bg-green-100 text-green-800 border-green-200'
                                                            : 'bg-red-100 text-red-800 border-red-200'
                                                        }`}>
                                                        {user.account_status === 'active' ? 'Active' : 'Disabled'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    {user.id === currentUserId ? (
                                                        <span className="text-xs text-gray-400 italic">Cannot edit self</span>
                                                    ) : (
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={() => openEditModal(user)}
                                                                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 border border-blue-300 dark:border-blue-600 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                                                            >
                                                                <Icon name={IconName.Edit} className="w-3.5 h-3.5" />
                                                                Edit
                                                            </button>
                                                            {user.account_status === 'active' ? (
                                                                <button
                                                                    onClick={() => handleOpenDeleteModal(user)}
                                                                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-yellow-700 hover:text-yellow-900 dark:text-yellow-400 dark:hover:text-yellow-300 border border-yellow-400 dark:border-yellow-600 rounded-md hover:bg-yellow-50 dark:hover:bg-yellow-900/30 transition-colors"
                                                                >
                                                                    <Icon name={IconName.Delete} className="w-3.5 h-3.5" />
                                                                    Disable
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    onClick={() => handleEnableUser(user)}
                                                                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-green-700 hover:text-green-900 dark:text-green-400 dark:hover:text-green-300 border border-green-400 dark:border-green-600 rounded-md hover:bg-green-50 dark:hover:bg-green-900/30 transition-colors"
                                                                >
                                                                    <Icon name={IconName.Check} className="w-3.5 h-3.5" />
                                                                    Enable
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => setHardDeletingUser(user)}
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

                            {/* Pagination Controls */}
                            {totalPages > 1 && (
                                <div className="p-4 border-t flex items-center justify-between">
                                    <div className="text-sm text-gray-500">
                                        Page {currentPage} of {totalPages}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => goToPage(currentPage - 1)}
                                            disabled={currentPage === 1}
                                            className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed dark:border-gray-600 dark:hover:bg-gray-700 dark:text-gray-200"
                                        >
                                            Previous
                                        </button>
                                        {getPageNumbers().map((page, idx) => (
                                            typeof page === 'number' ? (
                                                <button
                                                    key={idx}
                                                    onClick={() => goToPage(page)}
                                                    className={`px-3 py-1 text-sm border rounded ${currentPage === page
                                                        ? 'bg-blue-500 text-white border-blue-500'
                                                        : 'hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700 dark:text-gray-200'
                                                        }`}
                                                >
                                                    {page}
                                                </button>
                                            ) : (
                                                <span key={idx} className="px-2 text-gray-400">...</span>
                                            )
                                        ))}
                                        <button
                                            onClick={() => goToPage(currentPage + 1)}
                                            disabled={currentPage === totalPages}
                                            className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed dark:border-gray-600 dark:hover:bg-gray-700 dark:text-gray-200"
                                        >
                                            Next
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="p-12 text-center text-gray-500">
                            <Icon name={IconName.Users} className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                            <p className="text-lg font-medium">No users found</p>
                            <p className="text-sm mt-1">
                                {searchQuery || activeFilter
                                    ? 'Try adjusting your search or filter criteria.'
                                    : 'No users are registered in the system yet.'}
                            </p>
                        </div>
                    )}
                </Card>
            )}

            {/* Edit Role Modal */}
            {editingUser && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start sm:items-center justify-center z-50 overflow-y-auto p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-md mx-auto my-auto">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800 rounded-t-lg z-10">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Edit User</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                {editingUser.email}
                            </p>
                        </div>
                        <div className="p-6 overflow-y-auto max-h-[60vh]">
                            {/* Full Name */}
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full Name</label>
                                <input
                                    type="text"
                                    value={editFullName}
                                    onChange={(e) => setEditFullName(e.target.value)}
                                    className={inputClasses}
                                    placeholder="Enter full name"
                                />
                            </div>
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Select roles for this user:</p>
                            <div className="space-y-2">
                                {ALL_ROLES.map((role) => {
                                    const badge = getRoleBadge(role);
                                    return (
                                    <label
                                        key={role}
                                        className={`flex items-center p-3 rounded-lg border cursor-pointer transition-colors ${editRoles.includes(role)
                                            ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-600'
                                            : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                                            }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={editRoles.includes(role)}
                                            onChange={() => toggleEditRole(role)}
                                            className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                        />
                                        <span className={`ml-3 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border ${badge.classes}`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                                            {role}
                                        </span>
                                    </label>
                                    );
                                })}
                            </div>

                            {/* All Roles shortcut */}
                            <button
                                onClick={selectAllRoles}
                                className={`mt-3 w-full flex items-center justify-center p-3 rounded-lg border cursor-pointer transition-colors ${editRoles.length === ALL_ROLES.length
                                    ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 dark:border-indigo-600'
                                    : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                                    }`}
                            >
                                <span className="inline-flex px-2 py-0.5 text-xs font-semibold rounded-full border bg-indigo-100 text-indigo-800 border-indigo-200">
                                    All Roles (Full Privileges)
                                </span>
                            </button>

                            {editRoles.length === 0 && (
                                <p className="text-red-500 text-xs mt-2">At least one role must be selected.</p>
                            )}

                            {/* Reset Password */}
                            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Password</p>
                                {resetPasswordMessage && (
                                    <div className={`mb-3 p-3 rounded-lg text-sm ${resetPasswordMessage.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800'}`}>
                                        {resetPasswordMessage.text}
                                    </div>
                                )}
                                <button
                                    onClick={() => handleResetPassword(editingUser.id)}
                                    disabled={isResettingPassword}
                                    className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isResettingPassword ? (
                                        <>
                                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-600"></div>
                                            Resetting...
                                        </>
                                    ) : (
                                        <>
                                            <Icon name={IconName.Shield} className="w-4 h-4" />
                                            Reset to Default Password
                                        </>
                                    )}
                                </button>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                                    Resets password to the default and forces a change on next login.
                                </p>
                            </div>

                            {/* Account Status Toggle */}
                            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Account Status</p>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setEditAccountStatus('active')}
                                        className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border transition-colors ${editAccountStatus === 'active'
                                                ? 'border-green-400 bg-green-50 dark:bg-green-900/30 dark:border-green-600'
                                                : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                                            }`}
                                    >
                                        <span className="inline-flex px-2 py-0.5 text-xs font-semibold rounded-full border bg-green-100 text-green-800 border-green-200">
                                            Active
                                        </span>
                                    </button>
                                    <button
                                        onClick={() => setEditAccountStatus('disabled')}
                                        className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border transition-colors ${editAccountStatus === 'disabled'
                                                ? 'border-red-400 bg-red-50 dark:bg-red-900/30 dark:border-red-600'
                                                : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                                            }`}
                                    >
                                        <span className="inline-flex px-2 py-0.5 text-xs font-semibold rounded-full border bg-red-100 text-red-800 border-red-200">
                                            Disabled
                                        </span>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 sticky bottom-0 bg-white dark:bg-gray-800 rounded-b-lg">
                            <button
                                onClick={() => setEditingUser(null)}
                                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveRoles}
                                disabled={isSaving || editRoles.length === 0}
                                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors"
                            >
                                {isSaving ? (
                                    <div className="flex items-center">
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                        Saving...
                                    </div>
                                ) : (
                                    'Save Changes'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add User Modal */}
            {isAddUserModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-lg mx-4 my-8">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Add New User</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                Default password will be set from <strong>Company Settings</strong>
                            </p>
                        </div>
                        <div className="p-6 space-y-4">
                            {/* Full Name */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Full Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={newUser.full_name}
                                    onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
                                    className={inputClasses}
                                    placeholder="Enter full name"
                                />
                            </div>

                            {/* Email */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Email Address <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="email"
                                    value={newUser.email}
                                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                                    className={inputClasses}
                                    placeholder="user@example.com"
                                />
                            </div>

                            {/* Telephone */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Telephone Number
                                </label>
                                <input
                                    type="tel"
                                    value={newUser.telephone}
                                    onChange={(e) => setNewUser({ ...newUser, telephone: e.target.value })}
                                    className={inputClasses}
                                    placeholder="Enter telephone number"
                                />
                            </div>

                            {/* Roles */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Roles <span className="text-red-500">*</span>
                                </label>
                                <div className="space-y-1.5 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md p-3">
                                    {ALL_ROLES.map((role) => {
                                        const badge = getRoleBadge(role);
                                        return (
                                        <label
                                            key={role}
                                            className={`flex items-center p-2 rounded-lg cursor-pointer transition-colors ${newUser.roles.includes(role)
                                                ? 'bg-blue-50 dark:bg-blue-900/20'
                                                : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                                                }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={newUser.roles.includes(role)}
                                                onChange={() => toggleNewUserRole(role)}
                                                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                            />
                                            <span className={`ml-3 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border ${badge.classes}`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                                                {role}
                                            </span>
                                        </label>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                            <button
                                onClick={() => setIsAddUserModalOpen(false)}
                                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddUser}
                                disabled={isAddingUser}
                                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed transition-colors"
                            >
                                {isAddingUser ? (
                                    <div className="flex items-center">
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                        Adding...
                                    </div>
                                ) : (
                                    'Add User'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Disable User Confirmation Modal */}
            {deletingUser && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-md mx-4">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Disable User</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                This will prevent the user from logging in.
                            </p>
                        </div>
                        <div className="p-6">
                            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4">
                                <div className="flex items-start gap-3">
                                    <Icon name={IconName.InfoCircle} className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">
                                            Account will be disabled
                                        </p>
                                        <p className="text-sm text-yellow-700 dark:text-yellow-400 mt-1">
                                            <strong>{deletingUser.full_name}</strong> ({deletingUser.email}) will no longer be able to log in. Their data is preserved and can be re-enabled via Edit.
                                        </p>
                                        {deletingUserOrgInfo?.isLastMember && (
                                            <div className="mt-3 pt-3 border-t border-red-300 dark:border-red-700">
                                                <p className="text-sm font-semibold text-red-900 dark:text-red-200">
                                                    ⚠️ Last Member Warning
                                                </p>
                                                <p className="text-sm text-red-800 dark:text-red-300 mt-1">
                                                    This is the last user in <strong>{deletingUserOrgInfo.companyName}</strong>.
                                                    Deleting this user will also <strong>delete the entire training provider organization</strong> and
                                                    free up UEN <strong>{deletingUserOrgInfo.uen}</strong> for reuse.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                            <button
                                onClick={() => setDeletingUser(null)}
                                disabled={isDeletingUser}
                                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDeleteUser}
                                disabled={isDeletingUser}
                                className="px-4 py-2 text-sm font-medium text-white bg-yellow-600 rounded-lg hover:bg-yellow-700 disabled:bg-yellow-400 disabled:cursor-not-allowed transition-colors"
                            >
                                {isDeletingUser ? (
                                    <div className="flex items-center">
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                        Disabling...
                                    </div>
                                ) : (
                                    'Disable User'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Hard Delete User Confirmation Modal */}
            {hardDeletingUser && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-md mx-4">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Permanently Delete User</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                This cannot be undone.
                            </p>
                        </div>
                        <div className="p-6">
                            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                                <div className="flex items-start gap-3">
                                    <Icon name={IconName.InfoCircle} className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                                            All data will be permanently erased
                                        </p>
                                        <p className="text-sm text-red-700 dark:text-red-400 mt-1">
                                            <strong>{hardDeletingUser.full_name}</strong> ({hardDeletingUser.email}) and all associated records (roles, profiles, enrollments) will be deleted from the database.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                            <button
                                onClick={() => setHardDeletingUser(null)}
                                disabled={isHardDeletingUser}
                                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleHardDeleteUser}
                                disabled={isHardDeletingUser}
                                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:bg-red-400 disabled:cursor-not-allowed transition-colors"
                            >
                                {isHardDeletingUser ? (
                                    <div className="flex items-center">
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                        Deleting...
                                    </div>
                                ) : (
                                    <>
                                        <Icon name={IconName.Delete} className="w-4 h-4 inline mr-2" />
                                        Permanently Delete
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserManagementView;
