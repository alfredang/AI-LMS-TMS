import React, { useState, useEffect, useCallback } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Icon, IconName } from './ui/Icon';
import { useLms } from '../contexts/LmsContext';

interface Ticket {
  id: string;
  ticket_number: string;
  subject: string;
  description: string;
  category: string;
  status: string;
  created_at: string;
  updated_at: string;
  reply_count: number;
}

interface TicketReply {
  id: string;
  user_id: string;
  user_role: string;
  user_name: string;
  message: string;
  created_at: string;
}

interface TicketDetail {
  ticket: Ticket & { learner_name: string; learner_email: string };
  replies: TicketReply[];
}

const CATEGORIES = ['General', 'Course', 'Payment', 'Technical', 'LMS', 'TMS', 'Courseware', 'Certificate', 'Claim', 'Other'];

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

// ── New Ticket Modal ─────────────────────────────────────
const NewTicketModal: React.FC<{ onClose: () => void; onCreated: () => void; userId: string }> = ({ onClose, onCreated, userId }) => {
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('General');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !description.trim()) {
      setError('Please fill in all required fields.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/tickets/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, subject: subject.trim(), description: description.trim(), category }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Failed to create ticket');
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      {/* Modal */}
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-600 to-indigo-600">
          <h3 className="text-lg font-bold text-white">Raise a New Ticket</h3>
          <button onClick={onClose} className="text-white/80 hover:text-white">
            <Icon name={IconName.Close} className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-2.5 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Subject <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Brief summary of your issue"
              className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
              maxLength={200}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Category</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Description <span className="text-red-500">*</span></label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe your issue in detail..."
              rows={5}
              className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" type="button" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit Ticket'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Ticket Detail Inline View ────────────────────────────
const TicketDetailView: React.FC<{ ticketId: string; userId: string; onBack: () => void }> = ({ ticketId, userId, onBack }) => {
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/tickets/detail?ticketId=${ticketId}`);
      const data = await res.json();
      if (data.success) setDetail(data.data);
    } catch (err) {
      console.error('Error fetching ticket detail:', err);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const handleSendReply = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      const res = await fetch('/api/tickets/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, userId, userRole: 'learner', message: replyText.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setReplyText('');
        fetchDetail();
      }
    } catch (err) {
      console.error('Error sending reply:', err);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!detail) return <p className="text-gray-500 text-center py-8">Ticket not found.</p>;

  const { ticket, replies } = detail;

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button onClick={onBack} className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition">
        <Icon name={IconName.Back} className="w-4 h-4" />
        Back to All Tickets
      </button>

      {/* Ticket header */}
      <Card className="p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
          <div>
            <p className="text-xs font-mono text-gray-400 dark:text-gray-500">{ticket.ticket_number}</p>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mt-1">{ticket.subject}</h3>
          </div>
          <StatusBadge status={ticket.status} />
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-gray-500 dark:text-gray-400 mb-4">
          <span>📁 {ticket.category}</span>
          <span>📅 {formatDate(ticket.created_at)}</span>
        </div>
        <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-4">
          <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{ticket.description}</p>
        </div>
      </Card>

      {/* Replies thread */}
      <Card className="p-6">
        <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
          Conversation {replies.length > 0 && <span className="text-gray-400 font-normal text-sm">({replies.length})</span>}
        </h4>

        {replies.length === 0 ? (
          <p className="text-gray-400 dark:text-gray-500 text-sm text-center py-6">No replies yet. Our team will get back to you soon.</p>
        ) : (
          <div className="space-y-4 mb-6">
            {replies.map(reply => {
              const isAdmin = reply.user_role === 'admin';
              return (
                <div key={reply.id} className={`flex ${isAdmin ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    isAdmin
                      ? 'bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800'
                      : 'bg-gray-100 dark:bg-slate-700 border border-gray-200 dark:border-slate-600'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-bold ${isAdmin ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'}`}>
                        {isAdmin ? '🛡️ Admin' : '👤 You'} · {reply.user_name}
                      </span>
                    </div>
                    <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{reply.message}</p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5 text-right">{formatDate(reply.created_at)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Reply input — only if ticket is not Closed */}
        {ticket.status !== 'Closed' && (
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <textarea
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              placeholder="Type your reply..."
              rows={3}
              className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition resize-none"
            />
            <div className="flex justify-end mt-2">
              <Button onClick={handleSendReply} disabled={sending || !replyText.trim()} size="sm">
                <Icon name={IconName.Send} className="w-4 h-4 mr-1.5" />
                {sending ? 'Sending...' : 'Send Reply'}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

// ── Main Component ──────────────────────────────────────
const HelpAndSupportView: React.FC = () => {
  const { currentUser } = useLms();
  const userId = currentUser?.id || '';

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const fetchTickets = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tickets/list?userId=${userId}`);
      const data = await res.json();
      if (data.success) setTickets(data.data);
    } catch (err) {
      console.error('Error fetching tickets:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  // Ticket detail view
  if (selectedTicketId) {
    return (
      <div>
        <h2 className="text-3xl font-bold mb-6">Help & Support</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          <div className="lg:col-span-1">
            <ContactCard />
          </div>
          <div className="lg:col-span-2">
            <TicketDetailView ticketId={selectedTicketId} userId={userId} onBack={() => { setSelectedTicketId(null); fetchTickets(); }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-3xl font-bold mb-6">Help & Support</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left Column: Contact Info */}
        <div className="lg:col-span-1">
          <ContactCard />
        </div>

        {/* Right Column: Tickets */}
        <div className="lg:col-span-2">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">All Tickets</h3>
              <Button onClick={() => setShowModal(true)} size="sm">
                <Icon name={IconName.Add} className="w-4 h-4 mr-1.5" />
                Raise a New Ticket
              </Button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
              </div>
            ) : tickets.length === 0 ? (
              <div className="text-center py-12 px-6 bg-gray-50 dark:bg-slate-700/30 rounded-lg">
                <Icon name={IconName.Chat} className="w-24 h-24 mx-auto mb-6 text-primary" />
                <h4 className="text-xl font-bold text-on-surface">Need assistance?</h4>
                <p className="mt-1 font-semibold text-on-surface">Go ahead and raise your first ticket</p>
                <p className="mt-2 text-subtle max-w-md mx-auto">
                  Our team will address any issues related to the course, connectivity, sessions, payments and more.
                </p>
                <Button className="mt-6" onClick={() => setShowModal(true)}>
                  Raise a New Ticket
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Ticket #</th>
                      <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Subject</th>
                      <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">Category</th>
                      <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                      <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map(ticket => (
                      <tr
                        key={ticket.id}
                        onClick={() => setSelectedTicketId(ticket.id)}
                        className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-slate-700/30 cursor-pointer transition"
                      >
                        <td className="py-3 px-3 text-sm font-mono text-blue-600 dark:text-blue-400">{ticket.ticket_number}</td>
                        <td className="py-3 px-3">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate max-w-[200px]">{ticket.subject}</p>
                          {Number(ticket.reply_count) > 0 && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{ticket.reply_count} {Number(ticket.reply_count) === 1 ? 'reply' : 'replies'}</p>
                          )}
                        </td>
                        <td className="py-3 px-3 text-sm text-gray-600 dark:text-gray-400 hidden sm:table-cell">{ticket.category}</td>
                        <td className="py-3 px-3"><StatusBadge status={ticket.status} /></td>
                        <td className="py-3 px-3 text-sm text-gray-500 dark:text-gray-400 hidden md:table-cell whitespace-nowrap">{formatDate(ticket.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <NewTicketModal
          userId={userId}
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); fetchTickets(); }}
        />
      )}
    </div>
  );
};

// ── Contact Info Card (extracted from original) ──────────
const InfoItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="text-sm font-semibold text-subtle">{label}</p>
    <p className="text-on-surface">{value}</p>
  </div>
);

const ContactCard: React.FC = () => (
  <Card className="p-6">
    <h3 className="text-xl font-bold mb-4">Contact Information</h3>
    <div className="space-y-4">
      <InfoItem label="Company Address" value="12 Woodland Square #07-85/86/87 Woods Square Tower 1, Singapore 737715" />
      <InfoItem label="Opening Hours" value="Mon - Fri, 9:00 AM - 6:00 PM" />
      <InfoItem label="Hotline Tel" value="+65 6100 0613" />
      <InfoItem label="Support Email" value="enquiry@tertiaryinfotech.com" />
    </div>
  </Card>
);

export default HelpAndSupportView;