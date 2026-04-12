import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { useLms } from '../../contexts/LmsContext';
import { AdminPage } from '@app-types';

interface Ticket {
  id: string;
  ticket_number: string;
  subject: string;
  description: string;
  category: string;
  status: string;
  created_at: string;
  updated_at: string;
  learner_name: string;
  learner_email: string;
  reply_count: number;
}

const STATUS_STYLES: Record<string, string> = {
  Open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  'In Progress': 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  Resolved: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  Closed: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLES[status] || STATUS_STYLES['Open']}`}>
    {status}
  </span>
);

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const SupportTicketsView: React.FC = () => {
  const { setAdminPage, setSelectedCourseRunId } = useLms();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [searchTerm, setSearchTerm] = useState('');

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tickets/list?role=admin');
      const data = await res.json();
      if (data.success) setTickets(data.data);
    } catch (err) {
      console.error('Error fetching tickets:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const filteredTickets = tickets.filter(t => {
    const matchesStatus = statusFilter === 'All' || t.status === statusFilter;
    const term = searchTerm.toLowerCase();
    const matchesSearch = !term
      || t.ticket_number.toLowerCase().includes(term)
      || t.subject.toLowerCase().includes(term)
      || t.learner_name.toLowerCase().includes(term)
      || t.learner_email.toLowerCase().includes(term);
    return matchesStatus && matchesSearch;
  });

  const statusCounts = {
    All: tickets.length,
    Open: tickets.filter(t => t.status === 'Open').length,
    'In Progress': tickets.filter(t => t.status === 'In Progress').length,
    Resolved: tickets.filter(t => t.status === 'Resolved').length,
    Closed: tickets.filter(t => t.status === 'Closed').length,
  };

  const openTicketDetail = (ticketId: string) => {
    // Store the selected ticket ID and navigate to detail page
    setSelectedCourseRunId(ticketId); // reuse this state slot to pass the ticket id
    setAdminPage(AdminPage.SupportTicketDetail);
  };

  return (
    <div>
      <h2 className="text-3xl font-bold mb-6 dark:text-white">Support Tickets</h2>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {Object.entries(statusCounts).map(([status, count]) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`p-3 rounded-xl border text-center transition-all ${
              statusFilter === status
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-400 shadow-sm'
                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{count}</p>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{status}</p>
          </button>
        ))}
      </div>

      {/* Search */}
      <Card className="p-4 mb-4">
        <div className="relative">
          <Icon name={IconName.Search} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search by ticket #, subject, or learner name..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
          />
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="text-center py-16">
            <Icon name={IconName.Chat} className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">No tickets found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Ticket #</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Learner</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Subject</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden lg:table-cell">Category</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">Replies</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">Date</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map(ticket => (
                  <tr
                    key={ticket.id}
                    onClick={() => openTicketDetail(ticket.id)}
                    className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-blue-50/50 dark:hover:bg-slate-700/30 cursor-pointer transition"
                  >
                    <td className="py-3 px-4 text-sm font-mono text-blue-600 dark:text-blue-400 whitespace-nowrap">{ticket.ticket_number}</td>
                    <td className="py-3 px-4">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{ticket.learner_name}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{ticket.learner_email}</p>
                    </td>
                    <td className="py-3 px-4">
                      <p className="text-sm text-gray-800 dark:text-gray-200 truncate max-w-[250px]">{ticket.subject}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate max-w-[250px]">{ticket.description.substring(0, 60)}{ticket.description.length > 60 ? '...' : ''}</p>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400 hidden lg:table-cell">{ticket.category}</td>
                    <td className="py-3 px-4"><StatusBadge status={ticket.status} /></td>
                    <td className="py-3 px-4 text-sm text-gray-500 dark:text-gray-400 hidden md:table-cell text-center">{ticket.reply_count}</td>
                    <td className="py-3 px-4 text-sm text-gray-500 dark:text-gray-400 hidden md:table-cell whitespace-nowrap">{formatDate(ticket.created_at)}</td>
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

export default SupportTicketsView;
