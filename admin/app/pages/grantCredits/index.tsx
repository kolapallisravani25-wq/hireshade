import { useState, useCallback } from 'react';
import { TablePage, Modal, useCallProcedure } from '@kottster/react';
import { Plus, Check, AlertTriangle } from 'lucide-react';
import type { Procedures } from './api.server';
import type { GrantCreditRow, AssignCreditResult } from '../../types/creditTypes';

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(dateStr); }
};

const formatCredits = (val: string | number | null | undefined): string => {
  if (val === null || val === undefined) return '0.00';
  const n = typeof val === 'string' ? parseFloat(val) : val;
  return isNaN(n) ? '0.00' : n.toFixed(2);
};

function ViewField({ label, value }: { label: string; value: any }) {
  return (
    <div
      className="py-3 border-b border-b-[color:var(--mantine-color-default-border)] last:border-b-0"
      style={{ fontFamily: 'var(--mantine-font-family)' }}
    >
      <div
        className="uppercase tracking-wide font-medium mb-0.5"
        style={{
          fontSize: 'var(--mantine-font-size-xs)',
          color: 'var(--mantine-color-dimmed)',
        }}
      >
        {label}
      </div>
      <div
        className="font-medium break-all"
        style={{
          fontSize: 'var(--mantine-font-size-sm)',
          color: 'var(--mantine-color-text)',
        }}
      >
        {value != null && value !== '' ? String(value) : (
          <span style={{ color: 'var(--mantine-color-dimmed)' }}>—</span>
        )}
      </div>
    </div>
  );
}

function toLabel(key: string) {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const SKIP_FIELDS = new Set<string>([]);

export default function GrantCreditsPage() {
  const callProcedure = useCallProcedure<Procedures>();

  const [viewRecord, setViewRecord] = useState<any>(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<GrantCreditRow | null>(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState<AssignCreditResult | null>(null);

  const openAssignModal = useCallback((user: GrantCreditRow) => {
    setSelectedUser(user);
    setCreditAmount('');
    setAssignError(null);
    setAssignSuccess(null);
    setAssignModalOpen(true);
  }, []);

  const closeAssignModal = useCallback(() => {
    setAssignModalOpen(false);
    setSelectedUser(null);
    setCreditAmount('');
    setAssignError(null);
    setAssignSuccess(null);
  }, []);

  const handleAssign = useCallback(async () => {
    if (!selectedUser) return;
    const parsed = parseFloat(creditAmount);
    if (isNaN(parsed) || parsed <= 0) {
      setAssignError('Please enter a valid positive number.');
      return;
    }
    setAssigning(true);
    setAssignError(null);
    try {
      const result = await callProcedure('assignCredit', {
        userId: selectedUser.userId,
        amount: parsed,
      });
      if (result && typeof result === 'object' && 'success' in result) {
        setAssignSuccess(result as AssignCreditResult);
      }
    } catch (err: unknown) {
      setAssignError(err instanceof Error ? err.message : 'Failed to assign credits');
    } finally {
      setAssigning(false);
    }
  }, [callProcedure, creditAmount, selectedUser]);

  const VIEW_FIELD_ORDER = ['userId', 'name', 'email', 'createdAt', 'totalAvailable'];

  const viewFields = (record: any) => {
    if (!record) return [];
    const ordered = VIEW_FIELD_ORDER.filter((k) => k in record);
    const rest = Object.keys(record).filter(
      (k) => !ordered.includes(k) && !SKIP_FIELDS.has(k)
    );
    return [...ordered, ...rest];
  };

  return (
    <>
      <TablePage
        title="Grant Credits"
        withSearch={true}

        customActions={[
          {
            label: 'View',
            onClick: (record) => setViewRecord(record),
          },
          {
            label: 'Assign Credit',
            onClick: (record) => openAssignModal(record as unknown as GrantCreditRow),
          },
        ]}

        columnOverrides={{
          
          userId: (col) => ({ ...col, hidden: true, hiddenInTable: true }),

          name: (col) => ({
            ...col,
            label: 'User',
            render: (record) => (
              <a
                href={`/users?search=${encodeURIComponent((record.email as string) || (record.userId as string))}`}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                style={{ textDecoration: 'none' }}
              >
                <div
                  className="size-7 rounded-full bg-[var(--mantine-color-default)] border border-[color:var(--mantine-color-default-border)] flex items-center justify-center shrink-0 font-semibold"
                  style={{
                    fontSize: 'var(--mantine-font-size-xs)',
                    color: 'var(--mantine-color-dimmed)',
                    fontFamily: 'var(--mantine-font-family)',
                  }}
                >
                  {((record.name as string) || (record.email as string) || 'U')[0].toUpperCase()}
                </div>
                <div>
                  <div
                    className="font-medium"
                    style={{
                      fontSize: 'var(--mantine-font-size-sm)',
                      color: 'var(--mantine-color-text)',
                      fontFamily: 'var(--mantine-font-family)',
                    }}
                  >
                    {(record.name as string) || 'Anonymous'}
                  </div>
                  <div
                    style={{
                      fontSize: 'var(--mantine-font-size-xs)',
                      color: 'var(--mantine-color-dimmed)',
                      fontFamily: 'var(--mantine-font-family)',
                    }}
                  >
                    {record.email as string}
                  </div>
                </div>
              </a>
            ),
          }),

          
          email: (col) => ({ ...col, hidden: true, hiddenInTable: true }),

          createdAt: (col) => ({
            ...col,
            label: 'Joined',
            render: (record) => (
              <span
                style={{
                  fontSize: 'var(--mantine-font-size-sm)',
                  color: 'var(--mantine-color-dimmed)',
                  fontFamily: 'var(--mantine-font-family)',
                }}
              >
                {formatDate(record.createdAt as string)}
              </span>
            ),
          }),

          purchasedCredits: (col) => ({
            ...col,
            label: 'Purchased',
            render: (record) => (
              <span
                style={{
                  fontSize: 'var(--mantine-font-size-sm)',
                  color: 'var(--mantine-color-dimmed)',
                  fontFamily: 'var(--mantine-font-family)',
                }}
              >
                {formatCredits(record.purchasedCredits as string)}
              </span>
            ),
          }),

          earnedCredits: (col) => ({
            ...col,
            label: 'Earned',
            render: (record) => (
              <span
                style={{
                  fontSize: 'var(--mantine-font-size-sm)',
                  color: 'var(--mantine-color-dimmed)',
                  fontFamily: 'var(--mantine-font-family)',
                }}
              >
                {formatCredits(record.earnedCredits as string)}
              </span>
            ),
          }),

          heldCredits: (col) => ({
            ...col,
            label: 'Held',
            render: (record) => (
              <span
                style={{
                  fontSize: 'var(--mantine-font-size-sm)',
                  color: 'var(--mantine-color-dimmed)',
                  fontFamily: 'var(--mantine-font-family)',
                }}
              >
                {formatCredits(record.heldCredits as string)}
              </span>
            ),
          }),

          totalAvailable: (col) => ({
            ...col,
            label: 'Available',
            render: (record) => {
              const val = parseFloat(String(record.totalAvailable ?? 0));
              return (
                <span
                  className={`inline-flex items-center rounded px-2 py-0.5 font-medium border ${
                    val > 0
                      ? 'bg-[var(--mantine-color-green-light)] text-[color:var(--mantine-color-green-text)] border-[color:var(--mantine-color-green-light-hover)]'
                      : 'bg-[var(--mantine-color-gray-light)] text-[color:var(--mantine-color-dimmed)] border-[color:var(--mantine-color-default-border)]'
                  }`}
                  style={{
                    fontSize: 'var(--mantine-font-size-xs)',
                    fontFamily: 'var(--mantine-font-family)',
                  }}
                >
                  {formatCredits(record.totalAvailable as string)}
                </span>
              );
            },
          }),

          lastUpdated: (col) => ({
            ...col,
            label: 'Last Updated',
            render: (record) => (
              <span
                style={{
                  fontSize: 'var(--mantine-font-size-xs)',
                  color: 'var(--mantine-color-dimmed)',
                  fontFamily: 'var(--mantine-font-family)',
                }}
              >
                {formatDate(record.lastUpdated as string | null)}
              </span>
            ),
          }),
        }}
      />

      {viewRecord && (
        <Modal
          title="View record"
          isOpen={!!viewRecord}
          onClose={() => setViewRecord(null)}
          closeOnBackdropClick
          className="!w-full sm:!w-[520px]"
        >
          <div style={{ fontFamily: 'var(--mantine-font-family)' }}>
            {viewFields(viewRecord).map((key) => {
              let raw = viewRecord[key];
              let display: string;
              if (key === 'createdAt' || key === 'updatedAt' || key.endsWith('At') || key === 'lastUpdated') {
                display = formatDate(raw);
              } else if (key.endsWith('Credits') || key === 'totalAvailable') {
                display = formatCredits(raw);
              } else {
                display = raw;
              }
              return (
                <ViewField
                  key={key}
                  label={toLabel(key)}
                  value={display}
                />
              );
            })}
          </div>
        </Modal>
      )}

      {assignModalOpen && selectedUser && (
        <Modal
          title={`Assign Credits — ${selectedUser.name || selectedUser.email}`}
          isOpen={assignModalOpen}
          onClose={closeAssignModal}
          closeOnBackdropClick
          className="!w-full sm:!w-[480px]"
        >
          {assignSuccess ? (
            <div className="flex flex-col items-center gap-4 py-6">
              <div
                className="flex items-center justify-center rounded-full size-12 bg-[var(--mantine-color-green-light)] text-[color:var(--mantine-color-green-text)]"
              >
                <Check size={24} />
              </div>
              <div className="text-center">
                <div
                  className="font-medium"
                  style={{
                    fontSize: 'var(--mantine-font-size-sm)',
                    color: 'var(--mantine-color-text)',
                    fontFamily: 'var(--mantine-font-family)',
                  }}
                >
                  Credits assigned successfully
                </div>
                <div
                  className="mt-1"
                  style={{
                    fontSize: 'var(--mantine-font-size-xs)',
                    color: 'var(--mantine-color-dimmed)',
                    fontFamily: 'var(--mantine-font-family)',
                  }}
                >
                  New earned: {assignSuccess.newEarnedCredits} · New available: {assignSuccess.newTotalAvailable}
                </div>
              </div>
              <button
                onClick={closeAssignModal}
                className="rounded-md px-4 py-2 font-medium cursor-pointer border border-[color:var(--mantine-color-default-border)] bg-[var(--mantine-color-default)] text-[color:var(--mantine-color-text)]"
                style={{
                  fontSize: 'var(--mantine-font-size-xs)',
                  fontFamily: 'var(--mantine-font-family)',
                }}
              >
                Close
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4" style={{ fontFamily: 'var(--mantine-font-family)' }}>

              <div className="grid grid-cols-2 gap-2">
                {([
                  { label: 'Purchased', value: formatCredits(selectedUser.purchasedCredits) },
                  { label: 'Earned',    value: formatCredits(selectedUser.earnedCredits) },
                  { label: 'Held',      value: formatCredits(selectedUser.heldCredits) },
                  { label: 'Available', value: formatCredits(selectedUser.totalAvailable) },
                ] as const).map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg p-3 border border-[color:var(--mantine-color-default-border)] bg-[var(--mantine-color-default)]"
                  >
                    <div
                      className="uppercase tracking-wide font-medium mb-1"
                      style={{
                        fontSize: 'var(--mantine-font-size-xs)',
                        color: 'var(--mantine-color-dimmed)',
                      }}
                    >
                      {item.label}
                    </div>
                    <div
                      className="font-medium"
                      style={{
                        fontSize: 'var(--mantine-font-size-sm)',
                        color: 'var(--mantine-color-text)',
                      }}
                    >
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <label
                  className="block font-medium mb-1.5"
                  style={{
                    fontSize: 'var(--mantine-font-size-xs)',
                    color: 'var(--mantine-color-text)',
                  }}
                >
                  Credits to assign
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="Enter amount (e.g. 50)"
                  value={creditAmount}
                  onChange={(e) => { setCreditAmount(e.target.value); setAssignError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAssign(); }}
                  className={`w-full rounded-md px-3 py-2 outline-none bg-[var(--mantine-color-default)] text-[color:var(--mantine-color-text)] border ${
                    assignError
                      ? 'border-[color:var(--mantine-color-red-text)]'
                      : 'border-[color:var(--mantine-color-default-border)]'
                  }`}
                  style={{
                    fontSize: 'var(--mantine-font-size-sm)',
                    fontFamily: 'var(--mantine-font-family)',
                  }}
                />
                {assignError && (
                  <div
                    className="mt-1 flex items-center gap-1"
                    style={{
                      fontSize: 'var(--mantine-font-size-xs)',
                      color: 'var(--mantine-color-red-text)',
                    }}
                  >
                    <AlertTriangle size={11} />
                    {assignError}
                  </div>
                )}
              </div>

              {creditAmount && !isNaN(parseFloat(creditAmount)) && parseFloat(creditAmount) > 0 && (
                <div
                  className="rounded-md px-3 py-2 border border-[color:var(--mantine-color-blue-light-hover)] bg-[var(--mantine-color-blue-light)] text-[color:var(--mantine-color-blue-text)]"
                  style={{ fontSize: 'var(--mantine-font-size-xs)' }}
                >
                  After assignment: Earned = {(parseFloat(String(selectedUser.earnedCredits)) + parseFloat(creditAmount)).toFixed(2)}
                  {' · '}
                  Available = {(parseFloat(String(selectedUser.totalAvailable)) + parseFloat(creditAmount)).toFixed(2)}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={closeAssignModal}
                  disabled={assigning}
                  className="rounded-md px-3 py-1.5 font-medium cursor-pointer border border-[color:var(--mantine-color-default-border)] bg-[var(--mantine-color-default)] text-[color:var(--mantine-color-text)]"
                  style={{ fontSize: 'var(--mantine-font-size-xs)', fontFamily: 'var(--mantine-font-family)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAssign}
                  disabled={assigning || !creditAmount}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium cursor-pointer border border-[color:var(--mantine-color-blue-light-hover)] bg-[var(--mantine-color-blue-filled)] text-white transition-opacity ${
                    assigning || !creditAmount ? 'opacity-50' : 'opacity-100'
                  }`}
                  style={{ fontSize: 'var(--mantine-font-size-xs)', fontFamily: 'var(--mantine-font-family)' }}
                >
                  {assigning ? (
                    <>
                      <div className="rounded-full size-3 border-2 border-white border-t-transparent animate-spin" />
                      Assigning…
                    </>
                  ) : (
                    <>
                      <Plus size={12} />
                      Assign Credits
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}