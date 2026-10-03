// API data shapes shared by the server (producer) and the client (consumer).

import type { DebriefAnswers, DebriefKind, LessonDecision, LessonHorizon } from './debriefForms';
import type {
  AbsenceReason,
  AttendanceStatus,
  CadetStatus,
  CarryAction,
  CommitteeDecision,
  EvalTone,
  Standing,
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
  /** two-step sign-in is on (only for oneself, and in the commander's list of users) */
  twoFactor?: boolean;
}

/** signing in: a session, or - with two-step sign-in - a ticket for the code step */
export interface LoginResult {
  user?: User;
  twoFactor?: boolean;
  ticket?: string;
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
  /** the area "אחר": what it is */
  domainNote: string;
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

/** A course week found in a Google calendar, and what importing it would do. */
export interface CalendarWeek {
  uid: string;
  name: string;
  startDate: string;
  endDate: string;
  number: number | null;
  /** the course week it matches: imported from this event before, or starting on the same day */
  weekId: number | null;
  action: 'create' | 'update' | 'same';
  /** what an update changes, in words */
  changes: string[];
}

export interface CalendarWeeksPreview {
  weeks: CalendarWeek[];
  /** events in the calendar that did not look like weeks */
  ignored: number;
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
  /** put off: comes back unread at this time */
  snoozedUntil: string | null;
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
  | 'overload'
  | 'debrief'
  | 'lessons'
  | 'away';

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
  /** where it opens, when not the task, week or person */
  link?: string;
}

/** an announcement to the staff, and (for whoever posted it) who confirmed reading it */
export interface Announcement {
  id: number;
  title: string;
  body: string;
  requireAck: boolean;
  urgent: boolean;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  /** this person: when they read and confirmed */
  readAt: string | null;
  ackedAt: string | null;
  /** the commander and the author: everyone it went to */
  audience?: { userId: number; name: string; readAt: string | null; ackedAt: string | null }[];
}

/** one cadet on the day's roll call */
export interface RollEntry {
  cadetId: number;
  fullName: string;
  teamId: number | null;
  teamName: string | null;
  status: AttendanceStatus | null;
  note: string;
  markedByName: string | null;
  markedAt: string | null;
  /** what they are excused from today (exemptions) */
  exemptions: string[];
}

export interface RollCall {
  date: string;
  entries: RollEntry[];
  /** by team: how many, how many marked, how many in */
  teams: { teamId: number | null; name: string; total: number; marked: number; present: number; commanderName: string | null }[];
  counts: Record<AttendanceStatus, number> & { total: number; unmarked: number };
}

/** a cadet's attendance over time */
export interface AttendanceHistory {
  days: { date: string; status: AttendanceStatus; note: string }[];
  counts: Partial<Record<AttendanceStatus, number>>;
}

/** someone on the staff away for some days */
export interface Absence {
  id: number;
  userId: number;
  userName: string;
  startDate: string;
  endDate: string;
  reason: AbsenceReason;
  note: string;
  createdByName: string | null;
  /** their open tasks due while they are away */
  tasksDue: number;
}

/** how loaded someone is, to choose who takes a task */
export interface UserLoad {
  userId: number;
  /** open tasks due in the next 7 days (overdue included), routine recurring ones aside */
  week: number;
  overdue: number;
  /** due on the day asked about */
  onDay: number;
  away: Pick<Absence, 'startDate' | 'endDate' | 'reason'> | null;
}

export interface StaffStatus {
  userId: number;
  name: string;
  title: string;
  away?: Pick<Absence, 'startDate' | 'endDate' | 'reason'> | null;
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
  /** today's roll call, when there are cadets */
  roll: { line: string; counts: RollCall['counts']; teamsMissing: string[] } | null;
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
  /** cadets excused from a rule now - the staff must know */
  exemptions: Exemption[];
}

/** One discipline record in the export (the cadets the user manages, any status). */
export interface DisciplineLogEntry {
  id: number;
  occurredOn: string;
  cadetId: number;
  cadetName: string;
  teamName: string | null;
  category: string;
  offense: string;
  occurrence: number | null;
  formal: boolean;
  noteNumber: number | null;
  severity: string;
  title: string;
  body: string;
  authorName: string;
}

/** Discipline over a range of days, among the cadets the user manages. */
export interface DisciplineSummary {
  events: number;
  notes: number;
  byCategory: { category: string; count: number }[];
  cadets: { id: number; fullName: string; teamName: string | null; events: number; notes: number; totalNotes: number }[];
}

export interface WeeklyReport {
  from: string;
  to: string;
  /** null for someone who manages no cadets */
  discipline: DisciplineSummary | null;
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
  /** discipline notes (הערות משמעת) - the third dismisses the cadet */
  disciplineNotes: number;
  /** what the cadet is excused from now (exemptions), for every staff member to see */
  exemptions: string[];
  /** the evaluation committee the third discipline note opened (deleting a note before it decides cancels it) */
  notesCommittee: { id: number; decision: CommitteeDecision | null } | null;
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
  /** discipline: the offense from the enforcement ladder ("קטגוריה · מקרה"), or '' */
  offense: string;
  /** discipline: which time this offense is for the cadet (1 = first) */
  occurrence: number | null;
  /** discipline: a discipline note (הערת משמעת) */
  formal: boolean;
  /** discipline note: its number among the cadet's notes (1-3) */
  noteNumber: number | null;
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

// ---------------- evaluation files (תיקי הערכה) ----------------

export interface EvaluationEntry {
  id: number;
  cadetId: number;
  category: string;
  tone: EvalTone;
  title: string;
  body: string;
  occurredOn: string;
  weekId: number | null;
  weekName: string | null;
  /** when the entry was shown to the cadet (what gives it weight at a committee) */
  shownOn: string | null;
  authorId: number;
  authorName: string;
  createdAt: string;
  canEdit: boolean;
}

export interface EvaluationOpinion {
  text: string;
  byName: string | null;
  at: string | null;
}

export interface Committee {
  id: number;
  cadetId: number;
  kind: string;
  reason: string;
  meetingDate: string | null;
  referredAt: string;
  referredByName: string | null;
  /** when the version presented to the committee was taken */
  snapshotAt: string;
  decision: CommitteeDecision | null;
  decisionText: string;
  decidedAt: string | null;
  decidedByName: string | null;
}

export interface EvaluationFile {
  cadet: Cadet;
  teamCommanderName: string | null;
  standing: Standing;
  teamOpinion: EvaluationOpinion;
  commanderOpinion: EvaluationOpinion;
  entries: EvaluationEntry[];
  /** from the cadet file: average score by criterion */
  scores: { criterion: string; average: number; count: number }[];
  experiences: { role: string; startDate: string; endDate: string; mentorName: string | null; score: number | null; strengths: string; improvements: string }[];
  discipline: CadetRecord[];
  talks: CadetRecord[];
  committees: Committee[];
  /** the viewer sees the whole file (team commander, course commander); others see only their own entries */
  full: boolean;
  canEditStanding: boolean;
  canEditCommanderOpinion: boolean;
  canRefer: boolean;
  generatedAt: string;
}

export interface EvaluationListItem {
  cadetId: number;
  fullName: string;
  personalNumber: string;
  teamId: number | null;
  teamName: string | null;
  status: CadetStatus;
  standing: Standing;
  positive: number;
  improve: number;
  exception: number;
  notShown: number;
  lastEntryAt: string | null;
  hasOpinions: boolean;
  /** discipline notes (for those who see the whole file) */
  disciplineNotes: number;
  committee: { id: number; kind: string; decision: CommitteeDecision | null } | null;
  full: boolean;
}

/** A committee with the evaluation file as it was presented to it. */
export interface CommitteeDetail {
  committee: Committee;
  file: EvaluationFile;
}

/** A cadet excused from a rule - shaving, carrying a weapon - until a date or further notice. */
export interface Exemption {
  id: number;
  cadetId: number;
  cadetName: string;
  teamName: string | null;
  subject: string;
  details: string;
  /** why: only for the team commander and the course commander (it may be medical) */
  reason: string;
  until: string | null;
  active: boolean;
  createdByName: string | null;
  createdAt: string;
  canDelete: boolean;
}

export interface CadetDetail {
  cadet: Cadet;
  exemptions: Exemption[];
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
  /** a lesson in a debrief form: this cycle (a task on summing up) or the next one (the lessons bank) */
  horizon: LessonHorizon | null;
  ownerId: number | null;
  ownerName: string | null;
  dueDate: string | null;
  /** next cycle: the week or the event it is for */
  target: string;
}

/** a lesson kept for the next cycle, shown when its week or event comes round again */
export interface BankLesson {
  id: number;
  body: string;
  target: string;
  targetWeek: number | null;
  ownerName: string | null;
  debriefId: number;
  debriefTitle: string;
  debriefKind: DebriefKind;
  occurredOn: string;
  createdByName: string | null;
  /** asked for a week or an event: what was decided about it there */
  review?: LessonReview | null;
}

export interface LessonReview {
  decision: LessonDecision;
  note: string;
  taskId: number | null;
  taskTitle: string | null;
  taskStatus: TaskStatus | null;
  decidedByName: string | null;
  decidedAt: string;
}

export interface Debrief {
  id: number;
  kind: DebriefKind;
  /** the form's answers, by question */
  answers: DebriefAnswers;
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
  /** a weekly debrief: the week it is about */
  week: { id: number; number: number; name: string; goals: string } | null;
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

/** Why a snapshot of the database was taken (server/src/snapshots.ts). */
export type SnapshotLabel = 'auto' | 'manual' | 'before_delete' | 'before_restore' | 'archive';

export interface SnapshotInfo {
  id: string;
  savedAt: string;
  label: SnapshotLabel;
  bytes: number;
}

// ---------------- "יישור קו" (the staff's WhatsApp group) ----------------

export interface AlignmentMessage {
  id: number;
  sentAt: string;
  /** the name (or number) as WhatsApp shows it */
  sender: string;
  /** the staff member it was matched to, by name or phone */
  userId: number | null;
  userName: string | null;
  body: string;
  /** had a photo, video or file that the export did not include */
  media: boolean;
  pinned: boolean;
}

export interface AlignmentFeed {
  /** oldest first */
  messages: AlignmentMessage[];
  pinned: AlignmentMessage[];
  /** older messages to load */
  more: boolean;
  total: number;
  lastImport: { at: string; added: number; byName: string | null } | null;
}

export interface AlignmentImport {
  found: number;
  added: number;
  existing: number;
  from: string;
  to: string;
}

// ---------------- previous courses ----------------

export interface CourseStats {
  tasks: number;
  doneTasks: number;
  weeks: number;
  events: number;
  cadets: number;
  debriefs: number;
  /** lessons kept for the next cycle */
  lessons: number;
}

export interface CourseArchive {
  id: number;
  name: string;
  startDate: string | null;
  endDate: string | null;
  stats: CourseStats;
  archivedAt: string;
  archivedByName: string | null;
}

/** a task of the same week in the previous course, to repeat in this one */
export interface PreviousCycleTask {
  id: number;
  title: string;
  ownerName: string | null;
  /** who gets it here: the same person if still on the staff, else the week's lead */
  assigneeName: string | null;
  /** "a copy for each": how many it went to */
  people: number;
  priority: Priority;
  domain: string;
  /** days from the week's first day (negative: before the week) */
  dayOffset: number;
  time: string;
  status: TaskStatus;
  /** a task by that name is already in this week */
  exists: boolean;
}

export interface PreviousCycleWeek {
  archiveId: number;
  archiveName: string;
  week: { name: string; number: number; startDate: string } | null;
  tasks: PreviousCycleTask[];
}

export interface CoursesOverview {
  current: { name: string; startDate: string | null; endDate: string | null; stats: CourseStats };
  archives: CourseArchive[];
  /** the previous course open for reading, if any */
  viewing: number | null;
}

// ---------------- enforcement ladder (מדרג אכיפה) ----------------

/** What to do the n-th time: the text from the ladder, and what it calls for. */
export interface DisciplineStep {
  text: string;
  /** the step is a discipline note */
  note: boolean;
  /** the step sends the cadet to an evaluation committee */
  committee: boolean;
  /** the wording for this discipline note, an index into letters */
  letter: number | null;
}

export interface DisciplineOffense {
  /** "קטגוריה · מקרה" - what records keep, so a re-import continues the count */
  key: string;
  category: string;
  name: string;
  /** examples of what counts, from the document's footnotes */
  definition: string[];
  /** by occurrence: [0] is the first time; null where the ladder has nothing */
  steps: (DisciplineStep | null)[];
}

/** Ready wording for a discipline note ("איחור למסדר - פעם רביעית"). */
export interface DisciplineLetter {
  title: string;
  body: string;
}

/** Discipline across the cadets this user manages: this week, who has notes, the latest records. */
export interface DisciplineOverview {
  /** how many active cadets the user manages (0: nothing to show) */
  managed: number;
  week: { events: number; notes: number; byCategory: { category: string; count: number }[] };
  cadets: { id: number; fullName: string; teamName: string | null; notes: number; committee: { id: number; decision: CommitteeDecision | null } | null }[];
  recent: { id: number; cadetId: number; cadetName: string; title: string; formal: boolean; occurrence: number | null; occurredOn: string; authorName: string }[];
}

export interface DisciplineGuide {
  offenses: DisciplineOffense[];
  letters: DisciplineLetter[];
  /** the link or file it came from */
  source: string;
  importedAt: string | null;
  importedByName: string | null;
}
