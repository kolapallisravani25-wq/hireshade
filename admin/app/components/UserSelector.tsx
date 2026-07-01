import { useState, useEffect, useRef, useCallback } from 'react';
import { useCallProcedure } from '@kottster/react';
import { MantineProvider, Select, Loader, Text } from '@mantine/core';

const emailCache: Record<string, string> = {};

export const UserLabel = ({ userId, defaultEmail }: { userId: string; defaultEmail?: string }) => {
  const callProcedure = useCallProcedure<any>();
  const [email, setEmail] = useState<string | null>(defaultEmail || emailCache[userId] || null);

  useEffect(() => {
    let isMounted = true;
    if (userId && !email) {
      callProcedure('getUsers', { search: userId }).then((res: any) => {
        if (!isMounted) return;
        const u = res?.users?.find((x: any) => String(x.id) === String(userId));
        if (u && u.email) {
          emailCache[userId] = u.email;
          setEmail(u.email);
        }
      }).catch((e: any) => console.error(e));
    }
    return () => { isMounted = false; };
  }, [userId, callProcedure, email]);

  const label = email || userId;
  if (!label) return <span style={{ color: '#666' }}>—</span>;

  return (
    <a 
      href={`/users?search=${encodeURIComponent(label)}`}
      style={{ 
        background: 'rgba(79,142,247,0.1)', 
        border: '1px solid rgba(79,142,247,0.25)', 
        color: '#7aa2f7', 
        padding: '2px 8px', 
        borderRadius: '4px', 
        fontSize: '13px', 
        fontFamily: 'monospace',
        textDecoration: 'none',
        display: 'inline-block'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </a>
  );
};

export const UserSelector = ({
  value,
  updateFieldValue,
}: {
  value: any;
  updateFieldValue: (key: string, val: any) => void;
}) => {
  const callProcedure = useCallProcedure<any>();
  const [users, setUsers] = useState<{ value: string; label: string }[]>([]);
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchUsers = useCallback(
    async (search = '') => {
      setLoading(true);
      setError(null);
      try {
        const result = await callProcedure('getUsers', { search });
        const map: Record<string, string> = {};
        const items = (result?.users || []).map((u: any) => {
          const display = u.name ? `${u.name} (${u.email})` : u.email;
          map[String(u.id)] = display;
          return {
            value: String(u.id),
            label: u.email,
          };
        });
        setUserMap(prev => ({ ...prev, ...map }));
        setUsers(items);
      } catch (e) {
        setError('Could not load users.');
        console.error('[UserSelector] getUsers error:', e);
      } finally {
        setLoading(false);
      }
    },
    [callProcedure]
  );

  useEffect(() => {
    fetchUsers(value || '');
  }, []);

  const handleSearchChange = (q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchUsers(q), 300);
  };

  return (
    <MantineProvider forceColorScheme="dark">
      <Select
        searchable
        clearable
        placeholder="Search by email, name, or user ID…"
        data={users}
        value={value != null ? String(value) : null}
        rightSection={loading ? <Loader size="xs" /> : null}
        onSearchChange={handleSearchChange}
        onChange={(val: string | null) => updateFieldValue('userId', val)}
        filter={({ options }: any) => options}
        nothingFoundMessage={loading ? 'Loading…' : 'No users found'}
        maxDropdownHeight={280}
        styles={{ input: { fontFamily: 'monospace', fontSize: '13px' } }}
        renderOption={({ option }: any) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontWeight: 500, fontSize: '13px' }}>
              {userMap[option.value] || option.value}
            </span>
            <span style={{ fontSize: '11px', color: '#888', fontFamily: 'monospace' }}>
              {option.value}
            </span>
          </div>
        )}
      />
      {error && (
        <Text size="xs" c="red" mt="4px">
          {error}
        </Text>
      )}
    </MantineProvider>
  );
};
