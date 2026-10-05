"use client";

import TrainingCoursePlayer, {
  type TrainingAssessment,
  type TrainingAssignmentView,
  type TrainingContent,
  type TrainingQuestion,
} from "@/app/components/training-course-player";

export type TrainingOperation = {
  id: string;
  employee: { id: string; firstName: string; lastName: string; preferredName: string | null; employeeNumber: string | null };
  course: { code: string; title: string };
  courseVersion: number;
  status: string;
  displayStatus: string;
  assignedAt: string;
  dueAt: string | null;
  completedAt: string | null;
  progress: { completedContent: number; totalContent: number; percentage: number; requiredComplete: boolean };
  assessment: { attemptNumber: number | null; state: string; submittedAt: string | null };
  attention: boolean;
};

export type TrainingOperations = { canAssist: boolean; accessMode: "ADMINISTRATIVE_ASSISTANCE" | "READ_ONLY"; items: TrainingOperation[] };

type Props = {
  data: TrainingOperations;
  selectedEmployeeId: string;
  selectedAssignmentId: string;
  detail: TrainingAssignmentView | null;
  answers: Record<string, string[]>;
  busy: boolean;
  saving: string | null;
  feedback: string;
  onRefresh: () => void;
  onEmployeeChange: (employeeId: string) => void;
  onCourseChange: (assignmentId: string) => void;
  onAnswer: (assessment: TrainingAssessment, question: TrainingQuestion, selected: string[]) => void;
  onComplete: (item: TrainingContent) => void;
  onSubmit: (assessment: TrainingAssessment) => void;
};

const pretty = (value: string) => value.toLowerCase().replaceAll("_", " ");
const displayName = (employee: TrainingOperation["employee"]) => `${employee.preferredName ?? employee.firstName} ${employee.lastName}`;
const date = (value: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : null;

export default function TrainingOperationsWorkspace({ data, selectedEmployeeId, selectedAssignmentId, detail, answers, busy, saving, feedback, onRefresh, onEmployeeChange, onCourseChange, onAnswer, onComplete, onSubmit }: Props) {
  const employees = [...new Map(data.items.map(item => [item.employee.id, item.employee])).values()].sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const selectedEmployee = employees.find(employee => employee.id === selectedEmployeeId) ?? null;
  const courses = data.items.filter(item => item.employee.id === selectedEmployeeId);
  const selected = courses.find(item => item.id === selectedAssignmentId) ?? null;
  const counts = {
    completed: courses.filter(item => item.status === "COMPLETED" || item.status === "TRAINING_COMPLETE_COMPETENCY_PENDING").length,
    inProgress: courses.filter(item => item.status === "IN_PROGRESS").length,
    notStarted: courses.filter(item => item.status === "NOT_STARTED").length,
  };
  const assessmentCounts = courses.reduce<Record<string, number>>((result, item) => ({ ...result, [item.assessment.state]: (result[item.assessment.state] ?? 0) + 1 }), {});
  const aggregateProgress = courses.length ? Math.round(courses.reduce((sum, item) => sum + item.progress.percentage, 0) / courses.length) : 0;
  const nextDue = courses.map(item => item.dueAt).filter((value): value is string => Boolean(value)).sort()[0] ?? null;
  const assessmentSummary = Object.entries(assessmentCounts).map(([state, count]) => `${count} ${pretty(state)}`).join(" · ") || "No assessments";

  return <section className="training-workspace" aria-labelledby="training-operations-heading">
    <div className="section-heading training-workspace-heading">
      <div><h2 id="training-operations-heading">Training operations</h2><p>Select an employee once, then review and assist with that employee’s version-pinned courses.</p></div>
      <button type="button" onClick={onRefresh} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</button>
    </div>
    {employees.length ? <>
      <section className="training-context" aria-label="Selected employee training summary">
        <label>Employee<select value={selectedEmployeeId} onChange={event => onEmployeeChange(event.target.value)} disabled={busy}>{employees.map(employee => <option key={employee.id} value={employee.id}>{displayName(employee)}{employee.employeeNumber ? ` · ${employee.employeeNumber}` : ""}</option>)}</select></label>
        <div className="training-summary-grid">
          <div><strong>{aggregateProgress}%</strong><span>overall course progress</span></div>
          <div><strong>{counts.completed}</strong><span>completed</span></div>
          <div><strong>{counts.inProgress}</strong><span>in progress</span></div>
          <div><strong>{counts.notStarted}</strong><span>not started</span></div>
        </div>
        <p><strong>Assessments:</strong> {assessmentSummary}</p>
        <p><strong>Next established due date:</strong> {nextDue ? date(nextDue) : "No deadline established"}</p>
      </section>
      <div className="training-split-pane">
        <aside className="training-course-pane" aria-label={`${selectedEmployee ? displayName(selectedEmployee) : "Employee"} assigned courses`}>
          <h3>Assigned courses</h3>
          <div className="training-course-list">{courses.map(item => <button type="button" key={item.id} className={`training-course-option${item.id === selectedAssignmentId ? " selected" : ""}`} aria-pressed={item.id === selectedAssignmentId} onClick={() => onCourseChange(item.id)} disabled={busy}>
            <strong>{item.course.title}</strong>
            <span>{pretty(item.displayStatus)} · {item.progress.completedContent}/{item.progress.totalContent} components</span>
            <progress value={item.progress.percentage} max={100} aria-label={`${item.course.title} progress`}/>
            <span>{item.progress.percentage}% · Assessment {pretty(item.assessment.state)}</span>
          </button>)}</div>
        </aside>
        <section className="training-detail-pane" aria-live="polite">
          {selected ? <header className="training-detail-header">
            <div><p className="eyebrow">{data.canAssist ? "Administrative assistance" : "Read only"}</p><h3>{selected.course.code} · {selected.course.title}</h3><p>Version {selected.courseVersion} · {pretty(selected.displayStatus)} · {selected.progress.percentage}% complete · Assessment {pretty(selected.assessment.state)}</p></div>
          </header> : null}
          <p className="training-feedback" role="status">{feedback}</p>
          {busy && !detail ? <div className="empty-state">Loading authoritative course state…</div> : detail ? <TrainingCoursePlayer course={detail} answers={answers} busy={busy} saving={saving} administrative={data.canAssist} readOnly={!data.canAssist} feedback={feedback} onAnswer={onAnswer} onComplete={onComplete} onSubmit={onSubmit}/> : <div className="empty-state">Select a course to view its authoritative assignment.</div>}
        </section>
      </div>
      <details className="training-overview"><summary>All assignments overview</summary><p>This secondary overview supports cross-workforce review without blocking the employee workspace.</p><div className="workforce-table training-operations" role="table"><div className="workforce-row workforce-head" role="row"><span>Employee</span><span>Course</span><span>Progress</span><span>Assessment</span><span>Due</span></div>{data.items.map(item => <button type="button" className="workforce-row" role="row" key={item.id} onClick={() => onCourseChange(item.id)}><span><strong>{displayName(item.employee)}</strong><small>{item.employee.employeeNumber ?? "No employee number"}</small></span><span><strong>{item.course.title}</strong><small>Version {item.courseVersion}</small></span><span>{item.progress.percentage}%<small>{item.progress.completedContent}/{item.progress.totalContent} components</small></span><span>{pretty(item.assessment.state)}</span><span>{date(item.dueAt) ?? "No deadline"}</span></button>)}</div></details>
    </> : <div className="empty-state"><h3>No training assignments are available</h3><p>Assign training from an employee profile, then return here.</p></div>}
  </section>;
}
