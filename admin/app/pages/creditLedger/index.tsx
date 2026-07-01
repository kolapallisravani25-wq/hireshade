import React from 'react';
import { TablePage } from '@kottster/react';
import { UserSelector, UserLabel } from '../../components/UserSelector';

export default function Page() {
  return (
    <TablePage
      columnOverrides={{
        userId: (column) => ({
          ...column,
          render: (record: any) => <UserLabel userId={record.userId} defaultEmail={record.user_email} />,
          fieldInput: {
            type: 'custom',
            renderComponent: (params: any) => <UserSelector {...params} />,
          },
        }),
        user_email: (column) => ({
          ...column,
          render: (record: any) => (
            <a 
              href={`/users?search=${encodeURIComponent(record.user_email || record.userId)}`}
              style={{ 
                color: '#7aa2f7', 
                textDecoration: 'underline', 
                textUnderlineOffset: '2px',
                fontWeight: 500 
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {record.user_email || record.userId}
            </a>
          )
        })
      }}
    />
  );
}
