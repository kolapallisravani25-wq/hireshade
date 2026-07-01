import { useState, useEffect, useRef } from 'react';
import { TablePage, Modal, useCallProcedure, extensionRegistry } from '@kottster/react';
import { ExternalLink, Plus, Link2 } from 'lucide-react';
import type { Procedures } from './api.server';

interface LinkRecord {
  id: number;
  title: string;
  url: string;
  created_at: string;
}

const _openAddRef = { current: () => {} };

function AddLinkButton() {
  return (
    <button
      onClick={() => _openAddRef.current()}
      className="inline-flex items-center gap-[6px] px-[14px] h-[36px] rounded-[var(--mantine-radius-sm)] border-none bg-[var(--mantine-color-blue-filled)] text-white text-[var(--mantine-font-size-sm)] font-[family-name:var(--mantine-font-family)] font-semibold cursor-pointer whitespace-nowrap"
    >
      <Plus size={14} />
      Add Link
    </button>
  );
}

function ViewField({ label, value }: { label: string; value: any }) {
  return (
    <div className="py-3 border-b border-b-[var(--mantine-color-default-border)] last:border-b-0 font-[family-name:var(--mantine-font-family)]">
      <div className="uppercase tracking-wide font-medium mb-0.5 text-[var(--mantine-font-size-xs)] text-[var(--mantine-color-dimmed)]">
        {label}
      </div>
      <div className="font-medium break-all text-[var(--mantine-font-size-sm)] text-[var(--mantine-color-text)]">
        {value ?? <span className="text-[var(--mantine-color-dimmed)]">—</span>}
      </div>
    </div>
  );
}

export default function QuickLinksPage() {
  const callProcedure = useCallProcedure<Procedures>();

  const [tableKey, setTableKey] = useState(0);
  const refresh = () => setTableKey((k) => k + 1);

  const [viewRecord, setViewRecord] = useState<LinkRecord | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<LinkRecord | null>(null);
  const [titleVal, setTitleVal] = useState('');
  const [urlVal, setUrlVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState('');

  const openAdd = () => {
    setEditRecord(null);
    setTitleVal('');
    setUrlVal('');
    setFieldError('');
    setModalOpen(true);
  };

  _openAddRef.current = openAdd;

  useEffect(() => {
    return extensionRegistry.register('TablePageHeaderButtons', AddLinkButton);
  }, []);

  const openEdit = (record: LinkRecord) => {
    setEditRecord(record);
    setTitleVal(record.title);
    setUrlVal(record.url);
    setFieldError('');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditRecord(null);
    setFieldError('');
  };

  const handleSave = async () => {
    if (!titleVal.trim()) { setFieldError('Title is required'); return; }
    if (!urlVal.trim()) { setFieldError('URL is required'); return; }
    setSaving(true);
    setFieldError('');
    try {
      if (editRecord) {
        await callProcedure('updateLink', { id: editRecord.id, title: titleVal, url: urlVal });
      } else {
        await callProcedure('createLink', { title: titleVal, url: urlVal });
      }
      closeModal();
      refresh();
    } catch (e: any) {
      setFieldError(e?.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: LinkRecord) => {
    if (!confirm(`Delete "${record.title}"?`)) return;
    try {
      await callProcedure('deleteLink', { id: record.id });
      refresh();
    } catch (e: any) {
      alert(e?.message || 'Delete failed');
    }
  };

  const inputClass = "w-full py-2 px-3 rounded-[var(--mantine-radius-sm)] border border-[var(--mantine-color-default-border)] bg-[var(--mantine-color-default)] text-[var(--mantine-color-text)] text-[var(--mantine-font-size-sm)] font-[family-name:var(--mantine-font-family)] outline-none";

  return (
    <>
      <TablePage
        key={tableKey}
        title="Quick Links"
        withSearch={false}
        customActions={[
          {
            label: 'View',
            onClick: (record) => setViewRecord(record as LinkRecord),
          },
          {
            label: 'Edit',
            onClick: (record) => openEdit(record as LinkRecord),
          },
          {
            label: 'Delete',
            color: 'red',
            onClick: (record) => handleDelete(record as LinkRecord),
          },
        ]}
        columnOverrides={{
          id: (col) => ({ ...col, hidden: true }),

          title: (col) => ({
            ...col,
            label: 'Title',
            render: (record: any) => (
              <div className="flex items-center gap-2.5">
                <div className="size-7 rounded-md border flex items-center justify-center shrink-0 bg-[var(--mantine-color-blue-light)] border-[var(--mantine-color-blue-light-hover)]">
                  <Link2 size={13} className="text-[var(--mantine-color-blue-text)]" />
                </div>
                <span className="font-medium text-[var(--mantine-font-size-sm)] text-[var(--mantine-color-text)] font-[family-name:var(--mantine-font-family)]">
                  {record.title}
                </span>
              </div>
            ),
          }),

          url: (col) => ({
            ...col,
            label: 'URL',
            render: (record: any) => (
              <a
                href={record.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 font-medium transition-opacity hover:opacity-70 text-[var(--mantine-font-size-sm)] text-[var(--mantine-color-blue-text)] font-[family-name:var(--mantine-font-family)]"
              >
                <ExternalLink size={13} />
                {record.url.length > 55 ? record.url.slice(0, 55) + '…' : record.url}
              </a>
            ),
          }),

          created_at: (col) => ({
            ...col,
            label: 'Added On',
            render: (record: any) => (
              <span className="text-[var(--mantine-font-size-sm)] text-[var(--mantine-color-dimmed)] font-[family-name:var(--mantine-font-family)]">
                {record.created_at
                  ? new Date(record.created_at).toLocaleDateString('en-US', {
                      year: 'numeric', month: 'short', day: 'numeric',
                    })
                  : '—'}
              </span>
            ),
          }),
        }}
      />

      {viewRecord && (
        <Modal
          title="View Link"
          isOpen={!!viewRecord}
          onClose={() => setViewRecord(null)}
          closeOnBackdropClick
          width={480}
        >
          <div className="font-[family-name:var(--mantine-font-family)]">
            <ViewField label="ID" value={viewRecord.id} />
            <ViewField label="Title" value={viewRecord.title} />
            <ViewField label="URL" value={viewRecord.url} />
            <ViewField label="Added On" value={viewRecord.created_at} />
          </div>
          <div className="mt-4 flex justify-end">
            <a
              href={viewRecord.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md font-semibold border-none bg-[var(--mantine-color-blue-filled)] text-white text-[var(--mantine-font-size-sm)] font-[family-name:var(--mantine-font-family)]"
            >
              <ExternalLink size={14} />
              Open Link
            </a>
          </div>
        </Modal>
      )}

      <Modal
        title={editRecord ? 'Edit Link' : 'Add New Link'}
        isOpen={modalOpen}
        onClose={closeModal}
        closeOnBackdropClick
        width={460}
      >
        <div className="flex flex-col gap-4 font-[family-name:var(--mantine-font-family)]">
          <div>
            <label className="block text-[var(--mantine-font-size-xs)] text-[var(--mantine-color-dimmed)] font-[family-name:var(--mantine-font-family)] font-semibold uppercase tracking-[0.05em] mb-[6px]">
              Title
            </label>
            <input
              type="text"
              placeholder="e.g. GitHub Repository"
              value={titleVal}
              onChange={(e) => setTitleVal(e.target.value)}
              className={inputClass}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[var(--mantine-font-size-xs)] text-[var(--mantine-color-dimmed)] font-[family-name:var(--mantine-font-family)] font-semibold uppercase tracking-[0.05em] mb-[6px]">
              URL
            </label>
            <input
              type="url"
              placeholder="https://example.com"
              value={urlVal}
              onChange={(e) => setUrlVal(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              className={inputClass}
            />
          </div>

          {fieldError && (
            <div className="py-2 px-3 rounded-[var(--mantine-radius-sm)] bg-[var(--mantine-color-red-light)] border border-[var(--mantine-color-red-light-hover)] text-[var(--mantine-color-red-text)] text-[var(--mantine-font-size-xs)] font-[family-name:var(--mantine-font-family)]">
              {fieldError}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-1">
            <button
              onClick={closeModal}
              className="py-2 px-4 rounded-[var(--mantine-radius-sm)] border border-[var(--mantine-color-default-border)] bg-[var(--mantine-color-default)] text-[var(--mantine-color-text)] text-[var(--mantine-font-size-sm)] font-[family-name:var(--mantine-font-family)] font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 py-2 px-4 rounded-[var(--mantine-radius-sm)] border-none bg-[var(--mantine-color-blue-filled)] text-white text-[var(--mantine-font-size-sm)] font-[family-name:var(--mantine-font-family)] font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving && (
                <span className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {editRecord ? 'Update' : 'Save Link'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}