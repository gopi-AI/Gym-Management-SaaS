// Deliberate duplicate of the migration's SYSTEM_REPORT_SCHEMAS
// (src/migrations/1788965263405-SeedSystemReportSchemas.ts), kept separate because
// that migration is already committed/run and should not be refactored. If this
// catalog is ever revised, the migration's copy must be checked and updated too.

export const SYSTEM_REPORT_SCHEMAS = [
    {
        name: 'New Members (Daily/Weekly/Monthly)',
        description: 'New member sign-ups over time',
        category: 'member',
        query_definition: {
            source: 'Member',
            columns: {
                month: { bucket: 'created_at', unit: 'month' },
                count: { fn: 'COUNT', column: '*' },
            },
            filters: [{ column: 'created_at', operator: 'BETWEEN', value: ['$from', '$to'] }],
            group_by: ['month'],
            order_by: [{ column: 'month', direction: 'ASC' }],
            limit: 12,
        },
    },
    {
        name: 'Member Demographics',
        description: 'Age/gender/location breakdown',
        category: 'member',
        query_definition: {
            source: 'Member',
            columns: {
                date_of_birth: 'date_of_birth',
                gender: 'gender',
                branch_id: 'branch_id',
                count: { fn: 'COUNT', column: '*' },
            },
            filters: [{ column: 'created_at', operator: 'BETWEEN', value: ['$from', '$to'] }],
            group_by: ['date_of_birth', 'gender', 'branch_id'],
        },
    },
    {
        name: 'Membership Status Distribution',
        description: 'Membership counts by current status — a point-in-time snapshot, not a trend',
        category: 'member',
        query_definition: {
            source: 'Membership',
            columns: {
                status: 'status',
                count: { fn: 'COUNT', column: '*' },
            },
            filters: [{ column: 'branch_id', operator: '=', value: '$branchId' }],
            group_by: ['status'],
            order_by: [{ column: 'status', direction: 'ASC' }],
        },
    },
    {
        name: 'Membership Tenure Distribution',
        description: 'How long members stay',
        category: 'member',
        query_definition: {
            source: 'Membership',
            columns: {
                start_date: 'start_date',
                end_date: 'end_date',
            },
            filters: [{ column: 'status', operator: '=', value: '$status' }],
        },
    },
    {
        name: 'Revenue Summary',
        description: 'Total revenue by period',
        category: 'finance',
        query_definition: {
            source: 'Invoice',
            columns: {
                period: { bucket: 'invoice_date', unit: 'month' },
                status: 'status',
                total_amount: { fn: 'SUM', column: 'total_amount' },
            },
            filters: [
                { column: 'invoice_date', operator: 'BETWEEN', value: ['$from', '$to'] },
                { column: 'branch_id', operator: '=', value: '$branchId' },
            ],
            group_by: ['period', 'status'],
            order_by: [
                { column: 'period', direction: 'ASC' },
                { column: 'status', direction: 'ASC' },
            ],
        },
    },
    {
        name: 'Membership Sales by Plan',
        description: 'Membership value sold, grouped by plan and currency — contracted value, not collected revenue',
        category: 'finance',
        query_definition: {
            source: 'Membership',
            columns: {
                plan_id: 'plan_id',
                currency_at_signup: 'currency_at_signup',
                total_value: { fn: 'SUM', column: 'price_at_signup' },
            },
            filters: [{ column: 'start_date', operator: 'BETWEEN', value: ['$from', '$to'] }],
            group_by: ['plan_id', 'currency_at_signup'],
            order_by: [
                { column: 'plan_id', direction: 'ASC' },
                { column: 'currency_at_signup', direction: 'ASC' },
            ],
        },
    },
    {
        name: 'Outstanding Invoices',
        description: 'Unpaid invoices aging',
        category: 'finance',
        query_definition: {
            source: 'Invoice',
            columns: {
                invoice_date: 'invoice_date',
                due_date: 'due_date',
                amount: 'total_amount',
            },
            filters: [
                { column: 'status', operator: 'IN', value: ['draft', 'sent', 'partially_paid'] },
                { column: 'branch_id', operator: '=', value: '$branchId' },
            ],
            order_by: [{ column: 'due_date', direction: 'ASC' }],
        },
    },
    {
        name: 'Payment Method Mix',
        description: 'Payment method distribution',
        category: 'finance',
        query_definition: {
            source: 'Payment',
            columns: {
                payment_method: 'payment_method',
                count: { fn: 'COUNT', column: '*' },
                total: { fn: 'SUM', column: 'amount' },
            },
            filters: [{ column: 'payment_date', operator: 'BETWEEN', value: ['$from', '$to'] }],
            group_by: ['payment_method'],
            order_by: [{ column: 'payment_method', direction: 'ASC' }],
        },
    },
    {
        name: 'Daily Check-ins',
        description: 'Check-in count by day',
        category: 'attendance',
        query_definition: {
            source: 'AttendanceRecord',
            columns: {
                day: { bucket: 'check_in_time', unit: 'day' },
                count: { fn: 'COUNT', column: '*' },
                unique_members: { fn: 'COUNT', column: 'member_id', distinct: true },
            },
            filters: [
                { column: 'check_in_time', operator: 'BETWEEN', value: ['$from', '$to'] },
                { column: 'branch_id', operator: '=', value: '$branchId' },
            ],
            group_by: ['day'],
            order_by: [{ column: 'day', direction: 'ASC' }],
        },
    },
    {
        name: 'Peak Hours',
        description: 'Check-in volume by hour',
        category: 'attendance',
        query_definition: {
            source: 'AttendanceRecord',
            columns: {
                check_in_time: 'check_in_time',
            },
            filters: [
                { column: 'check_in_time', operator: 'BETWEEN', value: ['$from', '$to'] },
                { column: 'branch_id', operator: '=', value: '$branchId' },
            ],
            order_by: [{ column: 'check_in_time', direction: 'ASC' }],
        },
    },
    {
        name: 'Week-over-Week Trend',
        description: 'Attendance trend comparison',
        category: 'attendance',
        query_definition: {
            source: 'AttendanceRecord',
            columns: {
                week: { bucket: 'check_in_time', unit: 'week' },
                count: { fn: 'COUNT', column: '*' },
            },
            filters: [{ column: 'branch_id', operator: '=', value: '$branchId' }],
            group_by: ['week'],
            order_by: [{ column: 'week', direction: 'ASC' }],
        },
    },
] as const;

