import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';

const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

const ALL_ROLES = ['Learner', 'Trainer', 'Developer', 'Admin', 'Training Provider'] as const;

// Role badge colors
const getRoleBadgeColor = (role: string) => {
    switch (role) {
        case 'Admin':
            return 'bg-red-100 text-red-800 border-red-200';
        case 'Training Provider':
            return 'bg-purple-100 text-purple-800 border-purple-200';
        case 'Developer':
            return 'bg-blue-100 text-blue-800 border-blue-200';
        case 'Trainer':
            return 'bg-green-100 text-green-800 border-green-200';
        case 'Learner':
            return 'bg-yellow-100 text-yellow-800 border-yellow-200';
        default:
            return 'bg-gray-100 text-gray-800 border-gray-200';
    }
};

interface UserData {
    id: string;
    email: string;
    full_name: string;
    created_at: string;
    roles: string[];
}

const UserManagementView: React.FC = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [users, setUsers] = useState<UserData[]>([]);
    const [error, setError] = useState<string | null>(null);
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

    // Edit role modal state
    const [editingUser, setEditingUser] = useState<UserData | null>(null);
    const [editRoles, setEditRoles] = useState<string[]>([]);
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

    const filterableColumns = [
        { value: 'full_name', label: 'Full Name' },
        { value: 'email', label: 'Email' },
        { value: 'roles', label: 'Role' },
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
                }),
            });

            const result = await response.json();
            if (result.success) {
                // Update local state
                setUsers(prev =>
                    prev.map(u =>
                        u.id === editingUser.id ? { ...u, roles: editRoles } : u
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

    // Handle Add User
    const handleAddUser = async () => {
        // Basic validation
        if (!newUser.full_name.trim() || !newUser.email.trim() || !newUser.telephone.trim()) {
            alert('Please fill in all required fields (Name, Email, Telephone).');
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
                password: 'password123' // Default password per requirement
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

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6">User Management</h2>

            {/* Search and Refresh Controls */}
            <Card className="p-6 mb-6">
                <div className="flex flex-col md:flex-row gap-4 items-end">
                    <div className="flex-1">
                        <label htmlFor="search-users" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
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
                    <Button onClick={fetchUsers} disabled={isLoading}>
                        {isLoading ? (
                            <div className="flex items-center">
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
                    <Button onClick={() => setIsAddUserModalOpen(true)} className="bg-green-600 hover:bg-green-700">
                        <Icon name={IconName.Plus} className="w-4 h-4 mr-2" />
                        Add User
                    </Button>
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
                        <div className="relative">
                            <button
                                onClick={() => { setShowFilterDropdown(!showFilterDropdown); setShowSortDropdown(false); }}
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

                        {/* Sort Button */}
                        <div className="relative">
                            <button
                                onClick={() => { setShowSortDropdown(!showSortDropdown); setShowFilterDropdown(false); }}
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
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Created At</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white dark:bg-gray-700 divide-y divide-gray-200 dark:divide-gray-600">
                                        {paginatedUsers.map((user) => (
                                            <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-600">
                                                <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                                                    {user.full_name || 'N/A'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                    {user.email || 'N/A'}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex flex-wrap gap-1">
                                                        {user.roles && user.roles.length > 0 ? (
                                                            user.roles.length === ALL_ROLES.length ? (
                                                                <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full border bg-indigo-100 text-indigo-800 border-indigo-200">
                                                                    All Roles
                                                                </span>
                                                            ) : (
                                                                user.roles.map((role) => (
                                                                    <span
                                                                        key={role}
                                                                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getRoleBadgeColor(role)}`}
                                                                    >
                                                                        {role}
                                                                    </span>
                                                                ))
                                                            )
                                                        ) : (
                                                            <span className="text-gray-400 text-sm">No roles</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                    {user.created_at ? new Date(user.created_at).toLocaleDateString('en-GB') : 'N/A'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    <button
                                                        onClick={() => openEditModal(user)}
                                                        className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 border border-blue-300 dark:border-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                                                    >
                                                        <Icon name={IconName.Edit} className="w-4 h-4 mr-1" />
                                                        Edit Roles
                                                    </button>
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
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-md mx-4">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Edit User Roles</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                {editingUser.full_name} ({editingUser.email})
                            </p>
                        </div>
                        <div className="p-6">
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Select roles for this user:</p>
                            <div className="space-y-2">
                                {ALL_ROLES.map((role) => (
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
                                        <span className={`ml-3 inline-flex px-2 py-0.5 text-xs font-semibold rounded-full border ${getRoleBadgeColor(role)}`}>
                                            {role}
                                        </span>
                                    </label>
                                ))}
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
                        </div>
                        <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
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
                                Default password will be set to: <strong>password123</strong>
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
                                    Telephone Number <span className="text-red-500">*</span>
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
                                <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md p-3">
                                    {ALL_ROLES.map((role) => (
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
                                            <span className={`ml-3 inline-flex px-2 py-0.5 text-xs font-semibold rounded-full border ${getRoleBadgeColor(role)}`}>
                                                {role}
                                            </span>
                                        </label>
                                    ))}
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
        </div>
    );
};

export default UserManagementView;
