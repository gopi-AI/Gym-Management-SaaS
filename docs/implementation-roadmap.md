# Implementation Roadmap

This document outlines the phased implementation plan for the Gym Management SaaS platform, divided into 7 phases as per the specification.

## Phase 0: Architecture/Foundation
**Objective**: Set up the foundational infrastructure, core platform services, and development tooling.

### Features
- Monorepo setup with workspace management (e.g., Nx, Turborepo, or simple workspace)
- Core tenancy and identity modules
- Database schema with multi-tenancy and RLS
- Outbox/inbox infrastructure for event-driven architecture
- Basic API gateway and authentication
- CI/CD pipeline with linting, testing, and security scans
- Basic monitoring and logging (OpenTelemetry)
- Cloud infrastructure (IaC with Terraform)
- Basic UI shell with Next.js (login, navigation)

### Database Changes
- Create tables for organizations, branches, users, roles, permissions
- Create shared tables: outbox, inbox, audit_log
- Enable RLS on all tenant tables
- Add indexes for tenant queries

### API Changes
- Authentication endpoints (login, logout, refresh)
- Tenancy CRUD endpoints (organizations, branches)
- Identity CRUD endpoints (users, roles)
- Basic health check endpoint

### Frontend Changes
- Next.js app with App Router
- Authentication pages (login, logout)
- Basic layout with navigation
- Placeholder dashboard

### Worker Changes
- Outbox poller worker (Node.js)
- Inbox processor (library used by services)

### Infrastructure
- GitHub Actions or similar CI/CD
- Terraform for AWS/GCP resources (VPC, RDS, Redis, RabbitMQ, S3)
- Docker images for services
- Basic monitoring setup (Prometheus, Grafana)

## Phase 1: MVP Gym Operations
**Objective**: Deliver core gym operations: member management, membership sales, check-in, and basic financials.

### Features
- Member CRUD with local ID generation
- Membership plans and sales
- Membership lifecycle (start, renew, pause, cancel)
- Manual attendance check-in (front desk)
- Basic invoicing and payment processing
- Simple dashboard showing key metrics
- Role-based access control (staff roles)

### Database Changes
- Members table with local_id counter table
- Membership plans, memberships, pauses, cancellations
- Invoices, invoice items, payments
- Basic financial ledger entries
- Attendance records for manual check-in

### API Changes
- Members: list, create, get, update
- Membership plans: list, create
- Memberships: create for member, get, update, pause, resume, cancel
- Invoices: list, create, get
- Payments: list, create, record payment
- Attendance: manual check-in endpoint

### Frontend Changes
- Member list and profile pages
- Membership sales flow
- Front desk check-in screen
- Payment recording UI
- Basic reports dashboard

### Worker Changes
- Payment retry worker (for failed payments)
- Membership expiry checker (to update statuses)

### Infrastructure
- Scale Redis for caching and coordination
- Tune PostgreSQL for write-heavy attendance
- Add read replicas for scaling reads
## Phase 2: Member 360
**Objective**: Provide a comprehensive view of the member, including fitness data, attendance history, and engagement.

### Features
- Member 360 dashboard with tabs
- Attendance history and check-in trends
- Personal training assignments and progress
- Workout and diet plan assignments
- Measurement tracking (weight, body fat, etc.)
- Loyalty points and rewards
- Document and consent management
- Communication preferences and history

### Database Changes
- Extended member profile table
- Workout plans, exercises, assignments, progress
- Diet plans, meal templates, nutrition logs
- Measurement logs
- Loyalty points table
- Document storage references (S3 keys)
- Consent tracking table

### API Changes
- Member 360 endpoints: header and each tab section
- Workout: list plans, assign, log progress
- Diet: list plans, assign, log meals
- Measurements: log and retrieve
- Points: list transactions, adjust
- Documents: upload, list, download
- Consents: list, give, withdraw

### Frontend Changes
- Member 360 page with tabs (implemented as separate routes or dynamic tabs)
- Each tab as a reusable component with lazy loading where appropriate
- Charts for attendance and measurement trends
- File upload/download for documents
- Consent management UI

### Worker Changes
- Workout recommendation worker (suggests workouts based on goals)
- Nutrition analyzer (calculates macros from logs)
- Points calculation worker (award points for activities)
## Phase 3: Finance/Inventory/CRM
**Objective**: Strengthen financial operations, add retail inventory, and improve lead management.

### Features
- Advanced financials: refunds, credit notes, tax handling, recurring billing
- Inventory management: stock levels, purchase orders, retail sales
- CRM: lead tracking, follow-ups, conversion funnel
- Automated dunning for failed payments
- Commission tracking for trainers
- Basic reporting on financials and inventory

### Database Changes
- Financial ledger enhancements (tax lines, refunds, credit notes)
- Inventory items, transactions, lots, suppliers, purchase orders
- Leads, lead sources, stages, activities, follow-ups
- Trainer commissions
- Enhanced invoicing with discounts and taxes

### API Changes
- Finance: refunds, credit notes, tax settings
- Inventory: items CRUD, stock adjustments, purchase orders
- CRM: leads CRUD, activities, follow-ups, conversion
- Finance: dunning management, payment retries
- PT: trainer commissions

### Frontend Changes
- Inventory management UI
- CRM pipeline and lead management
- Advanced financial reports
- Trainer commission statements
- Refund and credit note processing UI

### Worker Changes
- Dunning worker (processes overdue invoices)
- Inventory reorder worker (suggests purchase orders)
- Revenue recognition worker (for deferred revenue)
- Tax calculation worker (for automated tax)

### Infrastructure
- Consider partitioning financial ledger for archival strategy
- Scale S3 for increased document storage
- Add more worker nodes for increased async load
## Phase 4: Biometric + Offline Edge
**Objective**: Enable biometric access control and offline operation capabilities.

### Features
- Biometric device integration (ZKTeco, Suprema, etc.)
- Edge agent for local access decisions and caching
- Offline event queuing and synchronization
- Anti-passback and time-based access rules
- Door lock/turnstile control via edge agent
- Eligibility snapshots pushed to edge
- Sync conflict detection and resolution
- Health monitoring for edge agents and devices

### Database Changes
- Edge agent registry and credentials tables
- Device mappings and eligibility snapshots tables
- Sync cursors and offline events tables
- Sync conflicts table
- Enhanced attendance tables for device events

### API Changes
- Edge sync ingest endpoint (for edge to cloud)
- Device registration and management endpoints
- Eligibility snapshot distribution (cloud to edge)
- Sync status and conflict resolution endpoints
- Device health reporting endpoints

### Frontend Changes
- Edge agent management dashboard
- Device health and sync status views
- Conflict resolution UI
- Access control rule configuration
- Biometric enrollment (member-facing or staff-assisted)

### Worker Changes
- Eligibility snapshot distributor worker (pushes updates to edge)
- Sync conflict resolver worker (suggests resolutions)
- Device health monitor worker (aggregates and alerts)
- Batch sync processor (handles incoming edge batches)

### Infrastructure
- Deploy edge agents to gym locations (initially pilot)
## Phase 5: Notifications/Marketing
**Objective**: Enable sophisticated member engagement and marketing campaigns.

### Features
- Notification policy engine (trigger-based and scheduled)
- Template management with personalization
- Multi-channel delivery (email, SMS, WhatsApp, push)
- Delivery tracking and analytics
- Marketing campaigns (drip, promotional)
- Member segmentation and targeting
- A/B testing for messages
- Opt-in/opt-out management

### Database Changes
- Notification policies, templates, attempts, deliveries
- Campaigns, campaign logs, segmentation rules
- Communication preferences table (per member)
- Notification channels configuration

### API Changes
- Notification policies CRUD
- Notification templates CRUD
- Send notification (internal)
- Delivery tracking endpoints
- Campaigns CRUD
- Segmentation endpoints
- Preference management endpoints

### Frontend Changes
- Notification policy builder UI
- Template editor with preview
- Campaign management dashboard
- Delivery reports and analytics
- Member preference center

### Worker Changes
- Notification policy evaluator (runs triggers)
- Template resolver (merges data into templates)
- Channel adapters (email, SMS, WhatsApp, push)
- Delivery tracker and retry worker
- Campaign execution worker
- Preference sync worker (respect opt-outs)
## Phase 6: Analytics
**Objective**: Provide advanced analytics and reporting capabilities for business intelligence.

### Features
- Data warehouse (separate from OLTP) for analytics
- Pre-built reports: attendance trends, revenue analysis, member retention
- Ad-hoc query capability (via BI tool or custom reports)
- Funnel analysis for lead conversion
- Cohort analysis for member retention
- Predictive analytics (churn risk, attendance forecast)
- Data export capabilities (CSV, Excel)
- Scheduled report delivery

### Database Changes
- Data warehouse schema (star/snowflake) or use read replicas with materialized views
- Aggregation tables for common reports
- Data mart for specific domains (finance, attendance, etc.)
- ETL/log tables for tracking

### API Changes
- Report management endpoints (create, schedule, execute)
- Query endpoints for ad-hoc access (if building custom BI)
- Data export endpoints
- Metadata endpoints for report fields

### Frontend Changes
- Analytics dashboard with pre-built reports
- Report builder UI (drag-and-drop)
- Ad-hoc query interface (if applicable)
- Report scheduling and delivery management
- Data export UI

### Worker Changes
- ETL worker (extract from OLTP, transform, load to warehouse)
- Aggregation worker (materialize views)
- Report generation worker (for scheduled reports)
- Data export worker (convert to CSV/Excel)
- Analytics model trainer (for predictive models, if applicable)

### Infrastructure
- Data warehouse solution (e.g., Amazon Redshift, Google BigQuery, or Snowflake)
- Or alternatively, use PostgreSQL with foreign data wrappers and partitioning for analytics
## Phase 7: Enterprise Scale
**Objective**: Prepare the platform for large-scale enterprise deployments with advanced features.

### Features
- Multi-region deployment for disaster recovery
- Advanced access control (ABAC, attribute-based)
- SaaS subscription management for the platform itself
- White-labeling and custom branding
- Advanced integrations (SSO provisioning, SCIM)
- Audit trail enhancement and e-discovery
- Performance tuning for massive scale
- Chaos engineering and resilience testing
- Comprehensive API rate limiting and quotas

### Database Changes
- Partitioning of large tables (attendance, financial ledger)
- Archival strategies for old data
- Enhanced audit logs with tamper-evident sealing
- Multi-region replication setup (if applicable)
- SaaS subscription tables (if platform is sold as a service)

### API Changes
- Multi-region awareness headers
- Advanced filtering and querying
- Audit log access endpoints
- Subscription management endpoints (for platform)
- Rate limiting status endpoints

### Frontend Changes
- Multi-region status indicator
- Advanced admin settings for enterprise features
- White-label customization UI
- Audit log viewer and search
- Subscription management for enterprise customers

### Worker Changes
- Partition maintenance worker
- Archival worker (move data to cold storage)
- Audit log verification worker
- Disaster recovery failover worker
- Load shedding worker (for extreme load)

### Infrastructure
- Multi-region deployment (active-passive or active-active)
- Advanced load balancing and traffic management
- Enhanced security (DDoS protection, WAF rules)
- Chaos engineering tooling (e.g., Gremlin, Litmus)
- Performance optimization (caching strategies, query optimization)

### Dependencies
- None new; relies on existing cloud provider features

### Risks
- Multi-region data consistency challenges
- Increased operational complexity
- Cost of enterprise-grade features
- Ensuring backward compatibility during major upgrades

### Exit Criteria
- Platform deployed in multiple regions with failover tested
- Enterprise features (white-label, SSO) working
- Performance benchmarks met (e.g., 10k RPM sustained)
- Chaos testing shows system resilience
- Ready for enterprise sales and deployment

--- 

*Document Version: 1.0*
*Last Updated: 2026-09-01*
- Increase read replica count for ETL offloading
- S3 for data lake storage (if applicable)
- BI tool integration (e.g., Tableau, PowerShield, or open-source like Metabase)

### Dependencies
- ETL tools (Apache Airflow, Dagster, or custom)
- BI visualization tools
- Data transformation tools (dbt, etc.)

### Risks
- Data freshness vs. performance trade-offs
- Complexity of ETL pipelines
- Cost of data warehouse
- Ensuring data consistency between OLTP and warehouse

### Exit Criteria
- Analytics dashboard provides actionable insights
- Reports generated accurately and on time
- Ad-hoc queries return results in reasonable time
- System handles analytics load (e.g., 50 concurrent report users)

### Infrastructure
- Scale notification workers based on volume
- Integrate with third-party providers (SendGrid, Twilio, WhatsApp Business)
- Consider message queue for notification buffering (if not using existing broker)
- Rate limiting compliance with providers

### Dependencies
- Email service provider (e.g., SendGrid, SES)
- SMS service provider (e.g., Twilio)
- WhatsApp Business API access
- Push notification service (Firebase, APNS) if mobile app present

### Risks
- Message delivery failures and reputation management
- Compliance with communication regulations (TCPA, GDPR)
- Template personalization errors
- Over-messaging leading to opt-outs

### Exit Criteria
- Automated notifications working for key events (membership expiry, etc.)
- Marketing campaigns can be created and executed
- Delivery tracking provides insights
- System handles notification load (e.g., 1000 notifications/minute)
- Increase cloud capacity for sync ingest (horizontal scaling)
- Consider edge agent auto-update mechanism
- Add specific monitoring for edge agents (latency, sync lag)

### Dependencies
- Biometric device SDKs (ZKTeco, Suprema, etc.)
- Reliable hardware at gym locations (dedicated mini-PC or equivalent)
- VPN or direct connectivity for edge agents (with fallback)

### Risks
- Biometric false acceptance/rejection rates
- Edge agent reliability in diverse gym environments
- Network connectivity issues at remote locations
- Data privacy regulations for biometric data

### Exit Criteria
- Biometric check-in working in pilot gyms
- Offline operation verified (simulate network outage)
- Sync recovers correctly after outage
- Access decisions made locally with <200ms latency
- System handles biometric load (e.g., 50 check-ins/minute per device)

### Dependencies
- Real payment gateway integration (e.g., Stripe, PayPal)
- Tax service (e.g., TaxJar) or manual tax tables
- Barcode scanner support for inventory (if needed)

### Risks
- Financial accuracy and compliance with accounting standards
- Inventory shrinkage and accuracy
- Lead conversion tracking fidelity

### Exit Criteria
- Financial books accurate and audit-ready
- Inventory tracking matches physical stock
- CRM funnel provides actionable insights
- System handles increased load (e.g., 1000 concurrent users)

### Infrastructure
- Increase read replica count for read-heavy 360 views
- Optimize materialized views for dashboard queries
- S3 storage for documents with lifecycle policies

### Dependencies
- None new; uses existing infrastructure

### Risks
- Information overload in 360 view; need good UX
- Data consistency between async workers and main data
- Privacy concerns with health and fitness data

### Exit Criteria
- Staff and members can view comprehensive member profile
- Data from various subsystems aggregates correctly
- System handles moderate load (e.g., 500 concurrent users)

### Dependencies
- Payment gateway integration (stubbed in Phase 1, real in Phase 3)
- Email service for notifications (basic)

### Risks
- Membership state machine complexity
- Financial compliance and auditability
- Concurrent membership updates (race conditions)

### Exit Criteria
- Staff can sell memberships and check-in members
- Payments processed and reflected in accounting
- Basic reports generated
- System handles basic load (e.g., 100 concurrent users)
### Dependencies
- Backend: Node.js, NestJS, TypeScript, PostgreSQL, Redis, RabbitMQ
- Frontend: Next.js, React, TypeScript
- DevOps: Docker, Terraform, GitHub Actions
- Testing: Jest, React Testing Library

### Risks
- Delay in setting up foundational tooling
- Cloud provisioning complexities
- Initial performance and scaling assumptions may need adjustment

### Exit Criteria
- Foundational services deployable to dev/staging
- Basic authentication and tenancy working
- CI/CD pipeline green for main branch
- OpenTelemetry tracing working across services