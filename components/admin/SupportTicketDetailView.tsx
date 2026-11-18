import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { useLms } from '../../contexts/LmsContext';
import { AdminPage } from '@app-types';

interface TicketReply {
  id: string;
  user_id: string;
  user_role: string;
  user_name: string;
  message: string;
  created_at: string;
}

interface TicketFull {
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
}

const STATUS_STYLES: Record<string, string> = {
  Open: 'bg-info-bg text-primary',
  'In Progress': 'bg-warning-bg text-warning',
  Resolved: 'bg-success-bg text-success',
  Closed: 'bg-surface-elevated text-muted',
};

const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];

const StatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLES[status] || STATUS_STYLES['Open']}`}>
    {status}
  </span>
);

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const SupportTicketDetailView: React.FC = () => {
  const { currentUser, selectedCourseRunId, setAdminPage } = useLms();
  const ticketId = selectedCourseRunId; // reused state slot
  const adminUserId = currentUser?.id || '';

  const [ticket, setTicket] = useState<TicketFull | null>(null);
  const [replies, setReplies] = useState<TicketReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (!ticketId) return;
    try {
      const res = await fetch(`/api/tickets/detail?ticketId=${ticketId}`);
      const data = await res.json();
      if (data.success) {
        setTicket(data.data.ticket);
        setReplies(data.data.replies);
      }
    } catch (err) {
      console.error('Error fetching ticket detail:', err);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const handleSendReply = async () => {
    if (!replyText.trim() || !ticketId) return;
    setSending(true);
    try {
      const res = await fetch('/api/tickets/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, userId: adminUserId, userRole: 'admin', message: replyText.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setReplyText('');
        fetchDetail(); // refresh
      }
    } catch (err) {
      console.error('Error sending reply:', err);
    } finally {
      setSending(false);
    }
  };

  const handleStatusUpdate = async (newStatus: string) => {
    if (!ticketId) return;
    setStatusUpdating(true);
    try {
      const res = await fetch('/api/tickets/update-status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, status: newStatus }),
      });
      const data = await res.json();
      if (data.success) {
        setTicket(prev => prev ? { ...prev, status: newStatus } : prev);
      }
    } catch (err) {
      console.error('Error updating status:', err);
    } finally {
      setStatusUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="text-center py-16">
        <p className="text-muted">Ticket not found.</p>
        <Button className="mt-4" onClick={() => setAdminPage(AdminPage.SupportTickets)}>Back to Tickets</Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back navigation */}
      <button
        onClick={() => setAdminPage(AdminPage.SupportTickets)}
        className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary mb-6 transition"
      >
        <Icon name={IconName.Back} className="w-4 h-4" />
        Back to All Tickets
      </button>

      {/* Ticket info */}
      <Card className="p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
          <div className="flex-1">
            <p className="text-xs font-mono text-muted mb-1">{ticket.ticket_number}</p>
            <h3 className="text-2xl font-bold text-on-surface">{ticket.subject}</h3>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={ticket.status} />
            {/* Status selector */}
            <select
              value={ticket.status}
              onChange={e => handleStatusUpdate(e.target.value)}
              disabled={statusUpdating}
              className="text-sm border border-strong rounded-lg px-3 py-1.5 bg-surface text-on-surface-secondary focus:ring-2 focus:ring-blue-500 outline-none"
            >
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Meta info */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="bg-surface-elevated rounded-lg p-3">
            <p className="text-xs text-muted font-medium">Learner</p>
            <p className="text-sm font-semibold text-on-surface">{ticket.learner_name}</p>
          </div>
          <div className="bg-surface-elevated rounded-lg p-3">
            <p className="text-xs text-muted font-medium">Email</p>
            <p className="text-sm text-on-surface truncate">{ticket.learner_email}</p>
          </div>
          <div className="bg-surface-elevated rounded-lg p-3">
            <p className="text-xs text-muted font-medium">Category</p>
            <p className="text-sm font-semibold text-on-surface">{ticket.category}</p>
          </div>
          <div className="bg-surface-elevated rounded-lg p-3">
            <p className="text-xs text-muted font-medium">Created</p>
            <p className="text-sm text-on-surface">{formatDate(ticket.created_at)}</p>
          </div>
        </div>

        {/* Full description */}
        <div>
          <h4 className="text-sm font-semibold text-muted uppercase tracking-wider mb-2">Issue Description</h4>
          <div className="bg-surface-elevated rounded-lg p-4 border border-default">
            <p className="text-on-surface-secondary whitespace-pre-wrap leading-relaxed">{ticket.description}</p>
          </div>
        </div>
      </Card>

      {/* Conversation thread */}
      <Card className="p-6">
        <h4 className="text-lg font-bold text-on-surface mb-5">
          Conversation Thread {replies.length > 0 && <span className="text-muted font-normal text-sm">({replies.length})</span>}
        </h4>

        {replies.length === 0 ? (
          <div className="text-center py-8 bg-surface-elevated rounded-lg mb-6">
            <Icon name={IconName.Chat} className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p className="text-muted text-sm">No replies yet. Be the first to respond.</p>
          </div>
        ) : (
          <div className="space-y-4 mb-6">
            {replies.map(reply => {
              const isAdmin = reply.user_role === 'admin';
              return (
                <div key={reply.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    isAdmin
                      ? 'bg-info-bg border border-blue-100 dark:border-blue-800'
                      : 'bg-surface-elevated border border-default'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-bold ${isAdmin ? 'text-primary' : 'text-on-surface-secondary'}`}>
                        {isAdmin ? '🛡️ Admin' : '👤 Learner'} · {reply.user_name}
                      </span>
                    </div>
                    <p className="text-sm text-on-surface whitespace-pre-wrap">{reply.message}</p>
                    <p className="text-[10px] text-muted mt-1.5 text-right">{formatDate(reply.created_at)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Admin reply input */}
        <div className="border-t border-default pt-5">
          <label className="block text-sm font-semibold text-on-surface-secondary mb-2">Reply as Admin</label>
          <textarea
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            placeholder="Type your reply to the learner..."
            rows={4}
            className="w-full px-4 py-3 border border-strong rounded-lg bg-surface text-on-surface focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition resize-none"
          />
          <div className="flex justify-end mt-3">
            <Button onClick={handleSendReply} disabled={sending || !replyText.trim()}>
              <Icon name={IconName.Send} className="w-4 h-4 mr-1.5" />
              {sending ? 'Sending...' : 'Send Reply'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default SupportTicketDetailView;
