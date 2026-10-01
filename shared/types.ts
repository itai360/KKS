// API data shapes shared by the server (producer) and the client (consumer).

import type {
  CadetStatus,
  CarryAction,
  DebriefItemKind,
  LessonKind,
  NotificationCategory,
  OverdueResponse,
  Priority,
  RecordKind,
  RecurrenceFrequency,
  RequestType,
  Role,
  TaskStatus,
  Tone,
  Visibility,
  WeekStatus,
} from './constants';

export interface User {
  id: number;
  username: string;
  displayName: string;
  title: string;
  role: Role;
  active: boolean;
  phone: string;
  email: string;
}

export interface CourseSettings {
  courseName: string;
  courseSymbol: string;
  startDate: string | null;
  endDate: string | null;
  timezone: string;
  staleDays: number;
  defaultDeadlineTime: string;
  overloadThreshold: number;
  readinessWarnThreshold: number;
  domains: string[];
}

export interface Task {
  id: number;
  title: string;
  description: string;
  ownerId: number;
  ownerName: string;
  participantIds: number[];
  createdBy: number;
  createdByName: string;
  creatorRole: Role;
  deadline: string;
  priority: Priority;
  status: TaskStatus;
  domain: string;
  weekId: number | null;
  weekName: string | null;
  eventId: number | null;
  eventTitle: string | null;
  parentId: number | null;
  groupId: string | null;
  meetingId: number | null;
  recurringRuleId: number | null;
  cadetId: number | null;
  cadetName: string | null;
  experienceId: number | null;
  debriefId: number | null;
  debriefTitle: string | null;
  requiresApproval: boolean;
  visibility: Visibility;
  blockReason: string | null;
  blockWaitingFor: string | null;
  blockNextStep: string | null;
  needsCommander: boolean;
  overdueResponse: OverdueResponse | null;
  overdueResponseAt: string | null;
  cancelReason: string | null;
  carriedCount: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  subtaskTotal: number;
  subtaskDone: number;
  openDependencies: number;
  // computed by the server at response time
  overdue: boolean;
  dueSoon: boolean;
  stale: boolean;
  tone: Tone;
}

export interface TaskUpdate {
  id: number;
  taskId: number;
  userId: number;
  userName: string;
  kind: 'comment' | 'instruction' | 'return' | 'system';
  body: string;
  createdAt: string;
}

export interface Attachment {
  id: number;
  taskId: number | null;
  eventId: number | null;
  userId: number;
  userName: string;
  kind: 'link' | 'file';
  title: string;
  url: string;
  size: number | null;
  createdAt: string;
}

export interface ActivityEntry {
  id: number;
  taskId: number | null;
  taskTitle: string | null;
  weekId: number | null;
  userId: number | null;
  userName: string | null;
  action: string;
  text: string;
  createdAt: string;
}

export interface TaskRequest {
  id: number;
  type: RequestType;
  taskId: number;
  taskTitle: string;
  requestedBy: number;
  requestedByName: string;
  newDeadline: string | null;
  newOwnerId: number | null;
  newOwnerName: string | null;
  currentDeadline: string;
  currentOwnerName: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy: number | null;
  decidedByName: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface TaskPermissions {
  canEdit: boolean;
  canChangeDeadline: boolean;
  canChangeOwner: boolean;
  canDelete: boolean;
  canUpdateStatus: boolean;
  canApprove: boolean;
  canCancel: boolean;
  canRequestDeadline: boolean;
  canRequestTransfer: boolean;
}

export interface GroupProgress {
  groupId: string;
  total: number;
  done: number;
  members: { taskId: number; ownerId: number; ownerName: string; status: TaskStatus; overdue: boolean }[];
}

export interface TaskDetail {
  task: Task;
  updates: TaskUpdate[];
  attachments: Attachment[];
  activity: ActivityEntry[];
  subtasks: Task[];
  parent: Pick<Task, 'id' | 'title'> | null;
  dependsOn: Pick<Task, 'id' | 'title' | 'status' | 'ownerName' | 'deadline'>[];
  blocks: Pick<Task, 'id' | 'title' | 'status' | 'ownerName' | 'deadline'>[];
  group: GroupProgress | null;
  requests: TaskRequest[];
  permissions: TaskPermissions;
}

export interface Week {
  id: number;
  number: number;
  name: string;
  topic: string;
  goals: string;
  startDate: string;
  endDate: string;
  leadId: number | null;
  leadName: string | null;
  status: WeekStatus;
  approvedAt: string | null;
  approvedByName: string | null;
  closedAt: string | null;
  totalTasks: number;
  doneTasks: number;
  overdueTasks: number;
  readiness: number;
}

export interface Lesson {
  id: number;
  weekId: number;
  kind: LessonKind;
  body: string;
  createdBy: number;
  createdByName: string;
  taskId: number | null;
  taskTitle: string | null;
  createdAt: string;
}

export interface DomainReadiness {
  domain: string;
  total: number;
  done: number;
  readiness: number;
}

export interface ScheduleEvent {
  id: number;
  date: string;
  startTime: string;
  endTime: string | null;
  title: string;
  location: string;
  ownerId: number | null;
  ownerName: string | null;
  weekId: number | null;
  notes: string;
  cancelled: boolean;
  taskTotal: number;
  taskDone: number;
}

/** An event from a Google (or any iCal) calendar shown in the schedule. Read-only. */
export interface ExternalEvent {
  id: string;
  sourceId: number;
  sourceName: string;
  date: string;
  /** null: an all-day event */
  startTime: string | null;
  endTime: string | null;
  title: string;
  location: string;
}

export interface CalendarSource {
  id: number;
  name: string;
  /** the calendar's address; only the commander sees it */
  url: string | null;
  error: string | null;
}

/** The user's personal link for subscribing to the schedule from Google Calendar. */
export interface CalendarFeed {
  url: string;
  googleUrl: string;
}

export interface EventDetail {
  event: ScheduleEvent;
  tasks: Task[];
  attachments: Attachment[];
  debriefs: Debrief[];
}

export interface TemplateItem {
  title: string;
  description?: string;
  domain?: string;
  priority?: Priority;
  /** days relative to the anchor (week start / event date); negative = before */
  offsetDays: number;
  time?: string;
  /** 'week_lead' | 'event_owner' | user id as string | '' (choose on apply) */
  owner?: string;
  stage?: string;
  requiresApproval?: boolean;
}

export interface Template {
  id: number;
  name: string;
  description: string;
  kind: 'week' | 'activity' | 'general';
  items: TemplateItem[];
  autoApplyDaysBefore: number | null;
  createdAt: string;
}

export interface RecurringRule {
  id: number;
  title: string;
  description: string;
  frequency: RecurrenceFrequency;
  weekdays: number[];
  time: string;
  assignee: string; // user id as string, or 'all' / 'week_lead'
  assigneeLabel: string;
  priority: Priority;
  domain: string;
  active: boolean;
  createdAt: string;
  lastGeneratedDate: string | null;
}

export interface Notification {
  id: number;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  taskId: number | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export type AttentionKind =
  | 'overdue'
  | 'due_soon'
  | 'stale'
  | 'blocked'
  | 'approval'
  | 'request'
  | 'decision'
  | 'readiness'
  | 'overload';

export interface AttentionItem {
  kind: AttentionKind;
  tone: Tone;
  title: string;
  subtitle: string;
  ownerName?: string;
  deadline?: string;
  taskId?: number;
  requestId?: number;
  weekId?: number;
  userId?: number;
  /** number of all-staff copies merged into this line */
  count?: number;
}

export interface StaffStatus {
  userId: number;
  name: string;
  title: string;
  open: number;
  inProgress: number;
  waiting: number;
  overdue: number;
  done: number;
  doneThisWeek: number;
  dueToday: number;
}

export interface DashboardData {
  stats: { today: number; overdue: number; week: number; doneThisWeek: number; dueSoon: number; blocked: number };
  attention: AttentionItem[];
  staff: StaffStatus[];
  currentWeek: Week | null;
  nextWeek: Week | null;
  todayEvents: ScheduleEvent[];
  pendingApprovals: number;
  pendingRequests: number;
}

export interface MyTasksData {
  overdue: Task[];
  today: Task[];
  important: Task[];
  week: Task[];
  later: Task[];
  waiting: Task[];
  recentDone: Task[];
  myWeeks: Week[];
  stats: { today: number; overdue: number; week: number; doneToday: number };
}

export interface StaffPageData {
  user: User;
  stats: StaffStatus & {
    total: number;
    onTimePct: number;
    latePct: number;
    openLatePct: number;
  };
  open: Task[];
  overdue: Task[];
  done: Task[];
  selfCreated: Task[];
  fromCommander: Task[];
  upcoming: Task[];
  weeks: Week[];
}

export interface WeekDetail {
  week: Week;
  byDomain: DomainReadiness[];
  tasks: Task[];
  events: ScheduleEvent[];
  lessons: Lesson[];
  checklistTemplates: Template[];
  appliedTemplateIds: number[];
  nextWeek: Pick<Week, 'id' | 'name' | 'startDate'> | null;
  debriefs: Debrief[];
  experiences: Experience[];
}

export interface CloseCheck {
  overdue: Task[];
  open: Task[];
  blocked: Task[];
  lessonsCount: number;
  nextWeek: Pick<Week, 'id' | 'name' | 'startDate'> | null;
}

export interface CarryDecision {
  taskId: number;
  action: CarryAction;
  newDeadline?: string;
  reason?: string;
}

export interface BriefingData {
  date: string;
  events: ScheduleEvent[];
  critical: Task[];
  dueToday: Task[];
  overdue: Task[];
  blocked: Task[];
  byOwner: { userId: number; name: string; dueToday: number; overdue: number; blocked: number }[];
}

export interface WeeklyReport {
  from: string;
  to: string;
  opened: number;
  completed: number;
  carried: number;
  overdue: number;
  byDomain: DomainReadiness[];
  openPoints: Task[];
  completedByStaff: { userId: number; name: string; done: number; late: number }[];
}

export interface LookAheadData {
  days: { date: string; total: number; critical: number; byOwner: Record<number, number> }[];
  weeks: { label: string; from: string; to: string; total: number; week: Week | null }[];
  staffLoad: { userId: number; name: string; total: number }[];
}

export interface DayEndData {
  date: string;
  dueToday: number;
  doneToday: number;
  completedToday: Task[];
  stillOpen: Task[];
  tomorrow: Task[];
}

export interface Meeting {
  id: number;
  title: string;
  startedAt: string;
  endedAt: string | null;
  decisions: string;
  followUps: string;
  createdBy: number;
  createdByName: string;
  summary: MeetingSummary | null;
}

export interface MeetingSummary {
  newTasks: { id: number; title: string; ownerName: string; deadline: string }[];
  closedTasks: { id: number; title: string; ownerName: string }[];
  decisions: string[];
  followUps: string[];
}

export interface SearchResults {
  tasks: Task[];
  users: User[];
  weeks: Week[];
  events: ScheduleEvent[];
  cadets: Cadet[];
  debriefs: Debrief[];
  documents: CourseDocument[];
}

// ---------------- Version 3 (section 31) ----------------

export interface Team {
  id: number;
  name: string;
  commanderId: number | null;
  commanderName: string | null;
  sort: number;
  cadetCount: number;
}

export interface Cadet {
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
  personalNumber: string;
  teamId: number | null;
  teamName: string | null;
  phone: string;
  notes: string;
  status: CadetStatus;
  recordCount: number;
  lastRecordAt: string | null;
  avgScore: number | null;
  disciplineCount: number;
  talkCount: number;
  canManage: boolean;
}

export interface CadetRecord {
  id: number;
  cadetId: number;
  kind: RecordKind;
  title: string;
  body: string;
  category: string;
  score: number | null;
  followUp: string;
  private: boolean;
  taskId: number | null;
  taskTitle: string | null;
  weekId: number | null;
  weekName: string | null;
  authorId: number;
  authorName: string;
  occurredOn: string;
  createdAt: string;
  canDelete: boolean;
}

export interface Experience {
  id: number;
  cadetId: number;
  cadetName: string;
  teamName: string | null;
  role: string;
  weekId: number | null;
  weekName: string | null;
  eventId: number | null;
  eventTitle: string | null;
  startDate: string;
  endDate: string;
  goals: string;
  mentorId: number | null;
  mentorName: string | null;
  status: 'planned' | 'done';
  phase: 'planned' | 'active' | 'awaiting_feedback' | 'done';
  strengths: string;
  improvements: string;
  feedback: string;
  score: number | null;
  evaluatedByName: string | null;
  evaluatedAt: string | null;
  canSeeFeedback: boolean;
  canEdit: boolean;
  canGiveFeedback: boolean;
  feedbackTaskId: number | null;
}

export interface CadetDetail {
  cadet: Cadet;
  records: CadetRecord[];
  experiences: Experience[];
  tasks: Task[];
  scores: { date: string; criterion: string; score: number }[];
}

export interface DebriefItem {
  id: number;
  debriefId: number;
  kind: DebriefItemKind;
  body: string;
  sort: number;
  taskId: number | null;
  taskTitle: string | null;
  taskStatus: TaskStatus | null;
  recurringRuleId: number | null;
  recurringTitle: string | null;
  createdAt: string;
}

export interface Debrief {
  id: number;
  title: string;
  occurredOn: string;
  eventId: number | null;
  eventTitle: string | null;
  weekId: number | null;
  weekName: string | null;
  facilitatorId: number | null;
  facilitatorName: string | null;
  participants: string;
  summary: string;
  status: 'draft' | 'final';
  createdBy: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  itemCounts: Record<DebriefItemKind, number>;
  openTasks: number;
  canEdit: boolean;
}

export interface DebriefDetail {
  debrief: Debrief;
  items: DebriefItem[];
  tasks: Task[];
}

export interface CourseDocument {
  id: number;
  title: string;
  category: string;
  description: string;
  kind: 'link' | 'file';
  url: string;
  fileName: string | null;
  size: number | null;
  weekId: number | null;
  weekName: string | null;
  restricted: boolean;
  pinned: boolean;
  uploadedBy: number | null;
  uploadedByName: string | null;
  createdAt: string;
  canEdit: boolean;
}
