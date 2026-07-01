import { useState, useCallback } from 'react';
import { TablePage, Modal, useCallProcedure } from '@kottster/react';
import { FileText, Activity, File, ChevronRight, ChevronLeft, Eye } from 'lucide-react';
import type { Procedures } from './api.server';

const formatDate = (dateStr: string) => {
  if (!dateStr) return 'N/A';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return dateStr; }
};

const formatSize = (bytes: number) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

function Spinner() {
  return (
    <div className="flex flex-col items-center gap-2 py-10 opacity-40">
      <div className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      <span style={{ fontSize: 'var(--mantine-font-size-xs)', color: 'var(--mantine-color-dimmed)' }}>
        Loading…
      </span>
    </div>
  );
}

function DetailCard({ label, value }: { label: string; value: any }) {
  return (
    <div className="p-3 rounded-lg border border-[color:var(--mantine-color-default-border)] bg-[var(--mantine-color-default)]">
      <div
        className="uppercase tracking-wide mb-1 font-medium"
        style={{
          fontSize: 'var(--mantine-font-size-xs)',
          color: 'var(--mantine-color-dimmed)',
          fontFamily: 'var(--mantine-font-family)',
        }}
      >
        {label}
      </div>
      <div
        className="break-all font-medium"
        style={{
          fontSize: 'var(--mantine-font-size-sm)',
          color: 'var(--mantine-color-text)',
          fontFamily: 'var(--mantine-font-family)',
        }}
      >
        {value ?? 'N/A'}
      </div>
    </div>
  );
}




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


const SKIP_FIELDS = new Set(['resumes_count', 'sessions_count']);

export default function UsersInfoPage() {
  const callProcedure = useCallProcedure<Procedures>();

  
  const [viewRecord, setViewRecord] = useState<any>(null);

  
  const [activeModal, setActiveModal] = useState<'resumes' | 'sessions' | 'resumeDetail' | 'sessionDetail' | null>(null);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [resumesList, setResumesList] = useState<any[]>([]);
  const [sessionsList, setSessionsList] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedResume, setSelectedResume] = useState<any>(null);
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const openResumes = useCallback(async (user: any) => {
    setSelectedUser(user);
    setActiveModal('resumes');
    setLoadingList(true);
    try {
      const list = await callProcedure('getUserResumes', { userId: user.id });
      setResumesList(Array.isArray(list) ? list : []);
    } catch (err) { console.error(err); }
    finally { setLoadingList(false); }
  }, [callProcedure]);

  const openSessions = useCallback(async (user: any) => {
    setSelectedUser(user);
    setActiveModal('sessions');
    setLoadingList(true);
    try {
      const list = await callProcedure('getUserSessions', { userId: user.id });
      setSessionsList(Array.isArray(list) ? list : []);
    } catch (err) { console.error(err); }
    finally { setLoadingList(false); }
  }, [callProcedure]);

  const openResumeDetail = useCallback(async (resume: any) => {
    setActiveModal('resumeDetail');
    setLoadingDetail(true);
    try {
      const detail = await callProcedure('getResumeDetails', { resumeId: resume.id });
      setSelectedResume(detail);
    } catch (err) { console.error(err); }
    finally { setLoadingDetail(false); }
  }, [callProcedure]);

  const openSessionDetail = useCallback(async (session: any) => {
    setActiveModal('sessionDetail');
    setLoadingDetail(true);
    try {
      const detail = await callProcedure('getSessionDetails', { sessionId: session.id });
      setSelectedSession(detail);
    } catch (err) { console.error(err); }
    finally { setLoadingDetail(false); }
  }, [callProcedure]);

  const closeModal = () => {
    if (activeModal === 'resumeDetail') setActiveModal('resumes');
    else if (activeModal === 'sessionDetail') setActiveModal('sessions');
    else setActiveModal(null);
  };

  const isSubDetail = activeModal === 'resumeDetail' || activeModal === 'sessionDetail';

  const modalTitle = () => {
    if (activeModal === 'resumes') return `Resumes — ${selectedUser?.name || 'User'}`;
    if (activeModal === 'sessions') return `Sessions — ${selectedUser?.name || 'User'}`;
    if (activeModal === 'resumeDetail') return 'Resume Details';
    if (activeModal === 'sessionDetail') return 'Session Details';
    return '';
  };

  const getStatusBadgeClasses = (status: string): string => {
    const base = "font-medium px-2 py-0.5 rounded border transition-colors";
    if (status === 'COMPLETED') return `${base} bg-[var(--mantine-color-green-light)] text-[color:var(--mantine-color-green-text)] border-[color:var(--mantine-color-green-light-hover)]`;
    if (status === 'IN_PROGRESS') return `${base} bg-[var(--mantine-color-blue-light)] text-[color:var(--mantine-color-blue-text)] border-[color:var(--mantine-color-blue-light-hover)]`;
    return `${base} bg-[var(--mantine-color-gray-light)] text-[color:var(--mantine-color-dimmed)] border-[color:var(--mantine-color-default-border)]`;
  };

  
  const VIEW_FIELD_ORDER = ['id', 'name', 'email', 'createdAt'];
  
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
        title="Management"
        withSearch={true}

        
        customActions={[
          {
            label: 'View',
            onClick: (record) => setViewRecord(record),
          },
        ]}

        columnOverrides={{
          name: (col) => ({
            ...col,
            label: 'User',
            render: (record) => (
              <a
                href={`/users?search=${encodeURIComponent(record.email || record.id)}`}
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
                  {(record.name || 'A')[0].toUpperCase()}
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
                    {record.name || 'Anonymous'}
                  </div>
                  <div
                    style={{
                      fontSize: 'var(--mantine-font-size-xs)',
                      color: 'var(--mantine-color-dimmed)',
                      fontFamily: 'var(--mantine-font-family)',
                    }}
                  >
                    {record.email || record.id}
                  </div>
                </div>
              </a>
            ),
          }),

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
                {formatDate(record.createdAt)}
              </span>
            ),
          }),

          resumes_count: (col) => ({
            ...col,
            label: 'Resumes',
            render: (record) => {
              const rc = Number(record.resumes_count) || 0;
              return (
                <button
                  onClick={() => rc > 0 && openResumes(record)}
                  disabled={rc === 0}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium border transition-colors ${
                    rc > 0
                      ? 'cursor-pointer bg-[var(--mantine-color-violet-light)] text-[color:var(--mantine-color-violet-text)] border-[color:var(--mantine-color-violet-light-hover)] hover:bg-[var(--mantine-color-violet-light-hover)]'
                      : 'cursor-not-allowed bg-transparent text-[color:var(--mantine-color-dimmed)] border-[color:var(--mantine-color-default-border)] opacity-50'
                  }`}
                  style={{
                    fontSize: 'var(--mantine-font-size-xs)',
                    fontFamily: 'var(--mantine-font-family)',
                  }}
                >
                  <FileText size={12} />
                  {rc} {rc === 1 ? 'resume' : 'resumes'}
                </button>
              );
            },
          }),

          sessions_count: (col) => ({
            ...col,
            label: 'Sessions',
            render: (record) => {
              const sc = Number(record.sessions_count) || 0;
              return (
                <button
                  onClick={() => sc > 0 && openSessions(record)}
                  disabled={sc === 0}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium border transition-colors ${
                    sc > 0
                      ? 'cursor-pointer bg-[var(--mantine-color-teal-light)] text-[color:var(--mantine-color-teal-text)] border-[color:var(--mantine-color-teal-light-hover)] hover:bg-[var(--mantine-color-teal-light-hover)]'
                      : 'cursor-not-allowed bg-transparent text-[color:var(--mantine-color-dimmed)] border-[color:var(--mantine-color-default-border)] opacity-50'
                  }`}
                  style={{
                    fontSize: 'var(--mantine-font-size-xs)',
                    fontFamily: 'var(--mantine-font-family)',
                  }}
                >
                  <Activity size={12} />
                  {sc} {sc === 1 ? 'session' : 'sessions'}
                </button>
              );
            },
          }),

          id: (col) => ({ ...col, hidden: true, hiddenInTable: true }),
          email: (col) => ({ ...col, hidden: true, hiddenInTable: true }),
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
              if (key === 'createdAt' || key === 'updatedAt' || key.endsWith('At')) {
                display = formatDate(raw);
              } else if (key === 'size') {
                display = formatSize(raw);
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

      {activeModal && (
        <Modal
          title={modalTitle()}
          isOpen={!!activeModal}
          onClose={() => setActiveModal(null)}
          closeOnBackdropClick
          className="!w-full sm:!w-[680px]"
          headerRightSection={
            isSubDetail ? (
              <button
                onClick={closeModal}
                className="flex items-center gap-1 font-medium cursor-pointer bg-transparent border-none p-0 transition-opacity hover:opacity-70"
                style={{
                  fontSize: 'var(--mantine-font-size-xs)',
                  color: 'var(--mantine-color-dimmed)',
                  fontFamily: 'var(--mantine-font-family)',
                }}
              >
                <ChevronLeft size={14} />
                Back
              </button>
            ) : undefined
          }
        >

          {activeModal === 'resumes' && (
            loadingList ? <Spinner /> :
            resumesList.length === 0 ? (
              <div
                className="py-10 text-center"
                style={{ fontSize: 'var(--mantine-font-size-sm)', color: 'var(--mantine-color-dimmed)', fontFamily: 'var(--mantine-font-family)' }}
              >
                No resumes found.
              </div>
            ) : (
              <table className="w-full border-collapse" style={{ fontFamily: 'var(--mantine-font-family)', fontSize: 'var(--mantine-font-size-sm)' }}>
                <thead>
                  <tr className="border-b border-b-[color:var(--mantine-color-default-border)]">
                    {['Filename', 'Uploaded', 'Size', ''].map((h) => (
                      <th
                        key={h}
                        className="pb-2.5 text-left font-medium uppercase tracking-wide"
                        style={{ fontSize: 'var(--mantine-font-size-xs)', color: 'var(--mantine-color-dimmed)', fontFamily: 'var(--mantine-font-family)' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resumesList.map((r, idx) => (
                    <tr
                      key={r.id}
                      onClick={() => openResumeDetail(r)}
                      className={`cursor-pointer transition-colors hover:bg-[var(--mantine-color-default-hover)] ${idx < resumesList.length - 1 ? 'border-b border-b-[color:var(--mantine-color-default-border)]' : ''}`}
                    >
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2.5">
                          <File size={14} className="shrink-0" style={{ color: 'var(--mantine-color-dimmed)' }} />
                          <span className="font-medium" style={{ fontSize: 'var(--mantine-font-size-sm)', color: 'var(--mantine-color-text)', fontFamily: 'var(--mantine-font-family)' }}>
                            {r.filename || 'Untitled Resume'}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-4" style={{ fontSize: 'var(--mantine-font-size-xs)', color: 'var(--mantine-color-dimmed)', fontFamily: 'var(--mantine-font-family)' }}>
                        {formatDate(r.uploadedAt)}
                      </td>
                      <td className="py-2.5 pr-4" style={{ fontSize: 'var(--mantine-font-size-xs)', color: 'var(--mantine-color-dimmed)', fontFamily: 'var(--mantine-font-family)' }}>
                        {formatSize(r.size)}
                      </td>
                      <td className="py-2.5 text-right">
                        <ChevronRight size={14} style={{ color: 'var(--mantine-color-default-border)' }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {activeModal === 'sessions' && (
            loadingList ? <Spinner /> :
            sessionsList.length === 0 ? (
              <div
                className="py-10 text-center"
                style={{ fontSize: 'var(--mantine-font-size-sm)', color: 'var(--mantine-color-dimmed)', fontFamily: 'var(--mantine-font-family)' }}
              >
                No sessions found.
              </div>
            ) : (
              <table className="w-full border-collapse" style={{ fontFamily: 'var(--mantine-font-family)', fontSize: 'var(--mantine-font-size-sm)' }}>
                <thead>
                  <tr className="border-b border-b-[color:var(--mantine-color-default-border)]">
                    {['Company', 'Started', 'Duration', 'Status', ''].map((h) => (
                      <th
                        key={h}
                        className="pb-2.5 text-left font-medium uppercase tracking-wide"
                        style={{ fontSize: 'var(--mantine-font-size-xs)', color: 'var(--mantine-color-dimmed)', fontFamily: 'var(--mantine-font-family)' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sessionsList.map((s, idx) => {
                    const dur = s.durationSeconds || 0;
                    return (
                      <tr
                        key={s.id}
                        onClick={() => openSessionDetail(s)}
                        className={`cursor-pointer transition-colors hover:bg-[var(--mantine-color-default-hover)] ${idx < sessionsList.length - 1 ? 'border-b border-b-[color:var(--mantine-color-default-border)]' : ''}`}
                      >
                        <td className="py-2.5 pr-4">
                          <div className="font-medium" style={{ fontSize: 'var(--mantine-font-size-sm)', color: 'var(--mantine-color-text)', fontFamily: 'var(--mantine-font-family)' }}>
                            {s.companyName || 'Unknown'}
                          </div>
                          {s.mode && (
                            <div className="mt-0.5" style={{ fontSize: 'var(--mantine-font-size-xs)', color: 'var(--mantine-color-dimmed)', fontFamily: 'var(--mantine-font-family)' }}>
                              {s.mode}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 pr-4" style={{ fontSize: 'var(--mantine-font-size-xs)', color: 'var(--mantine-color-dimmed)', fontFamily: 'var(--mantine-font-family)' }}>
                          {formatDate(s.startedAt)}
                        </td>
                        <td className="py-2.5 pr-4" style={{ fontSize: 'var(--mantine-font-size-xs)', color: 'var(--mantine-color-dimmed)', fontFamily: 'var(--mantine-font-family)' }}>
                          {Math.floor(dur / 60)}m {dur % 60}s
                        </td>
                        <td className="py-2.5 pr-4">
                          <span
                            className={getStatusBadgeClasses(s.status)}
                            style={{ fontSize: 'var(--mantine-font-size-xs)', fontFamily: 'var(--mantine-font-family)' }}
                          >
                            {s.status || 'UNKNOWN'}
                          </span>
                        </td>
                        <td className="py-2.5 text-right">
                          <ChevronRight size={14} style={{ color: 'var(--mantine-color-default-border)' }} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          )}

          {activeModal === 'resumeDetail' && (
            loadingDetail ? <Spinner /> :
            !selectedResume ? (
              <div className="py-10 text-center" style={{ fontSize: 'var(--mantine-font-size-sm)', color: 'var(--mantine-color-dimmed)', fontFamily: 'var(--mantine-font-family)' }}>
                Could not load resume details.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-2">
                  <DetailCard label="ID" value={selectedResume.id} />
                  <DetailCard label="Filename" value={selectedResume.filename} />
                  <DetailCard label="Uploaded At" value={formatDate(selectedResume.uploadedAt)} />
                  <DetailCard label="Size" value={formatSize(selectedResume.size)} />
                  <DetailCard label="ATS Optimized" value={selectedResume.ats ? 'Yes' : 'No'} />
                </div>
                {selectedResume.parsedData && (
                  <div className="rounded-lg border border-[color:var(--mantine-color-default-border)] overflow-hidden">
                    <div className="px-4 py-2 border-b border-b-[color:var(--mantine-color-default-border)] font-medium uppercase tracking-wide bg-[var(--mantine-color-default)]" style={{ fontSize: 'var(--mantine-font-size-xs)', color: 'var(--mantine-color-dimmed)', fontFamily: 'var(--mantine-font-family)' }}>
                      Parsed Data
                    </div>
                    <pre className="m-0 p-4 overflow-x-auto leading-relaxed bg-[var(--mantine-color-body)]" style={{ fontSize: 'var(--mantine-font-size-xs)', color: 'var(--mantine-color-dimmed)', fontFamily: 'var(--mantine-font-family-monospace, var(--mantine-font-family))' }}>
                      {JSON.stringify(selectedResume.parsedData, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )
          )}

          {activeModal === 'sessionDetail' && (
            loadingDetail ? <Spinner /> :
            !selectedSession ? (
              <div className="py-10 text-center" style={{ fontSize: 'var(--mantine-font-size-sm)', color: 'var(--mantine-color-dimmed)', fontFamily: 'var(--mantine-font-family)' }}>
                Could not load session details.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-2">
                  <DetailCard label="ID" value={selectedSession.id} />
                  <DetailCard label="Company" value={selectedSession.companyName} />
                  <DetailCard label="Started At" value={formatDate(selectedSession.startedAt)} />
                  <DetailCard label="Ended At" value={formatDate(selectedSession.endedAt)} />
                  <DetailCard label="Duration" value={`${Math.floor((selectedSession.durationSeconds || 0) / 60)}m ${(selectedSession.durationSeconds || 0) % 60}s`} />
                  <DetailCard label="Status" value={selectedSession.status} />
                  <DetailCard label="Mode" value={selectedSession.mode} />
                  <DetailCard label="Language" value={selectedSession.language} />
                </div>
                {selectedSession.jobDescription && (
                  <div className="rounded-lg border border-[color:var(--mantine-color-default-border)] overflow-hidden">
                    <div className="px-4 py-2 border-b border-b-[color:var(--mantine-color-default-border)] font-medium uppercase tracking-wide bg-[var(--mantine-color-default)]" style={{ fontSize: 'var(--mantine-font-size-xs)', color: 'var(--mantine-color-dimmed)', fontFamily: 'var(--mantine-font-family)' }}>
                      Job Description
                    </div>
                    <div className="p-4 whitespace-pre-wrap leading-relaxed bg-[var(--mantine-color-body)] max-h-[18rem] overflow-y-scroll" style={{ fontSize: 'var(--mantine-font-size-sm)', color: 'var(--mantine-color-text)', fontFamily: 'var(--mantine-font-family)' }}>
                      {selectedSession.jobDescription}
                    </div>
                  </div>
                )}
                {selectedSession.transcript && (
                  <div className="rounded-lg border border-[color:var(--mantine-color-default-border)] overflow-hidden">
                    <div className="px-4 py-2 border-b border-b-[color:var(--mantine-color-default-border)] font-medium uppercase tracking-wide bg-[var(--mantine-color-default)]" style={{ fontSize: 'var(--mantine-font-size-xs)', color: 'var(--mantine-color-dimmed)', fontFamily: 'var(--mantine-font-family)' }}>
                      Transcript
                    </div>
                    <pre className="m-0 p-4 overflow-x-auto leading-relaxed bg-[var(--mantine-color-body)] max-h-[18rem] overflow-y-scroll" style={{ fontSize: 'var(--mantine-font-size-xs)', color: 'var(--mantine-color-dimmed)', fontFamily: 'var(--mantine-font-family-monospace, var(--mantine-font-family))' }}>
                      {JSON.stringify(selectedSession.transcript, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )
          )}
        </Modal>
      )}
    </>
  );
}